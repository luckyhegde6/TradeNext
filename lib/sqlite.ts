// lib/sqlite.ts
//
// Lightweight SQLite backup layer using sql.js (pure-JS, no native deps).
//
// Purpose: when the primary Prisma Postgres is unavailable (plan limit
// exceeded, connection errors, proxy outages), user-facing routes can read
// from this local SQLite database that is periodically synced from Prisma.
//
// Usage:
//   import { getSqliteFallback } from "@/lib/sqlite";
//   const sqlite = getSqliteFallback();
//   if (sqlite) { const data = sqlite.getLatestRecommendations(); }
//
// The SQLite DB is fully in-memory. Data is synced from Prisma on startup
// and after every successful write to the primary DB. If both Prisma and
// SQLite are empty (cold start + DB down), routes return empty arrays.

import initSqlJs, { type Database } from "sql.js";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
if (!g.__sqliteBackup) {
  g.__sqliteBackup = { db: null as Database | null, ready: false as boolean, syncing: false as boolean };
}
const state: { db: Database | null; ready: boolean; syncing: boolean } = g.__sqliteBackup;

export interface SqliteFallback {
  /** Whether the SQLite backup has data and is ready to serve queries. */
  isReady(): boolean;
  /** Get latest recommendations run + stocks. */
  getLatestRecommendations(): Record<string, unknown> | null;
  /** Get chartink screener definitions. */
  getChartinkScreeners(): Array<Record<string, unknown>>;
  /** Get corporate actions (recent). */
  getCorporateActions(limit?: number): Array<Record<string, unknown>>;
  /** Trigger a sync from Prisma → SQLite. */
  syncFromPrisma(): Promise<void>;
}

let _instance: SqliteFallback | null = null;

/**
 * Get (or create) the SQLite fallback singleton.
 * Returns null if sql.js initialization failed (e.g. WASM unavailable).
 */
export function getSqliteFallback(): SqliteFallback | null {
  if (_instance) return _instance;
  if (state.db) {
    _instance = createFallback(state.db);
    return _instance;
  }
  return null;
}

/**
 * Initialize the SQLite backup database. Called once from instrumentation.ts
 * or on first request. Non-blocking — sync happens in background.
 */
export async function initSqliteBackup(): Promise<void> {
  if (state.db) return; // already initialized

  try {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    state.db = db;

    // Create schema
    db.run(`
      CREATE TABLE IF NOT EXISTS _backup_meta (
        key   TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS daily_recommendation_run (
        id             TEXT PRIMARY KEY,
        run_date       TEXT,
        status         TEXT,
        total_screeners INTEGER,
        unique_stocks   INTEGER,
        ai_processed    INTEGER,
        execution_time_ms INTEGER,
        triggered_by    TEXT,
        metadata        TEXT
      );

      CREATE TABLE IF NOT EXISTS daily_recommendation_stock (
        id                TEXT PRIMARY KEY,
        run_id            TEXT,
        symbol            TEXT,
        price             REAL,
        change_val        REAL,
        change_percent    REAL,
        volume            INTEGER,
        ai_recommendation TEXT,
        confidence        REAL,
        target_price      REAL,
        stop_loss         REAL,
        time_horizon      TEXT,
        reasoning         TEXT,
        risk_factors      TEXT,
        screener_attribution TEXT,
        screener_count    INTEGER,
        created_at        TEXT
      );

      CREATE TABLE IF NOT EXISTS corporate_action (
        id               INTEGER PRIMARY KEY,
        symbol           TEXT,
        company_name     TEXT,
        series           TEXT,
        subject          TEXT,
        action_type      TEXT,
        ex_date          TEXT,
        record_date      TEXT,
        face_value       TEXT,
        ratio            TEXT,
        dividend_per_share REAL,
        dividend_yield   REAL,
        source           TEXT
      );

      CREATE TABLE IF NOT EXISTS chartink_screener (
        id           TEXT PRIMARY KEY,
        name         TEXT,
        url          TEXT,
        category_id  TEXT,
        category_name TEXT,
        scan_clause  TEXT,
        enabled      INTEGER,
        result_count INTEGER,
        last_run_at  TEXT,
        next_run_at  TEXT
      );
    `);

    state.ready = true;
    _instance = createFallback(db);
    logger.info({ msg: "SQLite backup initialized" });

    // Sync from Prisma on startup (non-blocking — failures are logged, not fatal)
    await syncFromPrisma().catch((err) => {
      logger.error({ msg: "SQLite initial sync failed", error: err instanceof Error ? err.message : String(err) });
    });
  } catch (err) {
    logger.error({ msg: "SQLite backup init failed", error: err instanceof Error ? err.message : String(err) });
    state.ready = false;
  }
}

/**
 * Sync data from Prisma → SQLite. Called on startup and after writes.
 * Non-fatal — failures are logged but don't crash the app.
 */
export async function syncFromPrisma(): Promise<void> {
  if (!state.db || state.syncing) return;
  state.syncing = true;

  try {
    const db = state.db;

    // --- Sync latest recommendation runs (last 30 days) ---
    try {
      const runs = await prisma.dailyRecommendationRun.findMany({
        orderBy: { createdAt: "desc" },
        take: 30,
      });
      db.run("DELETE FROM daily_recommendation_run");
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO daily_recommendation_run
        (id, run_date, status, total_screeners, unique_stocks, ai_processed, execution_time_ms, triggered_by, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const r of runs) {
        stmt.run([
          r.id,
          r.runDate?.toISOString() ?? null,
          r.status,
          r.totalScreeners,
          r.uniqueStocks,
          r.aiProcessed,
          r.executionTimeMs,
          r.triggeredBy ?? null,
          r.metadata ? JSON.stringify(r.metadata) : null,
        ]);
      }
      stmt.free();
      logger.debug({ msg: "SQLite: synced recommendation runs", count: runs.length });
    } catch (err) {
      logger.warn({ msg: "SQLite: failed to sync recommendation runs", error: err instanceof Error ? err.message : String(err) });
    }

    // --- Sync latest recommendation stocks (from the most recent run) ---
    try {
      const latestRun = await prisma.dailyRecommendationRun.findFirst({
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (latestRun) {
        const stocks = await prisma.dailyRecommendationStock.findMany({
          where: { runId: latestRun.id },
          orderBy: { symbol: "asc" },
        });
        db.run("DELETE FROM daily_recommendation_stock");
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO daily_recommendation_stock
          (id, run_id, symbol, price, change_val, change_percent, volume,
           ai_recommendation, confidence, target_price, stop_loss, time_horizon,
           reasoning, risk_factors, screener_attribution, screener_count, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const s of stocks) {
          stmt.run([
            s.id,
            s.runId,
            s.symbol,
            s.price,
            s.change,
            s.changePercent,
            Number(s.volume ?? 0),
            s.aiRecommendation,
            s.confidence,
            s.targetPrice,
            s.stopLoss,
            s.timeHorizon,
            s.reasoning,
            s.riskFactors != null ? JSON.stringify(s.riskFactors) : null,
            s.screenerAttribution != null ? JSON.stringify(s.screenerAttribution) : null,
            s.screenerCount,
            s.createdAt?.toISOString() ?? null,
          ]);
        }
        stmt.free();
        logger.debug({ msg: "SQLite: synced recommendation stocks", count: stocks.length });
      }
    } catch (err) {
      logger.warn({ msg: "SQLite: failed to sync recommendation stocks", error: err instanceof Error ? err.message : String(err) });
    }

    // --- Sync corporate actions (last 90 days) ---
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 90);
      const actions = await prisma.corporateAction.findMany({
        where: { exDate: { gte: cutoff } },
        orderBy: { exDate: "desc" },
        take: 2000,
      });
      db.run("DELETE FROM corporate_action");
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO corporate_action
        (id, symbol, company_name, series, subject, action_type, ex_date, record_date,
         face_value, ratio, dividend_per_share, dividend_yield, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const a of actions) {
        stmt.run([
          a.id,
          a.symbol,
          a.companyName,
          a.series,
          a.subject,
          a.actionType,
          a.exDate?.toISOString() ?? null,
          a.recordDate?.toISOString() ?? null,
          a.faceValue,
          a.ratio,
          a.dividendPerShare != null ? Number(a.dividendPerShare) : null,
          a.dividendYield != null ? Number(a.dividendYield) : null,
          a.source,
        ]);
      }
      stmt.free();
      logger.debug({ msg: "SQLite: synced corporate actions", count: actions.length });
    } catch (err) {
      logger.warn({ msg: "SQLite: failed to sync corporate actions", error: err instanceof Error ? err.message : String(err) });
    }

    // --- Sync chartink screener definitions ---
    try {
      const screeners = await prisma.chartinkScreener.findMany({
        orderBy: [{ categoryId: "asc" }, { name: "asc" }],
      });
      db.run("DELETE FROM chartink_screener");
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO chartink_screener
        (id, name, url, category_id, category_name, scan_clause, enabled, result_count, last_run_at, next_run_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const s of screeners) {
        stmt.run([
          s.id,
          s.name,
          s.url,
          s.categoryId,
          s.categoryName,
          s.scanClause,
          s.enabled ? 1 : 0,
          s.resultCount,
          s.lastRunAt?.toISOString() ?? null,
          s.nextRunAt?.toISOString() ?? null,
        ]);
      }
      stmt.free();
      logger.debug({ msg: "SQLite: synced chartink screeners", count: screeners.length });
    } catch (err) {
      logger.warn({ msg: "SQLite: failed to sync chartink screeners", error: err instanceof Error ? err.message : String(err) });
    }

    // Update sync timestamp
    db.run("INSERT OR REPLACE INTO _backup_meta (key, value) VALUES ('last_synced_at', ?)", [
      new Date().toISOString(),
    ]);

    logger.info({ msg: "SQLite: sync complete" });
  } catch (err) {
    logger.error({ msg: "SQLite: sync failed", error: err instanceof Error ? err.message : String(err) });
  } finally {
    state.syncing = false;
  }
}

// ---------------------------------------------------------------------------
// Fallback query helpers
// ---------------------------------------------------------------------------

function createFallback(db: Database): SqliteFallback {
  return {
    isReady: () => state.ready,

    getLatestRecommendations(): Record<string, unknown> | null {
      try {
        const runRow = db.exec(
          "SELECT * FROM daily_recommendation_run ORDER BY run_date DESC LIMIT 1"
        );
        if (!runRow.length || !runRow[0].values.length) return null;

        const cols = runRow[0].columns;
        const vals = runRow[0].values[0];
        const run: Record<string, unknown> = {};
        cols.forEach((c, i) => (run[c] = vals[i]));

        const stockRows = db.exec(
          "SELECT * FROM daily_recommendation_stock WHERE run_id = ? ORDER BY symbol ASC",
          [run.id as string]
        );

        let stocks: Array<Record<string, unknown>> = [];
        if (stockRows.length && stockRows[0].values.length) {
          const sCols = stockRows[0].columns;
          stocks = stockRows[0].values.map((row) => {
            const obj: Record<string, unknown> = {};
            sCols.forEach((c, i) => (obj[c] = row[i]));
            return obj;
          });
        }

        return {
          success: true,
          run: {
            id: run.id,
            runDate: run.run_date,
            status: run.status,
            totalScreeners: run.total_screeners,
            uniqueStocks: run.unique_stocks,
            aiProcessed: run.ai_processed,
            executionTimeMs: run.execution_time_ms,
          },
          latestRun: {
            id: run.id,
            runDate: run.run_date,
            status: run.status,
          },
          stocks: stocks.map((s) => ({
            symbol: s.symbol,
            price: s.price,
            change: s.change_val,
            changePercent: s.change_percent,
            volume: s.volume ?? 0,
            screenerAttribution: s.screener_attribution,
            screenerCount: s.screener_count,
            aiRecommendation: s.ai_recommendation ?? "HOLD",
            confidence: s.confidence ?? 50,
            targetPrice: s.target_price,
            stopLoss: s.stop_loss,
            timeHorizon: s.time_horizon,
            reasoning: s.reasoning,
            riskFactors: s.risk_factors,
            trackerStatus: "active",
            entryPrice: s.price,
            currentPrice: s.price,
            createdAt: s.created_at ?? new Date().toISOString(),
          })),
          source: "sqlite_backup",
          timestamp: new Date().toISOString(),
        };
      } catch (err) {
        logger.error({ msg: "SQLite: getLatestRecommendations failed", error: err instanceof Error ? err.message : String(err) });
        return null;
      }
    },

    getChartinkScreeners(): Array<Record<string, unknown>> {
      try {
        const rows = db.exec("SELECT * FROM chartink_screener ORDER BY category_id ASC, name ASC");
        if (!rows.length) return [];
        const cols = rows[0].columns;
        return rows[0].values.map((row) => {
          const obj: Record<string, unknown> = {};
          cols.forEach((c, i) => (obj[c] = row[i]));
          obj.enabled = Boolean(obj.enabled);
          return obj;
        });
      } catch {
        return [];
      }
    },

    getCorporateActions(limit = 500): Array<Record<string, unknown>> {
      try {
        const rows = db.exec(
          "SELECT * FROM corporate_action ORDER BY ex_date DESC LIMIT ?",
          [limit]
        );
        if (!rows.length) return [];
        const cols = rows[0].columns;
        return rows[0].values.map((row) => {
          const obj: Record<string, unknown> = {};
          cols.forEach((c, i) => (obj[c] = row[i]));
          return obj;
        });
      } catch {
        return [];
      }
    },

    syncFromPrisma,
  };
}
