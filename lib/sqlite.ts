// lib/sqlite.ts
//
// Lightweight SQLite backup layer using sql.js (pure-JS, no native deps).
//
// Purpose: when the primary Prisma Postgres is unavailable (plan limit
// exceeded, connection errors, proxy outages), user-facing routes can read
// from this local SQLite database that is periodically synced from Prisma.
//
// Recovery: a background probe runs every 5 minutes when the DB is detected
// as unavailable. When Prisma recovers, a full sync is triggered automatically.
//
// Usage:
//   import { getSqliteFallback } from "@/lib/sqlite";
//   const sqlite = getSqliteFallback();
//   if (sqlite) {
//     const data = sqlite.getLatestRecommendations();
//     const health = sqlite.getHealthStatus();
//   }

import initSqlJs, { type Database } from "sql.js";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { isDbUnavailableError } from "@/lib/db-utils";
import { dbOpsCounter } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
if (!g.__sqliteBackup) {
  g.__sqliteBackup = {
    db: null as Database | null,
    ready: false as boolean,
    syncing: false as boolean,
    prismaAvailable: true as boolean,
    lastSyncAt: null as string | null,
    lastProbeAt: null as string | null,
    syncHistory: [] as Array<{ at: string; rowsSynced: number; durationMs: number; error?: string }>,
    probeTimer: null as ReturnType<typeof setInterval> | null,
  };
}
const state: {
  db: Database | null;
  ready: boolean;
  syncing: boolean;
  prismaAvailable: boolean;
  lastSyncAt: string | null;
  lastProbeAt: string | null;
  syncHistory: Array<{ at: string; rowsSynced: number; durationMs: number; error?: string }>;
  probeTimer: ReturnType<typeof setInterval> | null;
} = g.__sqliteBackup;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncResult {
  at: string;
  rowsSynced: number;
  durationMs: number;
  error?: string;
}

export interface HealthStatus {
  prisma: {
    available: boolean;
    lastProbeAt: string | null;
    reads: number;
    writes: number;
    writeBudget: number;
    writeBudgetExceeded: boolean;
    writeBudgetRemaining: number;
  };
  sqlite: {
    ready: boolean;
    syncing: boolean;
    lastSyncAt: string | null;
    tables: Record<string, number>;
    recentSyncs: SyncResult[];
  };
}

export interface SqliteFallback {
  /** Whether the SQLite backup has data and is ready to serve queries. */
  isReady(): boolean;
  /** Get latest recommendations run + stocks. */
  getLatestRecommendations(): Record<string, unknown> | null;
  /** Get chartink screener definitions. */
  getChartinkScreeners(): Array<Record<string, unknown>>;
  /** Get corporate actions (recent). */
  getCorporateActions(limit?: number): Array<Record<string, unknown>>;
  /** Get recent server logs. */
  getServerLogs(limit?: number): Array<Record<string, unknown>>;
  /** Get recent audit logs. */
  getAuditLogs(limit?: number): Array<Record<string, unknown>>;
  /** Get cron jobs. */
  getCronJobs(): Array<Record<string, unknown>>;
  /** Get recent cron runs. */
  getCronRuns(limit?: number): Array<Record<string, unknown>>;
  /** Get worker statuses. */
  getWorkerStatuses(): Array<Record<string, unknown>>;
  /** Get recent worker tasks. */
  getWorkerTasks(limit?: number): Array<Record<string, unknown>>;
  /** Get full health status for admin dashboard. */
  getHealthStatus(): HealthStatus;
  /** Trigger a sync from Prisma -> SQLite. */
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

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
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

  CREATE TABLE IF NOT EXISTS worker_status (
    worker_id      TEXT PRIMARY KEY,
    worker_name    TEXT,
    status         TEXT,
    current_task_id TEXT,
    tasks_completed INTEGER,
    tasks_failed   INTEGER,
    last_heartbeat TEXT,
    cpu_usage      REAL,
    memory_usage   REAL,
    created_at     TEXT
  );

  CREATE TABLE IF NOT EXISTS server_log (
    id         TEXT PRIMARY KEY,
    level      TEXT,
    message    TEXT,
    source     TEXT,
    task_id    TEXT,
    metadata   TEXT,
    request_id TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id              TEXT PRIMARY KEY,
    user_id         INTEGER,
    user_email      TEXT,
    action          TEXT,
    resource        TEXT,
    resource_id     TEXT,
    method          TEXT,
    path            TEXT,
    response_status INTEGER,
    response_time   INTEGER,
    ip_address      TEXT,
    metadata        TEXT,
    error_message   TEXT,
    created_at      TEXT
  );

  CREATE TABLE IF NOT EXISTS cron_job (
    id              TEXT PRIMARY KEY,
    name            TEXT,
    description     TEXT,
    task_type       TEXT,
    cron_expression TEXT,
    is_active       INTEGER,
    last_run        TEXT,
    next_run        TEXT,
    run_count       INTEGER,
    success_count   INTEGER,
    failure_count   INTEGER,
    created_at      TEXT
  );

  CREATE TABLE IF NOT EXISTS cron_run (
    id         TEXT PRIMARY KEY,
    job_name   TEXT,
    status     TEXT,
    started_at TEXT,
    ended_at   TEXT,
    duration_ms INTEGER,
    error      TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS worker_task (
    id           TEXT PRIMARY KEY,
    name         TEXT,
    task_type    TEXT,
    status       TEXT,
    priority     INTEGER,
    started_at   TEXT,
    completed_at TEXT,
    error        TEXT,
    triggered_by TEXT,
    created_at   TEXT
  );
`;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

/**
 * Initialize the SQLite backup database. Called once from instrumentation.ts
 * or on first request. Non-blocking -- sync happens in background.
 */
export async function initSqliteBackup(): Promise<void> {
  if (state.db) return;

  try {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    state.db = db;

    // Create all tables (multi-statement split on ;)
    const stmts = SCHEMA_SQL.split(";").map((s) => s.trim()).filter(Boolean);
    for (const stmt of stmts) {
      db.run(stmt);
    }

    state.ready = true;
    _instance = createFallback(db);
    logger.info({ msg: "SQLite backup initialized" });

    // Sync from Prisma on startup (non-blocking)
    await syncFromPrisma().catch((err) => {
      logger.error({ msg: "SQLite initial sync failed", error: err instanceof Error ? err.message : String(err) });
    });

    // Start background recovery probe
    startRecoveryProbe();
  } catch (err) {
    logger.error({ msg: "SQLite backup init failed", error: err instanceof Error ? err.message : String(err) });
    state.ready = false;
  }
}

// ---------------------------------------------------------------------------
// Background recovery probe
// ---------------------------------------------------------------------------

const PROBE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Start a background timer that probes Prisma every 5 minutes.
 * When Prisma recovers after being unavailable, triggers a full sync.
 */
function startRecoveryProbe(): void {
  if (state.probeTimer) return;

  state.probeTimer = setInterval(async () => {
    if (state.syncing) return;

    try {
      // Lightweight probe: try to read one row from any table
      await prisma.cronJob.findFirst({ select: { id: true }, take: 1 });
      const wasUnavailable = !state.prismaAvailable;
      state.prismaAvailable = true;

      // If DB was previously unavailable and now recovered, trigger sync
      if (wasUnavailable) {
        logger.info({ msg: "SQLite: Prisma recovered, triggering re-sync" });
        await syncFromPrisma();
      }
    } catch (err) {
      if (isDbUnavailableError(err)) {
        state.prismaAvailable = false;
        logger.debug({ msg: "SQLite: Prisma probe still unavailable" });
      }
      // Non-DB errors (e.g. model not found) mean the connection works
      state.prismaAvailable = true;
    }

    state.lastProbeAt = new Date().toISOString();
  }, PROBE_INTERVAL_MS);
}

/**
 * Stop the background recovery probe. Called on graceful shutdown.
 */
export function stopRecoveryProbe(): void {
  if (state.probeTimer) {
    clearInterval(state.probeTimer);
    state.probeTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Sync Prisma -> SQLite
// ---------------------------------------------------------------------------

/**
 * Sync data from Prisma -> SQLite. Called on startup, after writes, and
 * when Prisma recovers. Non-fatal -- failures are logged but don't crash.
 */
export async function syncFromPrisma(): Promise<void> {
  if (!state.db || state.syncing) return;
  state.syncing = true;
  const startTime = Date.now();
  let totalRows = 0;

  try {
    const db = state.db;
    const syncErr: string[] = [];

    // --- Sync latest recommendation runs (last 30 days) ---
    totalRows += await syncTable(db, "daily_recommendation_run", async () => {
      const runs = await prisma.dailyRecommendationRun.findMany({
        orderBy: { createdAt: "desc" },
        take: 30,
      });
      return {
        columns: "id, run_date, status, total_screeners, unique_stocks, ai_processed, execution_time_ms, triggered_by, metadata",
        placeholders: "?,?,?,?,?,?,?,?,?",
        rows: runs.map((r) => [
          r.id,
          r.runDate?.toISOString() ?? null,
          r.status,
          r.totalScreeners,
          r.uniqueStocks,
          r.aiProcessed,
          r.executionTimeMs,
          r.triggeredBy ?? null,
          r.metadata ? JSON.stringify(r.metadata) : null,
        ]),
      };
    });

    // --- Sync latest recommendation stocks (from most recent run) ---
    totalRows += await syncTable(db, "daily_recommendation_stock", async () => {
      const latestRun = await prisma.dailyRecommendationRun.findFirst({
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (!latestRun) return null;
      const stocks = await prisma.dailyRecommendationStock.findMany({
        where: { runId: latestRun.id },
        orderBy: { symbol: "asc" },
      });
      return {
        columns: "id, run_id, symbol, price, change_val, change_percent, volume, ai_recommendation, confidence, target_price, stop_loss, time_horizon, reasoning, risk_factors, screener_attribution, screener_count, created_at",
        placeholders: "?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?",
        rows: stocks.map((s) => [
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
        ]),
      };
    });

    // --- Sync corporate actions (last 90 days) ---
    totalRows += await syncTable(db, "corporate_action", async () => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 90);
      const actions = await prisma.corporateAction.findMany({
        where: { exDate: { gte: cutoff } },
        orderBy: { exDate: "desc" },
        take: 2000,
      });
      return {
        columns: "id, symbol, company_name, series, subject, action_type, ex_date, record_date, face_value, ratio, dividend_per_share, dividend_yield, source",
        placeholders: "?,?,?,?,?,?,?,?,?,?,?,?,?",
        rows: actions.map((a) => [
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
        ]),
      };
    });

    // --- Sync chartink screener definitions ---
    totalRows += await syncTable(db, "chartink_screener", async () => {
      const screeners = await prisma.chartinkScreener.findMany({
        orderBy: [{ categoryId: "asc" }, { name: "asc" }],
      });
      return {
        columns: "id, name, url, category_id, category_name, scan_clause, enabled, result_count, last_run_at, next_run_at",
        placeholders: "?,?,?,?,?,?,?,?,?,?",
        rows: screeners.map((s) => [
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
        ]),
      };
    });

    // --- Sync worker status (current heartbeat state) ---
    totalRows += await syncTable(db, "worker_status", async () => {
      const workers = await prisma.workerStatus.findMany({
        orderBy: { lastHeartbeat: "desc" },
      });
      return {
        columns: "worker_id, worker_name, status, current_task_id, tasks_completed, tasks_failed, last_heartbeat, cpu_usage, memory_usage, created_at",
        placeholders: "?,?,?,?,?,?,?,?,?,?",
        rows: workers.map((w) => [
          w.workerId,
          w.workerName,
          w.status,
          w.currentTaskId,
          w.tasksCompleted,
          w.tasksFailed,
          w.lastHeartbeat?.toISOString() ?? null,
          w.cpuUsage,
          w.memoryUsage,
          w.createdAt?.toISOString() ?? null,
        ]),
      };
    });

    // --- Sync recent server logs (last 200) ---
    totalRows += await syncTable(db, "server_log", async () => {
      const logs = await prisma.serverLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return {
        columns: "id, level, message, source, task_id, metadata, request_id, created_at",
        placeholders: "?,?,?,?,?,?,?,?",
        rows: logs.map((l) => [
          l.id,
          l.level,
          l.message,
          l.source,
          l.taskId,
          l.metadata ? JSON.stringify(l.metadata) : null,
          l.requestId,
          l.createdAt?.toISOString() ?? null,
        ]),
      };
    });

    // --- Sync recent audit logs (last 200) ---
    totalRows += await syncTable(db, "audit_log", async () => {
      const logs = await prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return {
        columns: "id, user_id, user_email, action, resource, resource_id, method, path, response_status, response_time, ip_address, metadata, error_message, created_at",
        placeholders: "?,?,?,?,?,?,?,?,?,?,?,?,?,?",
        rows: logs.map((l) => [
          l.id,
          l.userId,
          l.userEmail,
          l.action,
          l.resource,
          l.resourceId,
          l.method,
          l.path,
          l.responseStatus,
          l.responseTime,
          l.ipAddress,
          l.metadata ? JSON.stringify(l.metadata) : null,
          l.errorMessage,
          l.createdAt?.toISOString() ?? null,
        ]),
      };
    });

    // --- Sync cron jobs ---
    totalRows += await syncTable(db, "cron_job", async () => {
      const jobs = await prisma.cronJob.findMany({
        orderBy: { createdAt: "asc" },
      });
      return {
        columns: "id, name, description, task_type, cron_expression, is_active, last_run, next_run, run_count, success_count, failure_count, created_at",
        placeholders: "?,?,?,?,?,?,?,?,?,?,?,?",
        rows: jobs.map((j) => [
          j.id,
          j.name,
          j.description,
          j.taskType,
          j.cronExpression,
          j.isActive ? 1 : 0,
          j.lastRun?.toISOString() ?? null,
          j.nextRun?.toISOString() ?? null,
          j.runCount,
          j.successCount,
          j.failureCount,
          j.createdAt?.toISOString() ?? null,
        ]),
      };
    });

    // --- Recent cron runs (from cron_job.lastRun tracking — no separate CronRun model in Prisma) ---
    // The cron_run table exists as a placeholder for future use. For now, only cron_job tracks runs.
    db.run("DELETE FROM cron_run");

    // --- Sync recent worker tasks (last 50) ---
    totalRows += await syncTable(db, "worker_task", async () => {
      const tasks = await prisma.workerTask.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          name: true,
          taskType: true,
          status: true,
          priority: true,
          startedAt: true,
          completedAt: true,
          error: true,
          triggeredBy: true,
          createdAt: true,
        },
      });
      return {
        columns: "id, name, task_type, status, priority, started_at, completed_at, error, triggered_by, created_at",
        placeholders: "?,?,?,?,?,?,?,?,?,?",
        rows: tasks.map((t) => [
          t.id,
          t.name,
          t.taskType,
          t.status,
          t.priority,
          t.startedAt?.toISOString() ?? null,
          t.completedAt?.toISOString() ?? null,
          t.error,
          t.triggeredBy,
          t.createdAt?.toISOString() ?? null,
        ]),
      };
    });

    // Update sync metadata
    const now = new Date().toISOString();
    db.run("INSERT OR REPLACE INTO _backup_meta (key, value) VALUES ('last_synced_at', ?)", [now]);
    db.run("INSERT OR REPLACE INTO _backup_meta (key, value) VALUES ('total_rows_synced', ?)", [String(totalRows)]);

    const durationMs = Date.now() - startTime;
    state.lastSyncAt = now;
    state.syncHistory.push({ at: now, rowsSynced: totalRows, durationMs });
    if (state.syncHistory.length > 20) state.syncHistory.shift();

    if (syncErr.length > 0) {
      logger.warn({ msg: "SQLite: sync complete with partial failures", tables: syncErr, totalRows, durationMs });
    } else {
      logger.info({ msg: "SQLite: sync complete", totalRows, durationMs });
    }
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    state.syncHistory.push({ at: new Date().toISOString(), rowsSynced: totalRows, durationMs, error: errorMsg });
    if (state.syncHistory.length > 20) state.syncHistory.shift();
    logger.error({ msg: "SQLite: sync failed", error: errorMsg });
  } finally {
    state.syncing = false;
  }
}

// ---------------------------------------------------------------------------
// Sync helper: delete-then-insert for a single table
// ---------------------------------------------------------------------------

type SyncData = {
  columns: string;
  placeholders: string;
  rows: unknown[][];
} | null;

async function syncTable(
  db: Database,
  tableName: string,
  fetchData: () => Promise<SyncData>,
): Promise<number> {
  try {
    const data = await fetchData();
    if (!data || data.rows.length === 0) {
      db.run(`DELETE FROM ${tableName}`);
      return 0;
    }
    db.run(`DELETE FROM ${tableName}`);
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO ${tableName} (${data.columns}) VALUES (${data.placeholders})`,
    );
    for (const row of data.rows) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stmt.run(row as any[]);
    }
    stmt.free();
    return data.rows.length;
  } catch (err) {
    logger.warn({
      msg: `SQLite: failed to sync ${tableName}`,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Fallback query helpers
// ---------------------------------------------------------------------------

function createFallback(db: Database): SqliteFallback {
  return {
    isReady: () => state.ready,

    // --- Recommendations ---
    getLatestRecommendations(): Record<string, unknown> | null {
      try {
        const runRow = db.exec(
          "SELECT * FROM daily_recommendation_run ORDER BY run_date DESC LIMIT 1",
        );
        if (!runRow.length || !runRow[0].values.length) return null;

        const cols = runRow[0].columns;
        const vals = runRow[0].values[0];
        const run: Record<string, unknown> = {};
        cols.forEach((c, i) => (run[c] = vals[i]));

        const stockRows = db.exec(
          "SELECT * FROM daily_recommendation_stock WHERE run_id = ? ORDER BY symbol ASC",
          [run.id as string],
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
          latestRun: { id: run.id, runDate: run.run_date, status: run.status },
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

    // --- Chartink screeners ---
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

    // --- Corporate actions ---
    getCorporateActions(limit = 500): Array<Record<string, unknown>> {
      try {
        const rows = db.exec(
          "SELECT * FROM corporate_action ORDER BY ex_date DESC LIMIT ?",
          [limit],
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

    // --- Server logs ---
    getServerLogs(limit = 100): Array<Record<string, unknown>> {
      try {
        const rows = db.exec(
          "SELECT * FROM server_log ORDER BY created_at DESC LIMIT ?",
          [limit],
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

    // --- Audit logs ---
    getAuditLogs(limit = 100): Array<Record<string, unknown>> {
      try {
        const rows = db.exec(
          "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?",
          [limit],
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

    // --- Cron jobs ---
    getCronJobs(): Array<Record<string, unknown>> {
      try {
        const rows = db.exec("SELECT * FROM cron_job ORDER BY name ASC");
        if (!rows.length) return [];
        const cols = rows[0].columns;
        return rows[0].values.map((row) => {
          const obj: Record<string, unknown> = {};
          cols.forEach((c, i) => (obj[c] = row[i]));
          obj.is_active = Boolean(obj.is_active);
          return obj;
        });
      } catch {
        return [];
      }
    },

    // --- Cron runs ---
    getCronRuns(limit = 50): Array<Record<string, unknown>> {
      try {
        const rows = db.exec(
          "SELECT * FROM cron_run ORDER BY created_at DESC LIMIT ?",
          [limit],
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

    // --- Worker statuses ---
    getWorkerStatuses(): Array<Record<string, unknown>> {
      try {
        const rows = db.exec("SELECT * FROM worker_status ORDER BY last_heartbeat DESC");
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

    // --- Worker tasks ---
    getWorkerTasks(limit = 50): Array<Record<string, unknown>> {
      try {
        const rows = db.exec(
          "SELECT * FROM worker_task ORDER BY created_at DESC LIMIT ?",
          [limit],
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

    // --- Health status ---
    getHealthStatus(): HealthStatus {
      const budget = Number(process.env.DB_WRITE_BUDGET) || 8_000;

      // Count rows in each table
      const tables: Record<string, number> = {};
      const tableNames = [
        "daily_recommendation_run",
        "daily_recommendation_stock",
        "corporate_action",
        "chartink_screener",
        "worker_status",
        "server_log",
        "audit_log",
        "cron_job",
        "cron_run",
        "worker_task",
      ];
      for (const t of tableNames) {
        try {
          const result = db.exec(`SELECT COUNT(*) as cnt FROM ${t}`);
          tables[t] = result.length && result[0].values.length ? Number(result[0].values[0][0]) : 0;
        } catch {
          tables[t] = 0;
        }
      }

      return {
        prisma: {
          available: state.prismaAvailable,
          lastProbeAt: state.lastProbeAt,
          reads: dbOpsCounter.reads,
          writes: dbOpsCounter.writes,
          writeBudget: budget,
          writeBudgetExceeded: dbOpsCounter.writes >= budget,
          writeBudgetRemaining: Math.max(0, budget - dbOpsCounter.writes),
        },
        sqlite: {
          ready: state.ready,
          syncing: state.syncing,
          lastSyncAt: state.lastSyncAt,
          tables,
          recentSyncs: [...state.syncHistory].reverse().slice(0, 10),
        },
      };
    },

    syncFromPrisma,
  };
}
