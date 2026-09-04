// lib/services/historicalPriceSyncService.ts
//
// Historical price sync into the MAIN `daily_prices` table.
//
// Why: v3.6.0's market-sync cron syncs the stock LIST + corporate actions +
// screeners but NOT daily OHLCV bars. On prod, `daily_prices` holds 0-1 rows
// per symbol, so every momentum indicator in the Swing tab renders "—"
// (computeIndicatorsFromSeries needs >= 2 bars; momentum 10/20 needs more).
//
// This service backfills / refreshes N-day windows of EQ bars per symbol from
// NSE's generateSecurityWiseHistoricalData into daily_prices with idempotent
// upserts (PK ticker + "tradeDate"), a small inter-symbol delay to respect NSE
// rate limits, per-symbol error tolerance, and a dry-run mode.
//
// NOTE: unlike the backtest chain (backtestDataService), bars ARE written to
// the main daily_prices table here — that is the entire point. Re-runs are
// safe (ON CONFLICT DO UPDATE) and never delete rows.
//
// Raw SQL uses the camelCase "tradeDate" column — Prisma maps model fields to
// table columns verbatim (AGENTS.md raw-SQL rule).

import logger from "@/lib/logger";
import { fetchSecurityWiseHistoricalData } from "@/lib/nse-api";
import type { SecurityWiseHistoricalBar } from "@/lib/nse-api";

export interface HistoricalPriceSyncOptions {
  /** Explicit symbol scope. Default: resolveSyncScope() (NIFTY 50 ∪ recent trackers ∪ captured screeners). */
  symbols?: string[];
  /** Calendar days of history to fetch (default 180). */
  days?: number;
  /** DD-MM-YYYY override (wins over days). */
  from?: string;
  /** DD-MM-YYYY override (default today). */
  to?: string;
  /** Cap on the resolved scope (default 300). */
  maxSymbols?: number;
  /** Series filter passed to the NSE fetcher (default "EQ"). */
  series?: string;
  /** Pause between symbols to respect NSE rate limits (default 200ms). */
  fetchDelayMs?: number;
  /** When true, fetch + count but never write (script default; service default false). */
  dryRun?: boolean;
  /** Hard stop: stop fetching new symbols after this many ms (background-cap guard). */
  maxDurationMs?: number;
  /** Override the DB client (tests). */
  db?: { $executeRawUnsafe: (sql: string, ...values: unknown[]) => Promise<unknown> };
}

export interface HistoricalPriceSyncResult {
  scope: string[];
  fetchedSymbols: number;
  barsFetched: number;
  barsWritten: number;
  dryRun: boolean;
  errors: Array<{ symbol: string; error: string }>;
  durationMs: number;
}

const DEFAULT_DAYS = 180;
const DEFAULT_MAX_SYMBOLS = 50; // NIFTY 50 only (was 300 — too many DB ops for plan limit)
const DEFAULT_FETCH_DELAY_MS = 200;
const UPSERT_CHUNK_SIZE = 200;

// ─── Pure helpers ─────────────────────────────────────────────────────────

/** Format a Date as DD-MM-YYYY (the NSE historical endpoint's date format). */
export function formatNseDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

/**
 * Resolve the fetch window. Explicit from/to win; otherwise `days` calendar
 * days back from today. Throws on an invalid/inverted window.
 */
export function buildDateRange(opts: { days?: number; from?: string; to?: string }): { from: string; to: string } {
  const days = opts.days ?? DEFAULT_DAYS;
  const to = opts.to ?? formatNseDate(new Date());
  const from = opts.from ?? formatNseDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000));

  if (!/^\d{2}-\d{2}-\d{4}$/.test(from) || !/^\d{2}-\d{2}-\d{4}$/.test(to)) {
    throw new Error(`Invalid date range: from=${from} to=${to} (expected DD-MM-YYYY)`);
  }

  const fromMs = new Date(from.split("-").reverse().join("-")).getTime();
  const toMs = new Date(to.split("-").reverse().join("-")).getTime();
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs > toMs) {
    throw new Error(`Invalid date range: from=${from} to=${to} (from must be <= to)`);
  }

  return { from, to };
}

/** Trim, uppercase, de-duplicate, drop empties. */
export function dedupeSymbols(symbols: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of symbols) {
    const clean = (s ?? "").trim().toUpperCase();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

/**
 * Resolve the symbol scope to sync.
 * - Explicit list → deduped + capped.
 * - Default → NIFTY 50 constituents only. The previous scope included
 *   RecommendationTracker + ChartinkScreenerResult symbols (capped 300)
 *   but those extra DB queries + the larger symbol count consumed 3K-6K
 *   ops/day — exceeding the Prisma Postgres plan limit. Reducing to
 *   NIFTY 50 only brings the sync to ~500 ops/day. Callers can pass
 *   explicit symbols for wider coverage when needed.
 *
 * Every scope source degrades to [] on failure so a scope problem never
 * throws the whole job.
 */
export async function resolveSyncScope(explicit: string[] | undefined, maxSymbols: number): Promise<string[]> {
  if (explicit) {
    // An empty explicit list means "sync nothing" — do NOT fall back to the default scope.
    return dedupeSymbols(explicit).slice(0, maxSymbols);
  }

  // NIFTY 50 only — avoids 2 DB queries (trackers + screener results) and
  // caps the sync at ~50 symbols instead of 300.
  const indexStocks = await (await import("@/lib/index-service"))
    .getIndexStocks("NIFTY 50")
    .then((stocks: Array<{ symbol?: string }>) => stocks.map((s) => s.symbol ?? ""))
    .catch((e: unknown) => {
      logger.warn({ msg: "Historical price sync: NIFTY 50 scope fetch failed", error: e });
      return [];
    });

  return dedupeSymbols(indexStocks).slice(0, maxSymbols);
}

/**
 * Build a single multi-row upsert statement (8 params per bar) for
 * daily_prices. `$1..$8n` placeholders are PostgreSQL-native — safe for
 * prisma.$executeRawUnsafe with the pg driver adapter.
 */
export function buildUpsertSql(bars: SecurityWiseHistoricalBar[]): { sql: string; values: unknown[] } {
  const rows: string[] = [];
  const values: unknown[] = [];
  for (const b of bars) {
    const base = values.length; // 1-based offset for the next placeholder
    rows.push(
      `($${base + 1}::text, $${base + 2}::timestamptz, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`,
    );
    values.push(
      b.symbol.toUpperCase(),
      new Date(b.date),
      b.open,
      b.high,
      b.low,
      b.close,
      b.volume ? BigInt(Math.round(b.volume)) : null,
      b.vwap ?? null,
    );
  }
  const sql =
    `INSERT INTO daily_prices (ticker, "tradeDate", open, high, low, close, volume, vwap) ` +
    `VALUES ${rows.join(", ")} ` +
    `ON CONFLICT (ticker, "tradeDate") DO UPDATE SET ` +
    `open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low, ` +
    `close = EXCLUDED.close, volume = EXCLUDED.volume, vwap = EXCLUDED.vwap`;
  return { sql, values };
}

// ─── Orchestration ────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sync N days of EQ bars for the resolved scope into daily_prices.
 * Never throws for per-symbol failures — errors are collected and returned
 * (a dead ticker or a 429 must not abort the whole backfill).
 */
export async function syncHistoricalPrices(options: HistoricalPriceSyncOptions = {}): Promise<HistoricalPriceSyncResult> {
  const startedAt = Date.now();
  const days = options.days ?? DEFAULT_DAYS;
  const maxSymbols = Math.max(1, Math.min(options.maxSymbols ?? DEFAULT_MAX_SYMBOLS, 2000));
  const fetchDelayMs = Math.max(0, options.fetchDelayMs ?? DEFAULT_FETCH_DELAY_MS);
  const dryRun = options.dryRun ?? false;
  const series = options.series ?? "EQ";
  const { from, to } = buildDateRange({ days, from: options.from, to: options.to });

  const scope = await resolveSyncScope(options.symbols, maxSymbols);
  if (scope.length === 0) {
    logger.warn({ msg: "Historical price sync: empty scope — nothing to do", from, to, dryRun });
    return { scope: [], fetchedSymbols: 0, barsFetched: 0, barsWritten: 0, dryRun, errors: [], durationMs: Date.now() - startedAt };
  }

  logger.info({ msg: "Historical price sync starting", symbols: scope.length, from, to, dryRun, series });
  const db = options.db ?? (await import("@/lib/prisma")).default;

  let fetchedSymbols = 0;
  let barsFetched = 0;
  let barsWritten = 0;
  const errors: Array<{ symbol: string; error: string }> = [];

  for (let i = 0; i < scope.length; i++) {
    const symbol = scope[i];

    if (typeof options.maxDurationMs === "number" && Date.now() - startedAt > options.maxDurationMs) {
      logger.warn({ msg: "Historical price sync: maxDurationMs reached — stopping early", maxDurationMs: options.maxDurationMs });
      break;
    }

    try {
      const bars = await fetchSecurityWiseHistoricalData(symbol, from, to, series);
      if (bars.length === 0) continue; // no data / series mismatch — not an error

      fetchedSymbols++;
      barsFetched += bars.length;

      if (!dryRun) {
        // v3.28.0 SQLite-first mirror: also write the same bars to the SQLite
        // mirror so the OHLCV read path serves SQLite-first, then instant-
        // promote to Prisma. Non-fatal.
        try {
        const sqlite = await import("@/lib/sqlite");
        sqlite.cacheDailyPriceBars(
          `NSE:${symbol}`,
          bars.map((b: SecurityWiseHistoricalBar) => ({
            tradeDate: b.date || new Date(b.timestamp).toISOString().slice(0, 10),
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
            volume: b.volume,
            vwap: b.vwap,
          })),
        );
        } catch (err) {
          logger.warn({ msg: "Historical price sync: SQLite mirror write failed (non-fatal)", symbol, error: err instanceof Error ? err.message : String(err) });
        }
        for (let j = 0; j < bars.length; j += UPSERT_CHUNK_SIZE) {
          const chunk = bars.slice(j, j + UPSERT_CHUNK_SIZE);
          const { sql, values } = buildUpsertSql(chunk);
          await db.$executeRawUnsafe(sql, ...values);
        }
      }
      barsWritten += dryRun ? 0 : bars.length;
    } catch (e) {
      errors.push({ symbol, error: e instanceof Error ? e.message : String(e) });
      logger.warn({ msg: "Historical price sync: symbol failed", symbol, error: e });
    }

    if (fetchDelayMs > 0 && i < scope.length - 1) await sleep(fetchDelayMs);
  }

  // v3.28.0 end-of-task flush: promote the SQLite OHLCV mirror to Prisma.
  // Non-fatal — the 60s timer also drains it.
  if (!dryRun) {
    try {
      const sqlite = await import("@/lib/sqlite");
      await sqlite.flushNseToPrisma();
    } catch (err) {
      logger.warn({ msg: "Historical price sync: end-of-task flush failed (non-fatal)", error: err instanceof Error ? err.message : String(err) });
    }
  }

  const result: HistoricalPriceSyncResult = {
    scope,
    fetchedSymbols,
    barsFetched,
    barsWritten,
    dryRun,
    errors,
    durationMs: Date.now() - startedAt,
  };
  logger.info({ msg: "Historical price sync completed", ...result });
  return result;
}
