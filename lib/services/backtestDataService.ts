// lib/services/backtestDataService.ts
//
// Historical OHLCV data source for backtesting — memory → temp table →
// main daily_prices (read-only) → NSE.
//
// The BACKTEST data path deliberately does NOT write into the main
// `daily_prices` table. Ad-hoc backtest fetches (5 years × many symbols)
// would bloat the DB. Instead:
//
//   1. In-memory cache   (historicalCache, 24h TTL)         — 0 DB ops on hit
//   2. Temp DB table      (BacktestHistory, age-pruned)      — persistent across
//      serverless cold starts, 1 DB read on memory miss
//   3. Main daily_prices (read-only reuse)                   — 1 DB read, zero
//      writes, when the symbol is already ingested
//   4. NSE live           (generateSecurityWiseHistoricalData) — 1 NSE call +
//      1 DB upsert to the temp table; result synced to memory + temp table
//
// Each step is strictly cheaper than the next (0 ops → 1 read → 1 read →
// 1 NSE call + 1 write), so the chain always uses the least expensive source
// that is fresh enough.
//
// Contrast with the widened-scope policy in lib/market-cache.ts
// (getOrFetchNseData), which IS allowed to sync into main market tables after
// an NSE fetch. Backtest data never is.

import { historicalCache } from "@/lib/cache";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import {
  fetchSecurityWiseHistoricalData,
  securityWiseBarsToOHLCV,
} from "@/lib/nse-api";
import type { OHLCV } from "@/lib/screener/technical-analysis";

/** How long a temp-table row stays fresh before we refetch from NSE. */
const TEMP_TABLE_FRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Temp-table rows older than this are pruned to stop the cache table growing. */
const TEMP_TABLE_PRUNE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Format a Date as DD-MM-YYYY (NSE historical API expects this). */
export function formatNseDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/** Default fetch window: 5 years back through today (NSE's max range). */
export function defaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setFullYear(from.getFullYear() - 5);
  return { from: formatNseDate(from), to: formatNseDate(to) };
}

export interface BacktestDataResult {
  ohlcv: OHLCV[];
  source: "memory" | "db" | "nse";
  barCount: number;
  rangeStart: Date;
  rangeEnd: Date;
  fetchedAt: Date;
}

/** Cache payload — OHLCV bars plus the fetch timestamp for accurate staleness. */
interface HistoricalCacheEntry {
  ohlcv: OHLCV[];
  fetchedAt: number;
}

/**
 * Get historical OHLCV for a symbol using the memory → temp table → NSE chain.
 * Optionally narrows the requested window (from/to DD-MM-YYYY); defaults to
 * 5 years through today.
 */
export async function getBacktestData(
  symbol: string,
  fromDate?: string,
  toDate?: string
): Promise<BacktestDataResult> {
  const sym = symbol.toUpperCase();
  const { from, to } =
    fromDate && toDate ? { from: fromDate, to: toDate } : defaultDateRange();

  const cacheKey = `backtest:${sym}:${from}:${to}`;

  // 1) In-memory cache (0 DB ops on hit)
  const memCached = historicalCache.get<HistoricalCacheEntry>(cacheKey);
  if (memCached && memCached.ohlcv.length > 0) {
    return {
      ohlcv: memCached.ohlcv,
      source: "memory",
      barCount: memCached.ohlcv.length,
      rangeStart: new Date(memCached.ohlcv[0].timestamp),
      rangeEnd: new Date(memCached.ohlcv[memCached.ohlcv.length - 1].timestamp),
      fetchedAt: new Date(memCached.fetchedAt),
    };
  }

  // 2) Temp DB table (persistent across serverless cold starts)
  const tempRow = await prisma.backtestHistory.findUnique({
    where: { symbol_fromDate_toDate_series: { symbol: sym, fromDate: from, toDate: to, series: "EQ" } },
  });

  if (tempRow && Date.now() - tempRow.fetchedAt.getTime() < TEMP_TABLE_FRESH_MS) {
    const ohlcv = (tempRow.ohlcv as unknown as OHLCV[]) ?? [];
    // Repopulate memory so the next run is a 0-DB-op hit
    if (ohlcv.length > 0) {
      historicalCache.set(cacheKey, { ohlcv, fetchedAt: tempRow.fetchedAt.getTime() });
    }
    return {
      ohlcv,
      source: "db",
      barCount: ohlcv.length,
      rangeStart: ohlcv.length ? new Date(ohlcv[0].timestamp) : new Date(),
      rangeEnd: ohlcv.length ? new Date(ohlcv[ohlcv.length - 1].timestamp) : new Date(),
      fetchedAt: tempRow.fetchedAt,
    };
  }

  // 2b) Main daily_prices table (read-only) — if this symbol is already
  // ingested there, reuse it instead of spending an NSE call + temp upsert.
  // Cost: 1 DB read, zero writes. Never pollutes the main table.
  const ticker = `NSE:${sym}`;
  const dailyPrices = await prisma.dailyPrice.findMany({
    where: { ticker },
    orderBy: { tradeDate: "asc" },
    select: { tradeDate: true, open: true, high: true, low: true, close: true, volume: true },
  });

  if (dailyPrices.length >= 50) {
    const ohlcv: OHLCV[] = dailyPrices.map((dp) => ({
      timestamp: dp.tradeDate.getTime(),
      open: Number(dp.open ?? 0),
      high: Number(dp.high ?? 0),
      low: Number(dp.low ?? 0),
      close: Number(dp.close ?? 0),
      volume: Number(dp.volume ?? 0),
    }));
    const fetchedAt = new Date();
    // Populate memory only — the main table is already the durable store
    historicalCache.set(cacheKey, { ohlcv, fetchedAt: fetchedAt.getTime() });
    return {
      ohlcv,
      source: "db",
      barCount: ohlcv.length,
      rangeStart: new Date(ohlcv[0].timestamp),
      rangeEnd: new Date(ohlcv[ohlcv.length - 1].timestamp),
      fetchedAt,
    };
  }

  // 3) NSE live — fetch, then sync to memory + temp table, then age-prune
  logger.info({ msg: "[BacktestData] Fetching from NSE", symbol: sym, from, to });
  const nseBars = await fetchSecurityWiseHistoricalData(sym, from, to, "EQ");

  if (nseBars.length === 0) {
    // If we had a stale temp row, fall back to it rather than failing hard
    if (tempRow) {
      const ohlcv = (tempRow.ohlcv as unknown as OHLCV[]) ?? [];
      if (ohlcv.length > 0) {
        historicalCache.set(cacheKey, { ohlcv, fetchedAt: tempRow.fetchedAt.getTime() });
        return {
          ohlcv,
          source: "db",
          barCount: ohlcv.length,
          rangeStart: new Date(ohlcv[0].timestamp),
          rangeEnd: new Date(ohlcv[ohlcv.length - 1].timestamp),
          fetchedAt: tempRow.fetchedAt,
        };
      }
    }
    throw new Error(`No historical data returned from NSE for ${sym}`);
  }

  const ohlcv = securityWiseBarsToOHLCV(nseBars);
  const fetchedAt = new Date();

  historicalCache.set(cacheKey, { ohlcv, fetchedAt: fetchedAt.getTime() });

  await prisma.backtestHistory.upsert({
    where: { symbol_fromDate_toDate_series: { symbol: sym, fromDate: from, toDate: to, series: "EQ" } },
    create: { symbol: sym, fromDate: from, toDate: to, series: "EQ", ohlcv: ohlcv as unknown as object, barCount: ohlcv.length, fetchedAt },
    update: { ohlcv: ohlcv as unknown as object, barCount: ohlcv.length, fetchedAt },
  });

  // Age-prune the temp table (fire-and-forget — never blocks the response)
  pruneTempTable().catch((err) =>
    logger.warn({ msg: "[BacktestData] Temp table prune failed", error: err })
  );

  return {
    ohlcv,
    source: "nse",
    barCount: ohlcv.length,
    rangeStart: new Date(ohlcv[0].timestamp),
    rangeEnd: new Date(ohlcv[ohlcv.length - 1].timestamp),
    fetchedAt,
  };
}

/** Delete temp-table rows older than the prune window (keeps cache table small). */
export async function pruneTempTable(): Promise<number> {
  const cutoff = new Date(Date.now() - TEMP_TABLE_PRUNE_MS);
  const res = await prisma.backtestHistory.deleteMany({ where: { fetchedAt: { lt: cutoff } } });
  if (res.count > 0) {
    logger.info({ msg: "[BacktestData] Pruned temp table", removed: res.count });
  }
  return res.count;
}
