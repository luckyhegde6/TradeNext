// lib/services/priceCache.ts
//
// Two caches:
// 1. PriceCache class — short-lived SSE price cache (30s TTL) for live streaming
// 2. DailyPriceAccumulator — batches daily_prices DB writes (market hours → 4pm flush)
//
// The PriceCache class is unchanged from v3.2.0 — used by the SSE stream and
// page-level live price overlays.
//
// The DailyPriceAccumulator is new (v3.20.1) — eliminates thousands of individual
// DB writes during market hours by accumulating in memory and flushing in bulk
// after 4 PM IST.

import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

// ─── SSE Price Cache (v3.2.0, unchanged) ──────────────────────────────────

type PriceData = {
  price: number;
  change: number;
  changePercent: number;
  timestamp: number; // ms since epoch
};

type Callback = (symbol: string, data: PriceData) => void;

class PriceCache {
  private cache = new Map<string, PriceData>();
  private subscribers = new Map<string, Set<Callback>>();
  private defaultTTL = 30_000; // 30 seconds

  get(symbol: string): PriceData | null {
    const data = this.cache.get(symbol.toUpperCase());
    if (!data) return null;
    if (Date.now() - data.timestamp > this.defaultTTL) {
      this.cache.delete(symbol.toUpperCase());
      return null;
    }
    return data;
  }

  set(symbol: string, data: PriceData): void {
    this.cache.set(symbol.toUpperCase(), { ...data, timestamp: Date.now() });
  }

  subscribe(symbol: string, callback: Callback): () => void {
    const sym = symbol.toUpperCase();
    if (!this.subscribers.has(sym)) {
      this.subscribers.set(sym, new Set());
    }
    this.subscribers.get(sym)!.add(callback);
    return () => {
      this.subscribers.get(sym)?.delete(callback);
      if (this.subscribers.get(sym)?.size === 0) {
        this.subscribers.delete(sym);
      }
    };
  }

  notify(symbol: string, data: PriceData): void {
    this.set(symbol, data);
    const sym = symbol.toUpperCase();
    const subs = this.subscribers.get(sym);
    if (subs) {
      for (const cb of subs) {
        try { cb(sym, data); } catch { /* ignore subscriber error */ }
      }
    }
  }

  getAll(): Record<string, PriceData> {
    const result: Record<string, PriceData> = {};
    for (const [symbol, data] of this.cache.entries()) {
      if (Date.now() - data.timestamp <= this.defaultTTL) {
        result[symbol] = data;
      }
    }
    return result;
  }

  getStats(): { cachedSymbols: number; activeSubscriptions: number } {
    return {
      cachedSymbols: this.cache.size,
      activeSubscriptions: this.subscribers.size,
    };
  }
}

export const priceCache = new PriceCache();

// ─── Daily Price Accumulator (v3.20.1) ────────────────────────────────────
//
// During market hours (9:15 AM – 3:30 PM IST) prices are cached in memory.
// After 4:00 PM IST a single bulk upsert flushes all accumulated prices to
// the `daily_prices` table. This eliminates thousands of individual DB writes
// during the trading day.

interface DailyPriceRecord {
  ticker: string;
  tradeDate: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface DailyPriceState {
  /** symbol → latest price snapshot */
  prices: Map<string, DailyPriceRecord>;
  flushCount: number;
  lastFlushAt: string | null;
  lastFlushRows: number;
  totalRowsWritten: number;
  lastError: string | null;
  dayKey: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
if (!g.__dailyPriceState) {
  g.__dailyPriceState = {
    prices: new Map<string, DailyPriceRecord>(),
    flushCount: 0,
    lastFlushAt: null,
    lastFlushRows: 0,
    totalRowsWritten: 0,
    lastError: null,
    dayKey: "",
  } as DailyPriceState;
}
const state: DailyPriceState = g.__dailyPriceState;

// ─── IST helpers ──────────────────────────────────────────────────────────

function getIstNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
}

function getIstDayKey(): string {
  return getIstNow().toISOString().split("T")[0];
}

function getIstHour(): number {
  return getIstNow().getHours();
}

function getIstMinutes(): number {
  return getIstNow().getMinutes();
}

/** Is the current IST time >= 4:00 PM? (post-market flush window) */
export function isPostMarket(): boolean {
  const h = getIstHour();
  const m = getIstMinutes();
  return h > 16 || (h === 16 && m === 0);
}

/** Is the current IST time within market hours (9:15 AM – 3:30 PM)? */
export function isMarketAccumulationWindow(): boolean {
  const h = getIstHour();
  const m = getIstMinutes();
  const t = h * 60 + m; // minutes since midnight
  return t >= 9 * 60 + 15 && t <= 15 * 60 + 30;
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Cache a daily price snapshot in memory (no DB write).
 * During market hours this accumulates; after 4 PM the bulk flush writes
 * everything to `daily_prices` in one upsert.
 *
 * @param ticker  Stock symbol (e.g. "RELIANCE")
 * @param price   OHLCV snapshot
 * @param tradeDate  Optional date override (defaults to today IST)
 */
export function cacheDailyPrice(
  ticker: string,
  price: { open: number; high: number; low: number; close: number; volume: number },
  tradeDate?: Date,
): void {
  const ist = getIstNow();
  const day = tradeDate ?? new Date(ist.getFullYear(), ist.getMonth(), ist.getDate());
  state.prices.set(ticker.toUpperCase(), {
    ticker: ticker.toUpperCase(),
    tradeDate: day,
    open: price.open,
    high: price.high,
    low: price.low,
    close: price.close,
    volume: price.volume,
  });
}

/**
 * Flush all accumulated daily prices to the database in one bulk upsert.
 * Returns { rows, errors }.
 */
export async function flushDailyPricesToDb(): Promise<{ rows: number; errors: number }> {
  const records = Array.from(state.prices.values());
  if (records.length === 0) return { rows: 0, errors: 0 };

  // Day key check — reset if a new IST day started
  const currentDayKey = getIstDayKey();
  if (state.dayKey && state.dayKey !== currentDayKey) {
    logger.info({ msg: "Daily price cache: new IST day, resetting", prevDay: state.dayKey, newDay: currentDayKey });
    state.prices.clear();
    state.dayKey = currentDayKey;
  }
  state.dayKey = currentDayKey;

  const start = Date.now();
  let errors = 0;

  try {
    const CHUNK = 200;
    let written = 0;

    for (let i = 0; i < records.length; i += CHUNK) {
      const chunk = records.slice(i, i + CHUNK);
      try {
        const values: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;

        for (const rec of chunk) {
          const dateStr = rec.tradeDate.toISOString().split("T")[0];
          values.push(`($${paramIdx}, $${paramIdx + 1}::date, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6})`);
          params.push(rec.ticker, dateStr, rec.open, rec.high, rec.low, rec.close, rec.volume);
          paramIdx += 7;
        }

        const sql = `
          INSERT INTO daily_prices (ticker, "tradeDate", open, high, low, close, volume)
          VALUES ${values.join(", ")}
          ON CONFLICT (ticker, "tradeDate")
          DO UPDATE SET
            open = EXCLUDED.open,
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            close = EXCLUDED.close,
            volume = EXCLUDED.volume
        `;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (prisma as any).$executeRawUnsafe(sql, ...params);
        written += chunk.length;
      } catch (err) {
        errors += chunk.length;
        logger.error({
          msg: "Daily price cache: chunk flush failed",
          chunkStart: i,
          chunkSize: chunk.length,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const durationMs = Date.now() - start;
    state.flushCount++;
    state.lastFlushAt = new Date().toISOString();
    state.lastFlushRows = written;
    state.totalRowsWritten += written;
    state.lastError = errors > 0 ? `${errors} rows failed` : null;

    logger.info({
      msg: "Daily price cache: flushed to daily_prices",
      rows: written,
      errors,
      durationMs,
      totalFlushes: state.flushCount,
    });

    state.prices.clear();
    return { rows: written, errors };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.lastError = msg;
    logger.error({ msg: "Daily price cache: flush failed", error: msg });
    return { rows: 0, errors: records.length };
  }
}

/**
 * Get the current daily price cache status (for the admin DB Health tab).
 */
export function getDailyPriceCacheStatus() {
  return {
    cachedSymbols: state.prices.size,
    flushCount: state.flushCount,
    lastFlushAt: state.lastFlushAt,
    lastFlushRows: state.lastFlushRows,
    totalRowsWritten: state.totalRowsWritten,
    lastError: state.lastError,
    isAccumulationWindow: isMarketAccumulationWindow(),
    isPostMarket: isPostMarket(),
  };
}

/**
 * Auto-flush timer: checks every 5 minutes after 4 PM IST.
 * Called from instrumentation.ts on server start.
 */
let flushTimer: NodeJS.Timeout | null = null;

export function startDailyPriceFlushTimer(): void {
  if (flushTimer) return;

  flushTimer = setInterval(() => {
    if (isPostMarket() && state.prices.size > 0) {
      flushDailyPricesToDb().catch((err) =>
        logger.error({ msg: "Daily price auto-flush failed", error: err instanceof Error ? err.message : String(err) }),
      );
    }
  }, 5 * 60_000);

  logger.info({ msg: "Daily price flush timer started (5min interval, triggers after 4pm IST)" });
}

/** Stop the auto-flush timer (test hook). */
export function stopDailyPriceFlushTimer(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}
