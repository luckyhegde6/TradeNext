// lib/services/nseIpoService.ts
//
// Upcoming / current IPO issues from NSE, served through the shared
// memory → API → DB chain (getOrFetchSyncedData) so the payload is
// memory-cached, DB-synced only on change, and DB-served only when the
// memory cache is empty AND the NSE call fails.

import { nseFetch } from "@/lib/nse-client";
import {
  getOrFetchSyncedData,
  type SyncedFetchOptions,
  type SyncedFetchResult,
} from "@/lib/services/syncedDataService";
// Client-safe pure helpers (no prisma/pg chain) — re-exported for compatibility
// with server-side callers + tests that import them from here. `parseSharesPerLot`
// is also imported locally for parseIpoDetail below.
import { parseSharesPerLot } from "@/lib/services/ipoIssueSize";
export {
  parseSharesPerLot,
  parsePriceBandLow,
  perLotInvestment,
  formatIssueSize,
} from "@/lib/services/ipoIssueSize";
export type { IssueSizeInput } from "@/lib/services/ipoIssueSize";

/* ─── Types ─── */

export interface IpoIssue {
  companyName: string;
  symbol: string;
  series: string; // "EQ" | "SME"
  status: string; // "Active" | "Closed" | "Forthcoming"
  issueStartDate: string; // "12-Aug-2026"
  issueEndDate: string; // "14-Aug-2026"
  issuePrice: string; // "Rs.92 to Rs.97"
  issueSize: string; // shares count string, e.g. "94436030"
  lotSize?: string;
  priceBand?: string;
}

/** Parsed per-issue detail from GET /api/ipo-detail?symbol=X */
export interface IpoIssueDetail {
  symbol: string;
  companyName: string;
  /** Bid lot — e.g. "154 Equity Shares" (mainboard) or "600 Equity Shares" (SME). */
  bidLot: string;
  /** Number of shares per lot when parseable (154, 600…). */
  sharesPerLot: number | null;
  /** Human Issue Size text from NSE (e.g. "₹8,855 mn Fresh + ₹1,385 mn OFS"). */
  issueSizeText: string;
  priceRange: string;
  faceValue: string;
  issuePeriod: string;
  registrar: string;
}

/* ─── Cache / sync config ─── */

const IPO_CACHE_KEY = "nse_upcoming_ipo_issues";
const IPO_CACHE_TTL = 24 * 60 * 60; // 24h — IPO calendar changes at most daily

/* ─── Parsing ─── */

function isIpoIssue(value: unknown): value is IpoIssue {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.companyName === "string" && typeof v.issueEndDate === "string";
}

/* ─── Fetcher ─── */

/**
 * Upcoming / current IPO issues from NSE.
 * API: GET https://www.nseindia.com/api/all-upcoming-issues?category=ipo
 * (page: https://www.nseindia.com/market-data/all-upcoming-issues-ipo)
 *
 * Response: array of { companyName, issueEndDate, issuePrice, issueSize,
 * issueStartDate, series, status, symbol, lotSize?, priceBand? }.
 * Server-side proxy only via nseFetch (cookie + rate-limit handled). Never
 * call NSE from the client.
 *
 * Read path: memory cache → NSE API → market_cache DB (fallback only).
 * DB write: only when the payload changed (skip identical writes after TTL).
 */
export async function getUpcomingIpoIssues(
  forceRefresh = false
): Promise<SyncedFetchResult<IpoIssue[]>> {
  const options: SyncedFetchOptions<IpoIssue[]> = {
    cacheKey: IPO_CACHE_KEY,
    dataType: "ipo_upcoming",
    ttlSeconds: IPO_CACHE_TTL,
    fetchFromApi: async () => {
      const raw = (await nseFetch(
        "https://www.nseindia.com/api/all-upcoming-issues",
        "?category=ipo"
      )) as unknown;

      const rows = Array.isArray(raw) ? raw : [];
      return rows.filter(isIpoIssue);
    },
  };

  return getOrFetchSyncedData(options, forceRefresh);
}

/* ─── Per-issue detail (Bid Lot / shares per lot) ─── */

const IPO_DETAIL_TTL = 24 * 60 * 60; // 24h — lot sizes change only on price-band revision

function detailCacheKey(symbol: string): string {
  return `nse_ipo_detail_${symbol.toUpperCase()}`;
}

/** Map the NSE detail dataList (title/value pairs) into a structured detail. */
export function parseIpoDetail(symbol: string, raw: unknown): IpoIssueDetail {
  const list: { title: string | null; value: string }[] =
    Array.isArray(raw) ? raw : ((raw as any)?.issueInfo?.dataList ?? []);
  const byTitle = new Map<string, string>();
  for (const item of list) {
    if (typeof item?.title === "string" && item.title.trim()) {
      byTitle.set(item.title.trim(), String(item.value ?? "").replace(/^"|"$/g, ""));
    }
  }

  const companyName = byTitle.get("Symbol") || symbol;
  const bidLot =
    byTitle.get("Bid Lot") ||
    byTitle.get("Minimum Order Quantity") ||
    "Not available";
  const issueSizeText =
    byTitle.get("Issue Size") ||
    byTitle.get("Issue Size (in Rs. Cr)") ||
    byTitle.get("Issue Details") ||
    "";

  return {
    symbol: companyName.toUpperCase(),
    companyName,
    bidLot,
    sharesPerLot: parseSharesPerLot(bidLot),
    issueSizeText,
    priceRange: byTitle.get("Price Range") || byTitle.get("Price Band") || "",
    faceValue: byTitle.get("Face Value") || "",
    issuePeriod: byTitle.get("Issue Period") || "",
    registrar: byTitle.get("Name of the Registrar") || "",
  };
}

/**
 * Per-issue detail (Bid Lot → shares per lot, Issue Size text, price range)
 * from GET https://www.nseindia.com/api/ipo-detail?symbol=X — server-side
 * proxy via nseFetch, cached per-symbol 24h (memory → NSE → DB fallback).
 */
export async function getIpoIssueDetail(
  symbol: string,
  forceRefresh = false
): Promise<SyncedFetchResult<IpoIssueDetail>> {
  const upper = symbol.toUpperCase();
  const options: SyncedFetchOptions<IpoIssueDetail> = {
    cacheKey: detailCacheKey(upper),
    dataType: "ipo_detail",
    ttlSeconds: IPO_DETAIL_TTL,
    fetchFromApi: async () => {
      const raw = (await nseFetch(
        `https://www.nseindia.com/api/ipo-detail?symbol=${encodeURIComponent(upper)}`
      )) as unknown;
      return parseIpoDetail(upper, raw);
    },
  };

  return getOrFetchSyncedData(options, forceRefresh);
}