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

import { existsSync } from "fs";
import path from "path";
import initSqlJs, { type Database } from "sql.js";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { isDbUnavailableError, type DbErrorType } from "@/lib/db-utils";
import { dbOpsCounter, dbErrorCounts, getIstDayKey } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/**
 * Resolve the sql.js WASM binary path at runtime.
 *
 * Rationale: `sql.js` is kept as a `serverExternalPackage` in next.config.ts
 * so `require("sql.js")` loads from real `node_modules` and the module's own
 * default `locateFile` works. As a belt-and-suspenders fallback (bundled
 * builds, other deploy layouts), explicitly resolve the file from the two most
 * likely runtime locations before letting sql.js use its default.
 */
function resolveSqlWasm(file: string): string {
  const candidates = [
    path.join(process.cwd(), "node_modules", "sql.js", "dist", file),
    path.join(process.cwd(), "public", file),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return file;
}

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
    opsPersistTimer: null as ReturnType<typeof setInterval> | null,
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
  opsPersistTimer: ReturnType<typeof setInterval> | null;
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
    totalOperations: number;
    planLimit: number;
    planOperationsRemaining: number;
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
  /** Get latest daily price snapshot for a symbol (tier-2 quote read). */
  getDailyPriceSnapshot(symbol: string): Record<string, unknown> | null;
  /** Write a daily price snapshot in-process (zero Prisma ops). */
  setDailyPriceSnapshot(rec: {
    symbol: string;
    tradeDate: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }): void;
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
  /** Persist the Prisma ops counter snapshot into SQLite (`_backup_meta`). */
  persistOpsCounter(): void;
  /** Restore the Prisma ops counter from SQLite when it matches today (IST). */
  restoreOpsCounter(): void;
  /** Persist the Prisma per-type DB error counts into SQLite (`_backup_meta`). */
  persistDbErrorCounts(): void;
  /** Restore the Prisma per-type DB error counts when they match today (IST). */
  restoreDbErrorCounts(): void;
}

let _instance: SqliteFallback | null = null;

// Cache of the resolved sql.js module so admin backup/restore can construct a
// fresh in-memory DB from exported bytes without re-running initSqlJs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _SQL: any = null;

/**
 * Get the resolved sql.js module (initSqlJs). Cached after the first call.
 * Returns null if WASM resolution failed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSqlJs(): Promise<any> {
  if (_SQL) return _SQL;
  const SQL = await initSqlJs({ locateFile: resolveSqlWasm });
  _SQL = SQL;
  return SQL;
}

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

let _initPromise: Promise<void> | null = null;

/**
 * Ensure the SQLite backup layer is initialized, retrying on demand.
 *
 * Unlike getSqliteFallback() (which just creates the object from an ALREADY
 * initialized db), this actively drives init when the layer is not ready:
 * boot-time init in instrumentation.ts can fail (e.g. sql.js WASM hiccup,
 * schema race), and this lets the admin DB-health route re-trigger it on the
 * next request instead of serving "SQLite Not Ready" forever. Idempotent —
 * concurrent callers share one in-flight init; a failed attempt is NOT
 * memoized so the next call retries. Never throws.
 */
export async function ensureSqliteBackup(): Promise<SqliteFallback | null> {
  if (state.ready) return getSqliteFallback();
  if (!_initPromise) {
    _initPromise = initSqliteBackup()
      .catch((err) => {
        // initSqliteBackup already swallows its own errors; belt-and-suspenders
        // so a rejected init never propagates to the admin route.
        logger.error({ msg: "SQLite: ensure init failed", error: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => {
        _initPromise = null;
      });
  }
  await _initPromise;
  return getSqliteFallback();
}

// ---------------------------------------------------------------------------
// Daily price snapshot tier (cache → SQLite → Prisma)
// ---------------------------------------------------------------------------
// Closed-market / after-hours quote reads resolve from the in-process SQLite
// snapshot WITHOUT hitting Prisma/Accelerate, then fall through to Prisma only
// when the snapshot is missing. Writes go to SQLite only (zero Prisma ops).

export interface DailyPriceSnapshot {
  symbol: string;
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Read the latest daily price snapshot for a symbol from SQLite (or null). */
export function getSqliteDailyPriceSnapshot(symbol: string): DailyPriceSnapshot | null {
  const s = getSqliteFallback();
  if (!s) return null;
  const raw = s.getDailyPriceSnapshot(symbol);
  if (!raw) return null;
  return {
    symbol: raw.symbol as string,
    tradeDate: raw.tradeDate as string,
    open: raw.open as number,
    high: raw.high as number,
    low: raw.low as number,
    close: raw.close as number,
    volume: raw.volume as number,
  };
}

/** Cache a daily price snapshot into SQLite in-process (zero Prisma ops). */
export function cacheDailyPriceSnapshot(rec: DailyPriceSnapshot): void {
  // Lazy-init so the quote path can warm this tier even before the full
  // background sync completes (never throws, retries on next call).
  if (!getSqliteFallback()) {
    ensureSqliteBackup().then((s) => s?.setDailyPriceSnapshot(rec)).catch(() => {});
    return;
  }
  getSqliteFallback()?.setDailyPriceSnapshot(rec);
}

// ---------------------------------------------------------------------------
// Backup / restore (admin DB-health)
// ---------------------------------------------------------------------------
// The SQLite backup is an IN-MEMORY sql.js database — there is no physical
// file to copy. "Download latest backup" exports the in-memory DB to a binary
// .sqlite blob (db.export()); "Upload + apply restore" parses an uploaded blob
// into a fresh in-memory DB and swaps it in as the active fallback. Restores
// are validated (correct header + expected core tables) before swap.

const MAX_RESTORE_BYTES = 50 * 1024 * 1024; // 50 MB upload cap

/** Export the in-memory SQLite backup as a binary .sqlite Uint8Array (or null). */
export function exportSqliteBackup(): Uint8Array | null {
  if (!state.db) return null;
  try {
    return state.db.export();
  } catch (err) {
    logger.error({ msg: "SQLite: export backup failed", error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Apply a restored SQLite backup: validate + parse the uploaded bytes into a
 * fresh in-memory DB and swap it in as the active fallback. The new DB must
 * contain the core snapshot tables; otherwise the restore is rejected.
 *
 * @param bytes uploaded .sqlite blob
 * @returns { db, tables } count of tables found for reporting
 */
export async function restoreSqliteBackup(bytes: Uint8Array): Promise<{ db: number; missing: string[] }> {
  if (bytes.byteLength > MAX_RESTORE_BYTES) {
    throw new Error(`Restore file too large (max ${Math.floor(MAX_RESTORE_BYTES / 1024 / 1024)} MB)`);
  }
  // Validate: SQLite files start with the "SQLite format 3\0" magic header.
  const magic = [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00];
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) {
      throw new Error("Invalid SQLite file (missing SQLite header)");
    }
  }

  const SQL = await getSqlJs();
  const candidate = new SQL.Database(bytes);
  const tables = candidate.exec("SELECT name FROM sqlite_master WHERE type='table'");
  const tableNames: string[] = [];
  if (tables.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tableNames.push(...(tables[0].values as any[]).map((row: any) => String(row[0])));
  }
  // Require the core fallback tables so we never swap in an empty/foreign DB.
  const required = ["_backup_meta", "daily_recommendation_run"];
  const missing = required.filter((t) => !tableNames.includes(t));
  if (missing.length) {
    candidate.close();
    throw new Error(`Restore rejected: backup missing table(s): ${missing.join(", ")}`);
  }

  // Swap: close the old in-memory DB and rebind the fallback to the restored one.
  try {
    state.db?.close();
  } catch {
    // ignore close errors on the old DB
  }
  state.db = candidate;
  state.ready = true;
  _instance = createFallback(candidate);
  logger.info({ msg: "SQLite restored from backup", tables: tableNames.length });
  return { db: tableNames.length, missing };
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

  -- Daily price snapshots (v3.21.x quote tiering: cache → SQLite → Prisma).
  -- In-process read store so closed-market quote lookups (SSE poll, portfolio,
  -- alerts) can resolve from sql.js without hitting Prisma/Accelerate. Seeded
  -- during syncFromPrisma from the latest daily_prices row per ticker and
  -- written in-process by the quote path (cacheDailyPriceSnapshot). Zero Prisma
  -- ops in the read path.
  CREATE TABLE IF NOT EXISTS daily_price_snapshot (
    symbol     TEXT PRIMARY KEY,
    trade_date TEXT,
    open       REAL,
    high       REAL,
    low        REAL,
    close      REAL,
    volume     INTEGER,
    updated_at TEXT
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
    const SQL = await getSqlJs();
    const db = new SQL.Database();
    state.db = db;

    // Create all tables (multi-statement split on ;)
    const stmts = SCHEMA_SQL.split(";").map((s) => s.trim()).filter(Boolean);
    for (const stmt of stmts) {
      db.run(stmt);
    }

    state.ready = true;
    _instance = createFallback(db);
    // Restore the persisted Prisma ops counter (same IST day) so the admin
    // dashboard survives restarts/deploys on the same day. Same for the
    // per-type DB error counts (v3.21.1).
    restoreOpsCounter();
    restoreDbErrorCounts();
    logger.info({ msg: "SQLite backup initialized" });

    // Sync from Prisma on startup (non-blocking); persist a fresh ops snapshot
    // after the sync completes so the dashboard reflects the latest state.
    await syncFromPrisma().catch((err) => {
      logger.error({ msg: "SQLite initial sync failed", error: err instanceof Error ? err.message : String(err) });
    });
    try {
      persistOpsCounter();
      persistDbErrorCounts();
    } catch {
      // non-fatal
    }

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
      } else {
        // Non-DB errors (e.g. model not found) mean the connection works
        state.prismaAvailable = true;
      }
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
// Prisma ops-counter persistence
// ---------------------------------------------------------------------------
// The Prisma plan limit counts ALL operations (reads + writes), but the
// in-memory `dbOpsCounter` resets on every process restart / deploy, so the
// admin dashboard never matches the Prisma dashboard's day totals. We persist
// a snapshot of the counter into the SQLite backup (key `ops_counter`) every
// 60s and restore it after init when the persisted day matches today (IST).
// Writes go to the local SQLite only -- zero Prisma ops added.

const OPS_PERSIST_INTERVAL_MS = 60 * 1000;
const OPS_COUNTER_KEY = "ops_counter";

interface PersistedOpsCounter {
  day: string;
  reads: number;
  writes: number;
}

/** Persist the current in-memory Prisma ops counter into the SQLite backup. */
export function persistOpsCounter(): void {
  if (!state.db || !state.ready) return;
  try {
    const snapshot: PersistedOpsCounter = {
      day: getIstDayKey(),
      reads: dbOpsCounter.reads,
      writes: dbOpsCounter.writes,
    };
    state.db.run("INSERT OR REPLACE INTO _backup_meta (key, value) VALUES (?, ?)", [
      OPS_COUNTER_KEY,
      JSON.stringify(snapshot),
    ]);
  } catch (err) {
    logger.error({ msg: "SQLite: persist ops counter failed", error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Restore the persisted Prisma ops counter into memory IF it was persisted
 * for the same IST day the process is currently on. Stale (yesterday) or
 * missing snapshots are ignored so a fresh day starts at zero.
 */
export function restoreOpsCounter(): void {
  if (!state.db || !state.ready) return;
  try {
    const result = state.db.exec("SELECT value FROM _backup_meta WHERE key = ? LIMIT 1", [OPS_COUNTER_KEY]);
    if (!result.length || !result[0].values.length) return;
    const raw = result[0].values[0][0];
    if (typeof raw !== "string") return;
    const persisted = JSON.parse(raw) as PersistedOpsCounter;
    if (persisted.day !== getIstDayKey()) return;
    dbOpsCounter.reads = Math.max(dbOpsCounter.reads, persisted.reads || 0);
    dbOpsCounter.writes = Math.max(dbOpsCounter.writes, persisted.writes || 0);
  } catch (err) {
    logger.error({ msg: "SQLite: restore ops counter failed", error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Start a background timer that snapshots the Prisma ops counter AND the
 * per-type DB error counts into SQLite every 60s. Idempotent. Called from
 * instrumentation.ts at boot.
 */
export function startOpsCounterPersistence(): void {
  if (state.opsPersistTimer) return;
  state.opsPersistTimer = setInterval(() => {
    persistOpsCounter();
    persistDbErrorCounts();
  }, OPS_PERSIST_INTERVAL_MS);
}

/** Stop the ops-counter persistence timer. For graceful shutdown / tests. */
export function stopOpsCounterPersistence(): void {
  if (state.opsPersistTimer) {
    clearInterval(state.opsPersistTimer);
    state.opsPersistTimer = null;
  }
}

/**
 * Test hook — reset the backup layer to a fresh (not-ready) state so tests can
 * exercise re-initialization / retry paths deterministically. Clears timers
 * and mutates the shared state object IN PLACE (a naive `g.__sqliteBackup = …`
 * replacement would orphan the module's captured `state` binding).
 */
export function resetSqliteStateForTests(): void {
  stopRecoveryProbe();
  stopOpsCounterPersistence();
  state.db = null;
  state.ready = false;
  state.syncing = false;
  state.prismaAvailable = true;
  state.lastSyncAt = null;
  state.lastProbeAt = null;
  state.syncHistory = [];
  _instance = null;
  _initPromise = null;
}

// ---------------------------------------------------------------------------
// DB error-count persistence (v3.21.1)
// ---------------------------------------------------------------------------
// The per-type DB error summary (lib/prisma.ts dbErrorCounts) also lives only
// in memory, so a deploy/restart would zero the dashboard buckets even though
// the ring-buffer error log (last 50) is empty too. Same pattern as the ops
// counter: snapshot into `_backup_meta` key `db_error_counts` every 60s and
// restore after init when the persisted day matches today (IST). Writes go to
// the local SQLite only — zero Prisma ops added.

const DB_ERROR_COUNTS_KEY = "db_error_counts";

interface PersistedDbErrorCounts {
  day: string;
  counts: Record<DbErrorType, number>;
}

/** Persist the current in-memory Prisma DB error counts into the SQLite backup. */
export function persistDbErrorCounts(): void {
  if (!state.db || !state.ready) return;
  try {
    const snapshot: PersistedDbErrorCounts = {
      day: getIstDayKey(),
      counts: { ...dbErrorCounts.counts },
    };
    state.db.run("INSERT OR REPLACE INTO _backup_meta (key, value) VALUES (?, ?)", [
      DB_ERROR_COUNTS_KEY,
      JSON.stringify(snapshot),
    ]);
  } catch (err) {
    logger.error({ msg: "SQLite: persist db error counts failed", error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Restore the persisted per-type DB error counts into memory IF they were
 * persisted for the same IST day the process is currently on. Stale (yesterday)
 * or missing snapshots are ignored so a fresh day starts at zero.
 */
export function restoreDbErrorCounts(): void {
  if (!state.db || !state.ready) return;
  try {
    const result = state.db.exec("SELECT value FROM _backup_meta WHERE key = ? LIMIT 1", [DB_ERROR_COUNTS_KEY]);
    if (!result.length || !result[0].values.length) return;
    const raw = result[0].values[0][0];
    if (typeof raw !== "string") return;
    const persisted = JSON.parse(raw) as PersistedDbErrorCounts;
    if (persisted.day !== getIstDayKey()) return;
    const merged = persisted.counts || {};
    for (const key of Object.keys(dbErrorCounts.counts) as DbErrorType[]) {
      const persistedValue = merged[key];
      if (typeof persistedValue === "number" && persistedValue > (dbErrorCounts.counts[key] || 0)) {
        dbErrorCounts.counts[key] = persistedValue;
      }
    }
  } catch (err) {
    logger.error({ msg: "SQLite: restore db error counts failed", error: err instanceof Error ? err.message : String(err) });
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

    // --- Sync daily price snapshots (latest row per ticker) ---
    totalRows += await syncTable(db, "daily_price_snapshot", async () => {
      const rows = await prisma.$queryRaw<Array<{
        ticker: string;
        tradeDate: Date;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number | null;
      }>>`
        SELECT DISTINCT ON (ticker) ticker, "tradeDate", open, high, low, close, volume
        FROM daily_prices
        ORDER BY ticker, "tradeDate" DESC
      `;
      return {
        columns: "symbol, trade_date, open, high, low, close, volume, updated_at",
        placeholders: "?,?,?,?,?,?,?,?",
        rows: rows.map((r) => [
          r.ticker.toUpperCase(),
          r.tradeDate.toISOString().split("T")[0],
          Number(r.open ?? 0),
          Number(r.high ?? 0),
          Number(r.low ?? 0),
          Number(r.close ?? 0),
          r.volume != null ? Number(r.volume) : 0,
          new Date().toISOString(),
        ]),
      };
    });

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

    // --- Daily price snapshot (tier-2 quote read; zero Prisma ops) ---
    getDailyPriceSnapshot(symbol: string): Record<string, unknown> | null {
      try {
        const rows = db.exec(
          "SELECT symbol, trade_date, open, high, low, close, volume FROM daily_price_snapshot WHERE symbol = ? LIMIT 1",
          [symbol.toUpperCase()],
        );
        if (!rows.length || !rows[0].values.length) return null;
        const cols = rows[0].columns;
        const vals = rows[0].values[0];
        const r: Record<string, unknown> = {};
        cols.forEach((c, i) => (r[c] = vals[i]));
        return {
          symbol: r.symbol as string,
          tradeDate: r.trade_date as string,
          open: Number(r.open ?? 0),
          high: Number(r.high ?? 0),
          low: Number(r.low ?? 0),
          close: Number(r.close ?? 0),
          volume: Number(r.volume ?? 0),
        };
      } catch (err) {
        logger.error({ msg: "SQLite: getDailyPriceSnapshot failed", symbol, error: err instanceof Error ? err.message : String(err) });
        return null;
      }
    },

    setDailyPriceSnapshot(rec): void {
      try {
        const stmt = db.prepare(
          `INSERT INTO daily_price_snapshot (symbol, trade_date, open, high, low, close, volume, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(symbol) DO UPDATE SET
             trade_date = excluded.trade_date,
             open = excluded.open,
             high = excluded.high,
             low = excluded.low,
             close = excluded.close,
             volume = excluded.volume,
             updated_at = excluded.updated_at`,
        );
        stmt.run([
          rec.symbol.toUpperCase(),
          rec.tradeDate,
          rec.open,
          rec.high,
          rec.low,
          rec.close,
          rec.volume,
          new Date().toISOString(),
        ]);
        stmt.free();
      } catch (err) {
        logger.error({ msg: "SQLite: setDailyPriceSnapshot failed", symbol: rec.symbol, error: err instanceof Error ? err.message : String(err) });
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
      const planLimit = Number(process.env.DB_PLAN_LIMIT_OPS) || 10_000;
      const totalOperations = dbOpsCounter.reads + dbOpsCounter.writes;

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
          totalOperations,
          planLimit,
          planOperationsRemaining: Math.max(0, planLimit - totalOperations),
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
    persistOpsCounter,
    restoreOpsCounter,
    persistDbErrorCounts,
    restoreDbErrorCounts,
  };
}
