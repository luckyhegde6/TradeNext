// app/api/recommendations/ipos/closed/route.ts
//
// GET /api/recommendations/ipos/closed?days=30
//
// Returns recently closed IPOs (default last 30 days) enriched with current
// stock prices and gain/loss % vs the issue price band low.  The NSE
// "all-upcoming-issues" endpoint already includes Closed IPOs; this route
// filters by recency, batch-fetches live quotes, and memory-caches the
// result for 1 h so page loads are fast.

import { NextRequest, NextResponse } from "next/server";
import { getUpcomingIpoIssues } from "@/lib/services/nseIpoService";
import { parsePriceBandLow } from "@/lib/services/ipoIssueSize";
import cache from "@/lib/cache";
import logger from "@/lib/logger";

export const runtime = "nodejs";

const CLOSED_CACHE_TTL = 60 * 60; // 1 hour
const CLOSED_CACHE_KEY_PREFIX = "ipo_closed_";
const MAX_DAYS = 90;
const DEFAULT_DAYS = 30;
/** Max symbols to batch-fetch quotes for (safety cap). */
const MAX_QUOTES = 50;

/* ─── Types ─── */

interface ClosedIpoIssue {
  symbol: string;
  companyName: string;
  series: string;
  status: string;
  issueStartDate: string;
  issueEndDate: string;
  issuePrice: string;
  issueSize: string;
  lotSize?: string;
  priceBand?: string;
  /** Current market price (null if quote fetch failed). */
  currentPrice: number | null;
  /** Gain/loss % vs issue price band low (null when data unavailable). */
  gainPercent: number | null;
  /** Computed issue price band low (₹). */
  issuePriceLow: number | null;
}

/* ─── Helpers ─── */

/** Parse "14-Aug-2026" → Date (local midnight IST). */
function parseIssueDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  try {
    const [day, mon, year] = dateStr.split("-");
    if (!day || !mon || !year) return null;
    // Map month abbreviation to 0-indexed month number.
    const months: Record<string, number> = {
      JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
      JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
    };
    const mi = months[mon.toUpperCase()];
    if (mi === undefined) return null;
    const d = new Date(parseInt(year), mi, parseInt(day));
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/* ─── Route ─── */

export async function GET(request: NextRequest) {
  const traceId = request.headers.get("x-trace-id") || "none";

  try {
    const { searchParams } = new URL(request.url);
    const daysRaw = parseInt(searchParams.get("days") || String(DEFAULT_DAYS), 10);
    const days = Math.min(Math.max(Number.isFinite(daysRaw) ? daysRaw : DEFAULT_DAYS, 1), MAX_DAYS);

    // Check memory cache first.
    const cacheKey = `${CLOSED_CACHE_KEY_PREFIX}${days}`;
    const cached = cache.get<ClosedIpoIssue[]>(cacheKey);
    if (cached) {
      return NextResponse.json({
        success: true,
        issues: cached,
        source: "cache",
        count: cached.length,
        days,
        timestamp: new Date().toISOString(),
        traceId,
      });
    }

    // 1) Fetch all upcoming issues from NSE (24h cached server-side).
    const result = await getUpcomingIpoIssues();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    // 2) Filter: status === "Closed" + issueEndDate within last N days.
    const closedIssues = result.data.filter((issue) => {
      if (issue.status !== "Closed") return false;
      const endDate = parseIssueDate(issue.issueEndDate);
      return endDate !== null && endDate >= cutoff;
    });

    if (closedIssues.length === 0) {
      cache.set(cacheKey, [], CLOSED_CACHE_TTL);
      return NextResponse.json({
        success: true,
        issues: [],
        source: result.source,
        count: 0,
        days,
        timestamp: new Date().toISOString(),
        traceId,
      });
    }

    // 3) Batch-fetch current prices for each closed IPO symbol.
    //    Dynamic import to keep the route lightweight and avoid pulling in
    //    the entire stock-service module graph at cold start.
    const { getStockQuote } = await import("@/lib/stock-service");
    const symbols = closedIssues
      .slice(0, MAX_QUOTES)
      .map((i) => i.symbol.toUpperCase());

    const priceResults = await Promise.allSettled(
      symbols.map((sym) => getStockQuote(sym, false))
    );

    const priceMap = new Map<string, number>();
    for (let i = 0; i < symbols.length; i++) {
      const r = priceResults[i];
      if (r.status === "fulfilled" && r.value?.lastPrice) {
        priceMap.set(symbols[i], r.value.lastPrice);
      }
    }

    // 4) Enrich each closed IPO with current price + gain %.
    const enriched: ClosedIpoIssue[] = closedIssues.map((issue) => {
      const sym = issue.symbol.toUpperCase();
      const currentPrice = priceMap.get(sym) ?? null;
      const issuePriceLow = parsePriceBandLow(issue.issuePrice || issue.priceBand);
      let gainPercent: number | null = null;
      if (currentPrice !== null && issuePriceLow !== null && issuePriceLow > 0) {
        gainPercent = ((currentPrice - issuePriceLow) / issuePriceLow) * 100;
        gainPercent = Math.round(gainPercent * 100) / 100; // 2 dp
      }
      return {
        symbol: sym,
        companyName: issue.companyName,
        series: issue.series,
        status: issue.status,
        issueStartDate: issue.issueStartDate,
        issueEndDate: issue.issueEndDate,
        issuePrice: issue.issuePrice,
        issueSize: issue.issueSize,
        lotSize: issue.lotSize,
        priceBand: issue.priceBand,
        currentPrice,
        gainPercent,
        issuePriceLow,
      };
    });

    // 5) Cache + respond.
    cache.set(cacheKey, enriched, CLOSED_CACHE_TTL);

    logger.info({
      msg: "Closed IPOs with prices fetched",
      count: enriched.length,
      days,
      withPrice: enriched.filter((e) => e.currentPrice !== null).length,
      source: result.source,
      traceId,
    });

    return NextResponse.json({
      success: true,
      issues: enriched,
      source: result.source,
      count: enriched.length,
      days,
      timestamp: new Date().toISOString(),
      traceId,
    });
  } catch (error) {
    logger.error({
      msg: "Failed to fetch closed IPOs",
      error: error instanceof Error ? error.message : String(error),
      traceId,
    });
    return NextResponse.json(
      { success: false, issues: [], error: "Failed to fetch closed IPOs" },
      { status: 500 }
    );
  }
}
