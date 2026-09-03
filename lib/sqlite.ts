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

import { existsSync, appendFileSync, mkdirSync, writeFileSync, readdirSync, statSync } from "fs";
import path from "path";
import initSqlJs, { type Database, type SqlValue } from "sql.js";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { isDbUnavailableError, isPlanLimitBreakerOpen, type DbErrorType } from "@/lib/db-utils";
import { dbOpsCounter, dbErrorCounts, getIstDayKey } from "@/lib/prisma";
import { resolveLogsDir } from "@/lib/logger";
import { recordRead } from "@/lib/services/readTier";

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/**
 * Resolve the sql.js WASM binary path at runtime.
 *
 * Rationale: `sql.js` is kept as a `serverExternalPackage` in next.config.ts so
 * it is NOT webpack-bundled into `.next` — the raw WASM must exist on the
 * runtime filesystem. `scripts/copy-sql-wasm.mjs` copies
 * `node_modules/sql.js/dist/sql-wasm.wasm` into `public/` during the build so
 * Netlify's deploy ships it. We resolve from the deploy layouts first:
 * 1. `public/<file>`  (shipped by the build copy — Netlify primary)
 * 2. `.next/<file>`   (Next.js also copies public/ into the .next root)
 * 3. `node_modules/<…>` (standard local install)
 * then fall back to sql.js's own default locateFile.
 */
function resolveSqlWasm(file: string): string {
  const candidates = [
    path.join(process.cwd(), ".next", file), // Netlify publish dir — populated by copy-sql-wasm-netlify.mjs
    path.join(process.cwd(), "public", file), // shipped in public/ by copy-sql-wasm.mjs
    path.join(process.cwd(), "node_modules", "sql.js", "dist", file), // standard local install
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  // Let sql.js use its own default locateFile as a final fallback.
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
    sqliteBytes: 0 as number,
    wbBuffer: [] as Array<{ kind: WriteBehindKind; row: Record<string, unknown> }>,
    wbLastFlushAt: null as string | null,
    wbLastFlushCounts: {} as Record<string, number>,
    wbLastPromoted: {} as Record<string, number>,
    wbLastRetained: {} as Record<string, number>,
    wbFlushTimer: null as ReturnType<typeof setInterval> | null,
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
  sqliteBytes: number;
  wbBuffer: Array<{ kind: WriteBehindKind; row: Record<string, unknown> }>;
  wbLastFlushAt: string | null;
  wbLastFlushCounts: Record<string, number>;
  wbLastPromoted: Record<string, number>;
  wbLastRetained: Record<string, number>;
  wbFlushTimer: ReturnType<typeof setInterval> | null;
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
    /** Approx in-memory footprint of the SQLite mirror (pure-JS sql.js heap). */
    memoryBytes: number;
  };
}

/** Write-behind queue kinds — which Prisma model a queued row maps to. */
export type WriteBehindKind = "api_request" | "server_log" | "audit_log";

/** Stats reported to the admin DB-Health page. */
export interface WriteBehindStats {
  /** Rows still queued in SQLite (SQLite-only log, 14-day TTL). */
  pending: Record<string, number>;
  /** Rows promoted to Prisma during the last drain. */
  lastPromoted: Record<string, number>;
  /** Rows retained SQLite-only (not promoted) during the last drain. */
  lastRetained: Record<string, number>;
  lastFlushAt: string | null;
  lastFlushCounts: Record<string, number>;
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
  /** Get write-behind queue records by source (e.g. `ai`) — zero Prisma reads. */
  getWriteBehindLogsBySource(
    source: string,
    limit?: number,
  ): Array<Record<string, unknown>>;
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
  /** Trigger a sync from Prisma -> SQLite (leader-gated unless `force`). */
  syncFromPrisma(opts?: { force?: boolean }): Promise<void>;
  /** Persist the Prisma ops counter snapshot into SQLite (`_backup_meta`). */
  persistOpsCounter(): void;
  /** Restore the Prisma ops counter from SQLite when it matches today (IST). */
  restoreOpsCounter(): void;
  /** Persist the Prisma per-type DB error counts into SQLite (`_backup_meta`). */
  persistDbErrorCounts(): void;
  /** Restore the Prisma per-type DB error counts when they match today (IST). */
  restoreDbErrorCounts(): void;
  /** Enqueue a log write for later bulk-flush to Prisma (zero Prisma ops). */
  enqueueWriteBehind(kind: WriteBehindKind, row: Record<string, unknown>): void;
  /** Bulk-flush pending write-behind rows to Prisma. */
  drainWriteBehind(): Promise<{ flushed: Record<string, number>; skipped: boolean }>;
  /** Pending write-behind counts + last flush metadata. */
  getWriteBehindStats(): WriteBehindStats;
  /** Admin-triggered full flush (drains buffer, drains queue, returns aggregate). */
  flushWriteBehind(): Promise<{
    flushed: Record<string, number>;
    retained: Record<string, number>;
    skipped: boolean;
    pending: Record<string, number>;
  }>;
  /**
   * Write a liveness heartbeat into the LOCAL SQLite `_backup_meta` (zero Prisma
   * ops). Used by the worker engine + cron daemon periodic pings so idle polling
   * never touches the Prisma DB.
   */
  writeLivenessHeartbeat(role: "worker" | "cron-daemon", snapshot: Record<string, unknown>): void;
  /** Read the liveness heartbeats persisted in SQLite (admin visibility). */
  getLivenessHeartbeats(): Array<Record<string, unknown>>;
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

  -- Write-behind queue tables (v3.22.0): high-frequency log writes land here
  -- (zero Prisma ops) and are bulk-flushed to Prisma via drainWriteBehind().
  -- These are SEPARATE from the read mirrors (server_log / audit_log) which
  -- syncFromPrisma populates for DB-down reads.
  CREATE TABLE IF NOT EXISTS wb_api_request (
    request_id      TEXT PRIMARY KEY,
    user_id         INTEGER,
    user_email      TEXT,
    ip_address      TEXT,
    user_agent      TEXT,
    method          TEXT,
    path            TEXT,
    query_params    TEXT,
    status_code     INTEGER,
    response_time   INTEGER,
    error_message   TEXT,
    is_nse          INTEGER,
    nse_endpoint    TEXT,
    is_rate_limited INTEGER,
    is_anomaly      INTEGER,
    anomaly_type    TEXT,
    queued_at       TEXT
  );

  CREATE TABLE IF NOT EXISTS wb_server_log (
    id         TEXT PRIMARY KEY,
    level      TEXT,
    message    TEXT,
    source     TEXT,
    task_id    TEXT,
    metadata   TEXT,
    ip_address TEXT,
    user_agent TEXT,
    request_id TEXT,
    queued_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS wb_audit_log (
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
    queued_at       TEXT
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
    // Move any pre-init buffered log writes into the queue now that SQLite is
    // ready (v3.22.0 write-behind).
    drainWriteBehindBuffer();
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

// v3.23.x (user directive): the Prisma recovery probe is now a 12-hourly
// check. Since SQLite is the primary READ tier (market data, corporate
// actions, screener, price cache, logs/audit are all served from the local
// mirror at ZERO Prisma ops), Prisma availability no longer affects request
// serving — the probe exists only to detect a held/recovered Prisma account
// so a leader can re-sync the mirror. A 12h window is acceptable: the mirror
// stays warm via the market-sync cron + write-behind promotion, and reads
// degrade gracefully throughout. This removes the ~2 ops/min the 5-min probe
// cost across instances (2880/day under the old cadence).
const PROBE_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Start a background timer that probes Prisma every 12 hours (was 5 min —
 * v3.23.x user directive: drop the frequent Prisma health check; SQLite is
 * the primary read tier and Prisma health no longer gates request serving).
 * When Prisma recovers after being unavailable, triggers a full sync.
 *
 * Leader gate (v3.22.0): only the instance holding the `sqlite-sync` leader
 * lock probes the DB, so a multi-instance deploy doesn't fire N Prisma reads
 * per interval. Non-leader instances skip the DB probe entirely (their SQLite
 * is only a local write-behind buffer anyway); when they later become leader
 * they pick up the probe on the next tick.
 */
function startRecoveryProbe(): void {
  if (state.probeTimer) return;

  state.probeTimer = setInterval(async () => {
    if (state.syncing) return;

    try {
      const leader = await import("@/lib/services/leader");
      const isSyncLeader = await leader.isLeader("sqlite-sync");
      if (!isSyncLeader) {
        // Not the sqlite-sync leader — skip the Prisma probe. The leader's
        // sync + recovery is authoritative; we stay a standby buffer.
        state.lastProbeAt = new Date().toISOString();
        return;
      }

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

/**
 * v3.23.x manual-trigger probe (admin db-health `probe_prisma` action).
 * Runs ONE explicit Prisma connectivity check NOW and updates the
 * `prismaAvailable` flag the dashboard reads. This is the ONLY on-demand
 * (non-12h) Prisma health read — the GET dashboard path stays Prisma-free.
 * Returns the outcome for the admin response.
 */
export async function probePrismaNow(): Promise<{
  available: boolean;
  latencyMs: number;
  error: string | null;
}> {
  const start = Date.now();
  try {
    await prisma.cronJob.findFirst({ select: { id: true }, take: 1 });
    state.prismaAvailable = true;
    return { available: true, latencyMs: Date.now() - start, error: null };
  } catch (err) {
    const dbDown = isDbUnavailableError(err);
    if (dbDown) state.prismaAvailable = false;
    else state.prismaAvailable = true;
    return {
      available: !dbDown,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
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
  stopWriteBehindFlush();
  state.db = null;
  state.ready = false;
  state.syncing = false;
  state.prismaAvailable = true;
  state.lastSyncAt = null;
  state.lastProbeAt = null;
  state.syncHistory = [];
  state.wbLastPromoted = {};
  state.wbLastRetained = {};
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
// Liveness heartbeats to SQLite (v3.22.0)
// ---------------------------------------------------------------------------
// The worker engine and cron daemon periodically ping to prove they're alive.
// Those pings used to `upsert` into Prisma `worker_status` — at 1-2 instances
// (leader-gated) with a 5-15 min cadence that's ~288-576 ops/day of pure idle
// noise. Now they land in the LOCAL SQLite `_backup_meta` (zero Prisma ops);
// only STATEFUL transitions (busy/task-complete/stop) still touch Prisma so
// admin dashboards and the stale-task reaper keep a correct cross-instance view.

const LIVENESS_KEY_PREFIX = "liveness_heartbeat:";

/** Write a liveness heartbeat to the local SQLite `_backup_meta`. Never throws. */
export function writeLivenessHeartbeat(
  role: "worker" | "cron-daemon",
  snapshot: Record<string, unknown>,
): void {
  if (!state.db || !state.ready) return;
  try {
    const entry = { ...snapshot, role, at: new Date().toISOString(), pid: process.pid };
    state.db.run("INSERT OR REPLACE INTO _backup_meta (key, value) VALUES (?, ?)", [
      `${LIVENESS_KEY_PREFIX}${role}`,
      JSON.stringify(entry),
    ]);
  } catch (err) {
    logger.debug({ msg: "SQLite: liveness heartbeat write failed", role, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Read all liveness heartbeats persisted in the local SQLite `_backup_meta`. */
export function getLivenessHeartbeats(): Array<Record<string, unknown>> {
  if (!state.db || !state.ready) return [];
  try {
    const result = state.db.exec("SELECT key, value FROM _backup_meta WHERE key LIKE 'liveness_heartbeat:%'");
    if (!result.length) return [];
    const cols = result[0].columns;
    return result[0].values
      .map((row) => {
        const obj: Record<string, unknown> = {};
        cols.forEach((c, i) => (obj[c] = row[i]));
        let parsed: unknown = obj.value;
        if (typeof obj.value === "string") {
          try {
            parsed = JSON.parse(obj.value);
          } catch {
            parsed = obj.value;
          }
        }
        // Return { key, ...parsedValue } for JSON values (liveness heartbeats).
        return { key: obj.key, ...(parsed && typeof parsed === "object" ? (parsed as object) : { value: parsed }) };
      });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Write-behind logging queue (v3.22.0)
// ---------------------------------------------------------------------------
// High-frequency log writes (APIRequestLog, ServerLog, AuditLog) land in local
// SQLite — ZERO Prisma ops at call time — and are bulk-flushed to Prisma by
// drainWriteBehind (nightly + on-demand admin button). This removes the
// per-request Prisma write that tripped the plan-limit breaker in the
// 2026-09-02 prod log (APIRequestLog.upsert timed out after 120000ms).

const WB_CHUNK = 250; // per-table per-pass chunk for the bulk flush
// Max chunks drained per kind per drainWriteBehind() call. Each chunk is ONE
// Prisma createMany operation (bounded and op-cheap), so draining up to 8
// chunks moves up to 2,000 rows/kind using just 8 ops. This evens out bursty
// log queues (market-hours APIRequestLog) into small, infrequent batches.
const WB_MAX_DRAIN_CHUNKS = 8;
// Queued wb_* rows older than this are pruned (see pruneWriteBehind) so the
// SQLite-only log is TTL-bounded at 14 days. api_request is the highest-volume
// kind and the same requests are already visible via the file logger + pino;
// dropping stale metrics rows is the intended tradeoff.
const WB_RETENTION_MS = 14 * 24 * 60 * 60 * 1000; // 14d TTL on the wb_* log tables
// How often the leader promotes important wb_* rows to Prisma and prunes stale
// ones (see startWriteBehindFlush). Each window = ≤1 createMany op per kind.
const WB_FLUSH_INTERVAL_MS = 15 * 60 * 1000; // 15 min
const WB_TABLES: Record<WriteBehindKind, string> = {
  api_request: "wb_api_request",
  server_log: "wb_server_log",
  audit_log: "wb_audit_log",
};

/** Insert a row into the in-memory early buffer (before SQLite is ready). */
function bufferWriteBehind(kind: WriteBehindKind, row: Record<string, unknown>): void {
  state.wbBuffer.push({ kind, row });
  // Bound the buffer so a long pre-init window can't grow unbounded.
  if (state.wbBuffer.length > 1000) {
    state.wbBuffer.splice(0, state.wbBuffer.length - 1000);
  }
}

/** Drain the early-buffer into the SQLite queue once it's ready. */
function drainWriteBehindBuffer(): void {
  if (!state.db || !state.ready || state.wbBuffer.length === 0) return;
  const pending = state.wbBuffer;
  state.wbBuffer = [];
  for (const { kind, row } of pending) {
    enqueueWriteBehind(kind, row);
  }
}

/**
 * Enqueue a log write for later bulk-flush to Prisma. Local SQLite insert,
 * sub-ms, zero Prisma ops. If SQLite isn't ready yet, buffers in memory and
 * drains once ready. Never throws — logging is best-effort.
 *
 * `api_request` dedupes on `request_id` (matches the Prisma unique on
 * `APIRequestLog.requestId`). `server_log`/`audit_log` use their client-side
 * uuid `id` so a flush is idempotent via `INSERT OR REPLACE`.
 */
export function enqueueWriteBehind(kind: WriteBehindKind, row: Record<string, unknown>): void {
  if (!state.db || !state.ready) {
    bufferWriteBehind(kind, row);
    return;
  }
  const table = WB_TABLES[kind];
  if (!table) return;
  try {
    const columns = getWbColumns(kind);
    const placeholders = columns.map(() => "?").join(", ");
    const values: SqlValue[] = columns.map((col) => toSqlValue(row[col]));
    // Include queued_at last (it's the final column); a caller-provided
    // queued_at is honored if present, else now.
    const queuedAt = (row["queued_at"] as string) ?? new Date().toISOString();
    state.db.run(
      `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}, queued_at) VALUES (${placeholders}, ?)`,
      [...values, queuedAt],
    );
  } catch (err) {
    logger.error({
      msg: `SQLite: write-behind enqueue failed (${kind})`,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Coerce a row value into a sql.js SqlValue (string | number | null). */
function toSqlValue(v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" || typeof v === "number") return v;
  if (v instanceof Date) return v.toISOString();
  // objects/arrays (e.g. metadata) are JSON-stringified so we can reload them.
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Column set for a write-behind kind, in INSERT order. */
function getWbColumns(kind: WriteBehindKind): string[] {
  switch (kind) {
    case "api_request":
      return [
        "request_id", "user_id", "user_email", "ip_address", "user_agent", "method",
        "path", "query_params", "status_code", "response_time", "error_message",
        "is_nse", "nse_endpoint", "is_rate_limited", "is_anomaly", "anomaly_type",
      ];
    case "server_log":
      return [
        "id", "level", "message", "source", "task_id", "metadata",
        "ip_address", "user_agent", "request_id",
      ];
    case "audit_log":
      return [
        "id", "user_id", "user_email", "action", "resource", "resource_id", "method",
        "path", "response_status", "response_time", "ip_address", "metadata", "error_message",
      ];
  }
}

/**
 * Bulk-flush the write-behind queue to Prisma.
 *
 * LONG-LIVED LOG STORE MODEL (v3.22.2): SQLite is the PRIMARY durable store for
 * API-request, server-log and audit-log rows. Only a filtered "important"
 * subset is PROMOTED to Prisma (for the admin monitoring UI) — the rest STAY
 * in the wb_* tables and are pruned by TTL (see pruneWriteBehind). This keeps
 * the bulk info-level log stream off the Prisma plan budget entirely (SQLite
 * writes cost 0 Prisma ops) while still surfacing errors/security events.
 *
 * Promotion rules:
 *   - api_request: is_anomaly, is_rate_limited, status_code >= 500, or has an
 *     error_message (otherwise SQLite-only).
 *   - server_log: only level "error" / "warn".
 *   - audit_log: security/critical actions (AUTH/JOIN/PASSWORD/ADMIN/SESSION
 *     or *_FAILED/*_BLOCKED) OR response_status >= 400 with an error_message.
 *
 * Promoted rows are written via ONE createMany (op-cheap) and then deleted
 * from SQLite. Non-promoted rows are left in place (SQLite-only log). Respects
 * the DB plan-limit breaker: on DB-unavailable the pass is SKIPPED.
 *
 * Returns per-table promoted ("flushed") counts, how many rows were retained
 * SQLite-only ("retained"), and whether the pass was skipped.
 */
export async function drainWriteBehind(): Promise<{
  flushed: Record<string, number>;
  retained: Record<string, number>;
  skipped: boolean;
}> {
  const flushed: Record<string, number> = { api_request: 0, server_log: 0, audit_log: 0 };
  const retained: Record<string, number> = { api_request: 0, server_log: 0, audit_log: 0 };
  if (!state.db || !state.ready) return { flushed, retained, skipped: false };

  const kinds: WriteBehindKind[] = ["api_request", "server_log", "audit_log"];
  let skipped = false;

  for (const kind of kinds) {
    const table = WB_TABLES[kind];
    try {
      // Read up to WB_MAX_DRAIN_CHUNKS × WB_CHUNK rows at once. High-frequency
      // kinds (api_request/server_log) are SQLite-primary + file-archived and
      // never promoted. Only the low-frequency audit_log subset (security/
      // critical) is promoted via ONE createMany (1 Prisma op per flush).
      const rows = readWbRows(table, WB_CHUNK * WB_MAX_DRAIN_CHUNKS);
      if (rows.length === 0) continue;

      // Continuous exportable file archive (v3.23.x): every drained row of
      // every kind is appended to logs/db-logs/<date>.ndjson so DB logs are
      // exportable exactly like server logs — with ZERO extra Prisma ops.
      appendDbLogsToArchive(kind, rows);

      const promotable = rows.filter((r) => isWbImportant(kind, r));
      retained[kind] = rows.length - promotable.length;

      if (promotable.length > 0) {
        const ok = await writeWbRowsToPrisma(kind, promotable);
        if (!ok) {
          skipped = true;
          continue; // DB down — leave ALL rows queued
        }
        // Delete ONLY the promoted rows we wrote; the retained stay in SQLite.
        deleteWbRows(table, kind, promotable);
        flushed[kind] = promotable.length;
      }
    } catch (err) {
      if (isDbUnavailableError(err)) {
        skipped = true;
      } else {
        logger.error({
          msg: `SQLite: write-behind drain failed (${kind})`,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  if (Object.values(flushed).some((n) => n > 0) || Object.values(retained).some((n) => n > 0)) {
    state.wbLastFlushAt = new Date().toISOString();
    state.wbLastFlushCounts = { ...flushed };
    state.wbLastPromoted = { ...flushed };
    state.wbLastRetained = { ...retained };
    persistWriteBehindMeta();
  }
  return { flushed, retained, skipped };
}

/** True when a queued write-behind row should be promoted to Prisma.
 *
 * v3.23.x policy (user directive): ALL high-frequency logs — api_request
 * (HTTP/NSE/rate-limit/worker) and server_log — are SQLite-first + file-archive
 * ONLY and are NEVER written to Prisma during normal operation. Only
 * low-frequency, security-sensitive audit_log rows (auth/admin/failure/critical)
 * are promoted, per "low frequency and backup to Prisma".
 */
function isWbImportant(kind: WriteBehindKind, row: Record<string, unknown>): boolean {
  switch (kind) {
    case "api_request":
      // High-frequency HTTP/NSE/worker/rate-limit log — never promoted.
      return false;
    case "server_log":
      // High-frequency service log — never promoted.
      return false;
    case "audit_log": {
      // Low-frequency, security-sensitive: promote auth/admin access + failures.
      const action = String(row.action ?? "").toUpperCase();
      const secPrefix = ["AUTH", "JOIN", "PASSWORD", "ADMIN", "SESSION", "LOGIN", "LOGOUT"].some((p) =>
        action.startsWith(p),
      );
      if (secPrefix) return true;
      if (action.endsWith("_FAILED") || action.endsWith("_BLOCKED") || action.endsWith("_REJECTED")) return true;
      // Server-side errors on an audit action are worth surfacing too.
      if (Number(row.response_status) >= 400 && typeof row.error_message === "string" && row.error_message.length > 0) {
        return true;
      }
      return false;
    }
  }
}

/** Read up to `limit` pending rows from a wb_* table (oldest first). */
function readWbRows(table: string, limit: number): Array<Record<string, unknown>> {
  const result = state.db!.exec(`SELECT * FROM ${table} ORDER BY queued_at ASC LIMIT ${limit}`);
  if (!result.length) return [];
  const cols = result[0].columns;
  return result[0].values.map((vals) =>
    cols.reduce<Record<string, unknown>>((acc, c, i) => {
      acc[c] = vals[i];
      return acc;
    }, {}),
  );
}

/**
 * Write the queued rows to Prisma, chunked. Returns false if DB unavailable.
 *
 * OPS ACCOUNTING (v3.22.1 fix): a `createMany` is ONE query-engine operation
 * regardless of row count, and the `$allOperations` extension in lib/prisma.ts
 * already increments `dbOpsCounter.writes++` once per call. The pre-v3.22.1
 * code ALSO added `dbOpsCounter.writes += chunk.length` here, which over-counted
 * each flush by (rows-1) — flushing 6,000 queued log rows recorded ~6,000
 * phantom writes for just 24 real ops, burning the plan budget on the dashboard
 * without touching the DB. That manual increment is removed so the counter
 * reflects TRUE Prisma operations (createMany = 1 write op).
 */
async function writeWbRowsToPrisma(kind: WriteBehindKind, rows: Array<Record<string, unknown>>): Promise<boolean> {
  const data = rows.map((r) => mapWbToPrisma(kind, r));
  try {
    for (let i = 0; i < data.length; i += WB_CHUNK) {
      const chunk = data.slice(i, i + WB_CHUNK);
      await createManyWb(kind, chunk);
    }
    return true;
  } catch (err) {
    if (isDbUnavailableError(err)) return false;
    throw err;
  }
}

/**
 * Dispatch a bulk createMany to the correct Prisma delegate (avoids union-call).
 *
 * v3.23.x policy guard: api_request and server_log are SQLite-primary +
 * file-archived and are NEVER written to Prisma. This dispatcher hard-refuses
 * them so the "no high-frequency logs in Prisma" invariant can't be broken by a
 * future isWbImportant change — only audit_log (low-frequency/security) lands.
 */
function createManyWb(kind: WriteBehindKind, chunk: Array<Record<string, unknown>>): Promise<{ count: number }> {
  switch (kind) {
    case "api_request":
      return Promise.reject(
        new Error("api_request is SQLite-primary; never written to Prisma (v3.23.x policy)"),
      );
    case "server_log":
      return Promise.reject(
        new Error("server_log is SQLite-primary; never written to Prisma (v3.23.x policy)"),
      );
    case "audit_log":
      return prisma.auditLog.createMany({ data: chunk as never, skipDuplicates: true });
  }
}

function mapWbToPrisma(kind: WriteBehindKind, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) continue;
    switch (k) {
      case "user_id": out.userId = v; break;
      case "user_email": out.userEmail = v; break;
      case "ip_address": out.ipAddress = v; break;
      case "user_agent": out.userAgent = v; break;
      case "method": out.method = v; break;
      case "path": out.path = v; break;
      case "query_params": out.queryParams = v; break;
      case "status_code": out.statusCode = v; break;
      case "response_time": out.responseTime = v; break;
      case "error_message": out.errorMessage = v; break;
      case "is_nse": out.isNSE = !!v; break;
      case "nse_endpoint": out.nseEndpoint = v; break;
      case "is_rate_limited": out.isRateLimited = !!v; break;
      case "is_anomaly": out.isAnomaly = !!v; break;
      case "anomaly_type": out.anomalyType = v; break;
      case "task_id": out.taskId = v; break;
      case "resource_id": out.resourceId = v; break;
      case "response_status": out.responseStatus = v; break;
      // metadata is already a JSON string in SQLite — parse for Prisma Json.
      case "metadata": out.metadata = parseWbJson(v as string); break;
      case "request_id": out.requestId = v; break;
      default:
        // Pass through same-name fields (id, level, message, source, action,
        // resource, created_at handled below).
        if (k === "created_at") out.createdAt = new Date(v as string);
        else out[k] = v;
    }
  }
  return out;
}

function parseWbJson(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/** Delete the exact flushed rows from SQLite (by PK). */
function deleteWbRows(table: string, kind: WriteBehindKind, rows: Array<Record<string, unknown>>): void {
  const pk =
    kind === "api_request"
      ? "request_id"
      : "id";
  const ids = rows
    .map((r) => r[pk])
    .filter((v): v is string | number => typeof v === "string" || typeof v === "number");
  if (ids.length === 0) return;
  try {
    state.db!.run(`DELETE FROM ${table} WHERE ${pk} IN (${ids.map((_, i) => `?${i + 1}`).join(", ")})`, ids);
  } catch (err) {
    logger.error({
      msg: `SQLite: write-behind delete failed (${kind})`,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// DB-log file archive (v3.23.x WP-E2)
// ---------------------------------------------------------------------------
// The user asked for DB logs (the write-behind `api_request` / `server_log` /
// `audit_log` stream) to be exportable as FILES, exactly like server logs live
// in `logs/YYYY-MM/date.log`. Every drain appendends ALL drained rows (both the
// promoted-to-Prisma subset and the retained-in-SQLite subset) as NDJSON lines
// to `logs/db-logs/YYYY-MM-DD.ndjson`. This gives a durable, file-based,
// exportable copy of the DB-log stream with ZERO extra Prisma ops (it's a pure
// filesystem append mirroring the server-log pattern).

function dbLogsArchiveDir(): string | null {
  const base = resolveLogsDir();
  if (!base) return null;
  const dir = path.join(base, "db-logs");
  try {
    mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return null;
  }
}

/** Append drained DB-log rows to the dated NDJSON archive file. Never throws. */
function appendDbLogsToArchive(
  kind: WriteBehindKind,
  rows: Array<Record<string, unknown>>,
): void {
  if (!state.db || !state.ready || rows.length === 0) return;
  const dir = dbLogsArchiveDir();
  if (!dir) return;
  const today = new Date().toISOString().split("T")[0];
  const file = path.join(dir, `${today}.ndjson`);
  try {
    const lines = rows.map((r) => {
      const entry: Record<string, unknown> = { kind, ts: new Date().toISOString(), ...r };
      try {
        return JSON.stringify(entry);
      } catch {
        return null;
      }
    });
    const body = lines.filter((l): l is string => l !== null).join("\n") + (lines.length ? "\n" : "");
    appendFileSync(file, body, "utf8");
  } catch (err) {
    // File archive is best-effort — a full disk / read-only FS (serverless)
    // must never break the write-behind drain.
    logger.warn({
      msg: "SQLite: DB-log NDJSON archive append failed (best-effort, skipped)",
      kind,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** v3.23.x: list DB-log NDJSON archive files (like getLogFiles). */
export function getDbLogFiles(): { date: string; path: string; size: number }[] {
  const dir = dbLogsArchiveDir();
  if (!dir) return [];
  try {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".ndjson"))
      .map((f) => {
        const p = path.join(dir, f);
        return { date: f.replace(".ndjson", ""), path: p, size: statSync(p).size };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  }
}

/** v3.23.x: read the last N lines of a DB-log archive file (like readLogFile). */
export function readDbLogFile(filePath: string, limit: number = 1000): string[] {
  try {
    const { readFileSync } = require("fs");
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, "utf8");
    const lines = content.split("\n").filter((l: string) => l.trim().length > 0);
    return lines.slice(-limit);
  } catch {
    return [];
  }
}

/** v3.23.x: serialize a DB-log kind's current SQLite rows as NDJSON (for export). */
export function exportDbLogsAsNdjson(kind: WriteBehindKind): string {
  if (!state.db || !state.ready) return "";
  const table = WB_TABLES[kind];
  try {
    const rows = readWbRows(table, 100000);
    if (rows.length === 0) return "";
    return rows
      .map((r) => {
        try {
          return JSON.stringify({ kind, ...r });
        } catch {
          return null;
        }
      })
      .filter((l): l is string => l !== null)
      .join("\n") + "\n";
  } catch (err) {
    logger.error({
      msg: `SQLite: DB-log NSJSON export failed (${kind})`,
      error: err instanceof Error ? err.message : String(err),
    });
    return "";
  }
}

/** Pending write-behind counts + last flush metadata (for DB-Health page). */
export function getWriteBehindStats(): WriteBehindStats {
  const pending: Record<string, number> = { api_request: 0, server_log: 0, audit_log: 0 };
  if (state.db && state.ready) {
    for (const kind of Object.keys(WB_TABLES) as WriteBehindKind[]) {
      try {
        const res = state.db.exec(`SELECT COUNT(*) as cnt FROM ${WB_TABLES[kind]}`);
        pending[kind] = res.length && res[0].values.length ? Number(res[0].values[0][0]) : 0;
      } catch {
        pending[kind] = 0;
      }
    }
  } else {
    // Count buffered items (not queued yet).
    for (const b of state.wbBuffer) pending[b.kind] = (pending[b.kind] || 0) + 1;
  }
  return {
    pending,
    lastPromoted: { ...state.wbLastPromoted },
    lastRetained: { ...state.wbLastRetained },
    lastFlushAt: state.wbLastFlushAt,
    lastFlushCounts: { ...state.wbLastFlushCounts },
  };
}

/** Persist last-flush metadata to `_backup_meta` so figures survive restarts. */
function persistWriteBehindMeta(): void {
  if (!state.db || !state.ready) return;
  try {
    state.db.run("INSERT OR REPLACE INTO _backup_meta (key, value) VALUES ('wb_flush_at', ?)", [
      state.wbLastFlushAt ?? null,
    ]);
    state.db.run("INSERT OR REPLACE INTO _backup_meta (key, value) VALUES ('wb_flush_counts', ?)", [
      JSON.stringify(state.wbLastFlushCounts),
    ]);
  } catch {
    // non-fatal
  }
}

/** Public wrapper for the admin route — awaits readiness, drains, returns aggregate. */
export async function flushWriteBehind(): Promise<{
  flushed: Record<string, number>;
  retained: Record<string, number>;
  skipped: boolean;
  pending: Record<string, number>;
}> {
  drainWriteBehindBuffer();
  const res = await drainWriteBehind();
  return { ...res, pending: getWriteBehindStats().pending };
}

// ---------------------------------------------------------------------------
// Write-behind TTL prune + periodic leader flush
// ---------------------------------------------------------------------------

/** Prune wb_* rows older than the 14-day retention window (SQLite-only log TTL). */
export function pruneWriteBehind(): Record<string, number> {
  const pruned: Record<string, number> = { api_request: 0, server_log: 0, audit_log: 0 };
  if (!state.db || !state.ready) return pruned;
  const cutoff = new Date(Date.now() - WB_RETENTION_MS).toISOString();
  for (const kind of Object.keys(WB_TABLES) as WriteBehindKind[]) {
    try {
      const table = WB_TABLES[kind];
      // Collect the ids older than the cutoff, then delete by PK (the in-memory
      // sql.js DB doesn't support parameterized DELETE with a subquery in the
      // test mock, so we resolve ids here).
      const res = state.db.exec(`SELECT * FROM ${table} WHERE queued_at < ?`, [cutoff]);
      if (!res.length || !res[0].values.length) continue;
      const cols = res[0].columns;
      const pkIdx = cols.indexOf(kind === "api_request" ? "request_id" : "id");
      const oldRows = res[0].values.map((vals) =>
        cols.reduce<Record<string, unknown>>((acc, c, i) => {
          acc[c] = vals[i];
          return acc;
        }, {}),
      );
      deleteWbRows(table, kind, oldRows);
      pruned[kind] = oldRows.length;
    } catch {
      // non-fatal
    }
  }
  if (Object.values(pruned).some((n) => n > 0)) {
    logger.info({ msg: "SQLite: pruned stale write-behind rows", pruned });
  }
  return pruned;
}

/**
 * Periodic leader-gated write-behind flush + TTL prune. Runs every
 * WB_FLUSH_INTERVAL_MS (15 min) on the sqlite-sync leader only, so a
 * multi-instance Netlify deploy promotes "important" log rows to Prisma and
 * prunes stale rows exactly once per window instead of once per instance.
 *
 * Data-loss/whiplash note: the pre-v3.22.2 flush was effectively ad-hoc (manual
 * admin button), so queued logs only reached Prisma on manual flush or were
 * lost on deploy. This timer closes that gap cheaply — each drain promotes at
 * most WB_MAX_DRAIN_CHUNKS chunks (ONE createMany op per kind per window).
 */
export function startWriteBehindFlush(): void {
  if (state.wbFlushTimer) return;
  state.wbFlushTimer = setInterval(() => {
    void (async () => {
      // Leader-only, but degrade to running when the DB is down so queued
      // retention still prunes and we don't fully halt on a DB outage.
      try {
        const leader = await import("@/lib/services/leader");
        if (!(await leader.isLeader("sqlite-sync"))) return;
        await drainWriteBehind();
        pruneWriteBehind();
      } catch (err) {
        logger.warn({
          msg: "SQLite: periodic write-behind flush skipped",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }, WB_FLUSH_INTERVAL_MS);
}

/** Stop the periodic write-behind flush timer. For graceful shutdown / tests. */
export function stopWriteBehindFlush(): void {
  if (state.wbFlushTimer) {
    clearInterval(state.wbFlushTimer);
    state.wbFlushTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Sync Prisma -> SQLite
// ---------------------------------------------------------------------------

/**
 * Sync data from Prisma -> SQLite. Called on startup, after writes, and
 * when Prisma recovers. Non-fatal -- failures are logged but don't crash.
 *
 * Leader gate (v3.22.0): when called with `opts.force`, always sync (used by
 * the admin "Sync Now" button / manual trigger). Otherwise, only the instance
 * that holds the `sqlite-sync` leader lock performs the sync, so a
 * multi-instance deploy doesn't run N concurrent full synchs at boot. If the
 * DB is unavailable the gate degrades (leader.ts returns true) and sync
 * proceeds only as far as individual tables allow.
 */
export async function syncFromPrisma(opts?: { force?: boolean }): Promise<void> {
  if (!state.db || state.syncing) return;
  if (!opts?.force) {
    // lazy require to keep the module graph light at init (avoids a hard cycle)
    const leader = await import("@/lib/services/leader");
    const isSyncLeader = await leader.isLeader("sqlite-sync");
    if (!isSyncLeader) {
      logger.info({
        msg: "SQLite sync skipped — this instance is not the sqlite-sync leader",
        self: leader.LEADER_SELF,
      });
      return;
    }
    // v3.23.x (user directive): when the Prisma plan-limit breaker is OPEN
    // (account on hold / DB down), do NOT touch Prisma at all — the SQLite
    // read mirror already holds the last-known-good copy of every synced table
    // (cached). prod logs showed ×7-per-cycle "failed to sync X =
    // Plan limit circuit breaker open" spam because every sync cycle hammered a
    // held DB just to re-read mirrors that were already current. The mirror is
    // only refreshed once Prisma recovers (breaker closes) or on an explicit
    // admin `force` (deploy_prep / sync button). This keeps the whole app
    // read-servable from SQLite during a hold — the exact intent of the
    // SQLite-primary policy.
    if (isPlanLimitBreakerOpen()) {
      logger.info({
        msg: "SQLite sync skipped — Prisma plan-limit breaker open (serving cached SQLite mirror)",
        self: leader.LEADER_SELF,
      });
      return;
    }
  }
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

    // Refresh the in-memory size probe once per hydration (cheap: only runs on
    // deploy/recovery, never on the read path).
    try {
      state.sqliteBytes = db.export().byteLength;
    } catch {
      state.sqliteBytes = 0;
    }

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

function recordSqliteRead(
  name: string,
  startMs: number,
  rows: number,
  hit: boolean,
): void {
  recordRead(name, {
    source: "sqlite",
    latencyMs: Math.max(0, Math.round(performance.now() - startMs)),
    rows,
    hit,
  });
}

function createFallback(db: Database): SqliteFallback {
  return {
    isReady: () => state.ready,

    // --- Recommendations ---
    getLatestRecommendations(): Record<string, unknown> | null {
      const _start = performance.now();
      try {
        const runRow = db.exec(
          "SELECT * FROM daily_recommendation_run ORDER BY run_date DESC LIMIT 1",
        );
        if (!runRow.length || !runRow[0].values.length) {
          recordSqliteRead("getLatestRecommendations", _start, 0, false);
          return null;
        }

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

        const out = {
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
        recordSqliteRead("getLatestRecommendations", _start, stocks.length, true);
        return out;
      } catch (err) {
        logger.error({ msg: "SQLite: getLatestRecommendations failed", error: err instanceof Error ? err.message : String(err) });
        return null;
      }
    },

    // --- Chartink screeners ---
    getChartinkScreeners(): Array<Record<string, unknown>> {
      const _start = performance.now();
      try {
        const rows = db.exec("SELECT * FROM chartink_screener ORDER BY category_id ASC, name ASC");
        if (!rows.length) {
          recordSqliteRead("getChartinkScreeners", _start, 0, false);
          return [];
        }
        const cols = rows[0].columns;
        const out = rows[0].values.map((row) => {
          const obj: Record<string, unknown> = {};
          cols.forEach((c, i) => (obj[c] = row[i]));
          obj.enabled = Boolean(obj.enabled);
          return obj;
        });
        recordSqliteRead("getChartinkScreeners", _start, out.length, true);
        return out;
      } catch {
        recordSqliteRead("getChartinkScreeners", _start, 0, false);
        return [];
      }
    },

    // --- Daily price snapshot (tier-2 quote read; zero Prisma ops) ---
    getDailyPriceSnapshot(symbol: string): Record<string, unknown> | null {
      const _start = performance.now();
      try {
        const rows = db.exec(
          "SELECT symbol, trade_date, open, high, low, close, volume FROM daily_price_snapshot WHERE symbol = ? LIMIT 1",
          [symbol.toUpperCase()],
        );
        if (!rows.length || !rows[0].values.length) {
          recordSqliteRead("getDailyPriceSnapshot", _start, 0, false);
          return null;
        }
        const cols = rows[0].columns;
        const vals = rows[0].values[0];
        const r: Record<string, unknown> = {};
        cols.forEach((c, i) => (r[c] = vals[i]));
        recordSqliteRead("getDailyPriceSnapshot", _start, 1, true);
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
      const _start = performance.now();
      try {
        const rows = db.exec(
          "SELECT * FROM corporate_action ORDER BY ex_date DESC LIMIT ?",
          [limit],
        );
        if (!rows.length) {
          recordSqliteRead("getCorporateActions", _start, 0, false);
          return [];
        }
        const cols = rows[0].columns;
        const out = rows[0].values.map((row) => {
          const obj: Record<string, unknown> = {};
          cols.forEach((c, i) => (obj[c] = row[i]));
          return obj;
        });
        recordSqliteRead("getCorporateActions", _start, out.length, true);
        return out;
      } catch {
        recordSqliteRead("getCorporateActions", _start, 0, false);
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

    // --- Write-behind queue (v3.22.0) ---
    getWriteBehindLogsBySource(source: string, limit = 100): Array<Record<string, unknown>> {
      try {
        // ai-monitoring persists AI calls through enqueueWriteBehind("server_log")
        // into wb_server_log. Info-level success calls are retained SQLite-only
        // (never promoted to Prisma), so this read is what makes them visible to
        // the admin AI-monitoring page across cold starts (zero Prisma ops).
        const rows = db.exec(
          "SELECT * FROM wb_server_log WHERE source = ? ORDER BY queued_at DESC LIMIT ?",
          [source, limit],
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
      const _start = performance.now();
      try {
        const rows = db.exec("SELECT * FROM cron_job ORDER BY name ASC");
        if (!rows.length) {
          recordSqliteRead("getCronJobs", _start, 0, false);
          return [];
        }
        const cols = rows[0].columns;
        const out = rows[0].values.map((row) => {
          const obj: Record<string, unknown> = {};
          cols.forEach((c, i) => (obj[c] = row[i]));
          obj.is_active = Boolean(obj.is_active);
          return obj;
        });
        recordSqliteRead("getCronJobs", _start, out.length, true);
        return out;
      } catch {
        recordSqliteRead("getCronJobs", _start, 0, false);
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
      const _start = performance.now();
      try {
        const rows = db.exec(
          "SELECT * FROM worker_task ORDER BY created_at DESC LIMIT ?",
          [limit],
        );
        if (!rows.length) {
          recordSqliteRead("getWorkerTasks", _start, 0, false);
          return [];
        }
        const cols = rows[0].columns;
        const out = rows[0].values.map((row) => {
          const obj: Record<string, unknown> = {};
          cols.forEach((c, i) => (obj[c] = row[i]));
          return obj;
        });
        recordSqliteRead("getWorkerTasks", _start, out.length, true);
        return out;
      } catch {
        recordSqliteRead("getWorkerTasks", _start, 0, false);
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
          // In-memory footprint of the sql.js mirror (refreshed at sync time via
          // db.export().byteLength — cheap because it only runs on hydration).
          memoryBytes: state.sqliteBytes,
        },
      };
    },

    syncFromPrisma,
    persistOpsCounter,
    restoreOpsCounter,
    persistDbErrorCounts,
    restoreDbErrorCounts,
    enqueueWriteBehind,
    drainWriteBehind,
    getWriteBehindStats,
    flushWriteBehind,
    writeLivenessHeartbeat,
    getLivenessHeartbeats,
  };
}
