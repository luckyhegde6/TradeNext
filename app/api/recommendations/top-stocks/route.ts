import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { recommendationsCache } from "@/lib/cache";
import logger from "@/lib/logger";
import { isDbUnavailableError } from "@/lib/db-utils";
import { getSqliteFallback } from "@/lib/sqlite";

export const runtime = "nodejs";

/** Serialized row shape shared by the Prisma and SQLite-mirror paths. */
type TopStockRow = {
  id: string; symbol: string; runid: string; screenercount: number;
  screenerattribution: string[]; price: number; change: number;
  changepercent: number; volume: bigint | number | null; airecommendation: string;
  confidence: number; targetprice: number | null; stoploss: number | null;
  timehorizon: string; reasoning: string | null; riskfactors: unknown;
  aisuccess: boolean | null; rundate: Date; runstatus: string;
  currentprice: number | null; entryprice: number | null; trackerstatus: string | null;
};

/**
 * Plan-limit fallback (Spec 01): rebuild the top-stocks list from the SQLite
 * mirror when Prisma is under a hold (P6003). Mirrors the DISTINCT ON (s.symbol)
 * ... ORDER BY s.symbol, r."runDate" DESC semantics — runs are enumerated newest
 * first, so the FIRST occurrence of each symbol wins. Returns null when the
 * mirror is not ready or the assembly itself fails.
 */
function topStocksFromSqlite(
  limit: number,
  offset: number,
  hasFilter: boolean,
  filter: string,
): { stocks: TopStockRow[]; total: number } | null {
  const sqlite = getSqliteFallback();
  if (!sqlite) return null;
  try {
    const runs = sqlite.getRecommendationRuns({
      status: ["completed", "failed"],
      limit: 500,
    });
    const bySymbol = new Map<string, TopStockRow>();
    for (const run of runs) {
      const runId = String(run.id ?? "");
      if (!runId) continue;
      const runDate =
        run.runDate instanceof Date ? run.runDate : new Date(String(run.runDate));
      const runStatus = String(run.status ?? "completed");
      const stockRows = sqlite.getRecommendationStocks(runId);
      for (const s of stockRows) {
        const symbol = String(s.symbol ?? "").toUpperCase();
        if (!symbol || bySymbol.has(symbol)) continue; // latest run already wins
        const ai = String(s.aiRecommendation ?? "HOLD");
        if (hasFilter && ai !== filter) continue;
        bySymbol.set(symbol, {
          id: String(s.id ?? ""),
          symbol,
          runid: runId,
          screenercount: Number(s.screenerCount ?? 0),
          screenerattribution: Array.isArray(s.screenerAttribution)
            ? (s.screenerAttribution as string[])
            : [],
          price: Number(s.price ?? 0),
          change: Number(s.change ?? 0),
          changepercent: Number(s.changePercent ?? 0),
          volume: s.volume != null ? Number(s.volume) : null,
          airecommendation: ai,
          confidence: s.confidence != null ? Number(s.confidence) : 0,
          targetprice: s.targetPrice != null ? Number(s.targetPrice) : null,
          stoploss: s.stopLoss != null ? Number(s.stopLoss) : null,
          timehorizon: String(s.timeHorizon ?? "swing"),
          reasoning: s.reasoning != null ? String(s.reasoning) : null,
          riskfactors: s.riskFactors ?? null,
          aisuccess: s.aiSuccess != null ? Boolean(s.aiSuccess) : null,
          rundate: runDate,
          runstatus: runStatus,
          entryprice: null,
          currentprice: null,
          trackerstatus: null,
        });
      }
    }

    const deduped = [...bySymbol.values()];
    // Tracker join (LEFT JOIN semantics) — one batched read.
    const trackerBySymbol = new Map(
      sqlite
        .getRecommendationTrackers({
          symbolIn: deduped.map((r) => r.symbol),
          limit: deduped.length,
        })
        .map((t) => [String(t.symbol ?? "").toUpperCase(), t]),
    );
    for (const row of deduped) {
      const t = trackerBySymbol.get(row.symbol);
      if (t) {
        row.entryprice = t.entryPrice != null ? Number(t.entryPrice) : null;
        row.currentprice = t.currentPrice != null ? Number(t.currentPrice) : null;
        row.trackerstatus = t.status != null ? String(t.status) : null;
      }
    }

    deduped.sort(
      (a, b) => b.screenercount - a.screenercount || a.symbol.localeCompare(b.symbol),
    );
    const total = deduped.length;
    return { stocks: deduped.slice(offset, offset + limit), total };
  } catch (err) {
    logger.warn({
      msg: "SQLite top-stocks fallback failed",
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * GET /api/recommendations/top-stocks — Top individual stock recommendations across all runs
 * Returns a flat list of stocks (deduplicated by symbol, latest wins) sorted by screenerCount desc.
 * Query params: limit (default 20), offset (default 0), filter (all|BUY|HOLD|SELL)
 */
export async function GET(request: NextRequest) {
  const traceId = request.headers.get("x-trace-id") || "none";

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);
    const offset = parseInt(searchParams.get("offset") || "0");
    const filter = searchParams.get("filter") || "all";

    const cacheKey = `recommendations:top-stocks:${limit}:${offset}:${filter}`;
    const cached = recommendationsCache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    // Build filter condition
    const hasFilter = filter !== "all" && ["BUY", "HOLD", "SELL"].includes(filter);

    let stocks: TopStockRow[];
    let total: number;

    try {
      // Fetch all stocks from all completed runs, deduplicate by symbol (keep latest)
      stocks = hasFilter
        ? await prisma.$queryRaw<TopStockRow[]>`
            SELECT DISTINCT ON (s.symbol)
              s.id, s.symbol, s."runId" as runid, s."screenerCount" as screenercount,
              s."screenerAttribution" as screenerattribution, s.price, s.change,
              s."changePercent" as changepercent, s.volume,
              s."aiRecommendation" as airecommendation, s.confidence,
              s."targetPrice" as targetprice, s."stopLoss" as stoploss,
              s."timeHorizon" as timehorizon, s.reasoning, s."riskFactors" as riskfactors,
              s."aiSuccess" as aisuccess, r."runDate" as rundate, r.status as runstatus,
              t."currentPrice" as currentprice, t."entryPrice" as entryprice, t.status as trackerstatus
            FROM daily_recommendation_stocks s
            JOIN daily_recommendation_runs r ON r.id = s."runId"
            LEFT JOIN recommendation_trackers t ON t.id = s."trackerId"
            WHERE r.status IN ('completed', 'failed')
              AND r."uniqueStocks" > 0
              AND s."aiRecommendation" = ${filter}
            ORDER BY s.symbol, r."runDate" DESC
            LIMIT ${limit} OFFSET ${offset}
          `
        : await prisma.$queryRaw<TopStockRow[]>`
            SELECT DISTINCT ON (s.symbol)
              s.id, s.symbol, s."runId" as runid, s."screenerCount" as screenercount,
              s."screenerAttribution" as screenerattribution, s.price, s.change,
              s."changePercent" as changepercent, s.volume,
              s."aiRecommendation" as airecommendation, s.confidence,
              s."targetPrice" as targetprice, s."stopLoss" as stoploss,
              s."timeHorizon" as timehorizon, s.reasoning, s."riskFactors" as riskfactors,
              s."aiSuccess" as aisuccess, r."runDate" as rundate, r.status as runstatus,
              t."currentPrice" as currentprice, t."entryPrice" as entryprice, t.status as trackerstatus
            FROM daily_recommendation_stocks s
            JOIN daily_recommendation_runs r ON r.id = s."runId"
            LEFT JOIN recommendation_trackers t ON t.id = s."trackerId"
            WHERE r.status IN ('completed', 'failed')
              AND r."uniqueStocks" > 0
            ORDER BY s.symbol, r."runDate" DESC
            LIMIT ${limit} OFFSET ${offset}
          `;

      // Get total count for pagination
      const countResult = hasFilter
        ? await prisma.$queryRaw<Array<{ count: bigint }>>`
            SELECT COUNT(DISTINCT s.symbol) as count
            FROM daily_recommendation_stocks s
            JOIN daily_recommendation_runs r ON r.id = s."runId"
            WHERE r.status IN ('completed', 'failed')
              AND r."uniqueStocks" > 0
              AND s."aiRecommendation" = ${filter}
          `
        : await prisma.$queryRaw<Array<{ count: bigint }>>`
            SELECT COUNT(DISTINCT s.symbol) as count
            FROM daily_recommendation_stocks s
            JOIN daily_recommendation_runs r ON r.id = s."runId"
            WHERE r.status IN ('completed', 'failed')
              AND r."uniqueStocks" > 0
          `;
      total = Number(countResult[0]?.count ?? 0);
    } catch (error) {
      if (!isDbUnavailableError(error)) throw error;
      logger.warn({
        msg: "Plan-limit hold — serving top stocks from SQLite mirror",
        error: error instanceof Error ? error.message : String(error),
        traceId,
      });
      const fb = topStocksFromSqlite(limit, offset, hasFilter, filter);
      if (!fb) throw error;
      stocks = fb.stocks;
      total = fb.total;
    }

    // Serialize BigInt and format response
    const serialized = stocks.map((s) => ({
      id: s.id,
      symbol: s.symbol,
      runId: s.runid,
      screenerCount: s.screenercount,
      screenerAttribution: s.screenerattribution,
      price: s.price,
      change: s.change,
      changePercent: s.changepercent,
      volume: s.volume != null ? Number(s.volume) : null,
      aiRecommendation: s.airecommendation || "HOLD",
      confidence: s.confidence ?? 0,
      targetPrice: s.targetprice,
      stopLoss: s.stoploss,
      timeHorizon: s.timehorizon,
      reasoning: s.reasoning,
      riskFactors: s.riskfactors,
      aiSuccess: s.aisuccess,
      runDate: s.rundate instanceof Date ? s.rundate.toISOString() : String(s.rundate),
      runStatus: s.runstatus,
      // Tracker-derived prices for predicted vs current comparison
      entryPrice: s.entryprice,
      currentPrice: s.currentprice,
      trackerStatus: s.trackerstatus,
    }));

    const result = {
      success: true,
      stocks: serialized,
      total,
      limit,
      offset,
      timestamp: new Date().toISOString(),
      traceId,
    };

    // Cache for 1 hour
    recommendationsCache.set(cacheKey, result, 3600);

    logger.info({
      msg: "Top stocks fetched",
      stockCount: serialized.length,
      total,
      filter,
      traceId,
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error({
      msg: "Failed to fetch top stocks",
      error: error instanceof Error ? error.message : String(error),
      traceId,
    });
    return NextResponse.json(
      { success: false, error: "Failed to fetch top stocks" },
      { status: 500 }
    );
  }
}
