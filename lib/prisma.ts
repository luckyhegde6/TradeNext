// Prisma client singleton - only log in development for debugging
import { PrismaClient } from '@prisma/client';
import { withAccelerate } from '@prisma/extension-accelerate';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import logger from './logger';
import { otelSetup } from './otel';

// The exported client is typed as the base PrismaClient (preserving all
// model-method typing across 400+ call sites). The RUNTIME client is extended
// with withAccelerate() (see construction above), so model reads support
// `cacheStrategy` — but the base type declares it `never`. `withAccelerateCache`
// adds it at the query boundary without degrading typing anywhere else.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AccelerateClient = PrismaClient;

// OTel must be initialized BEFORE the PrismaClient singleton is constructed
// so PrismaInstrumentation can wrap the query engine (opt-in via
// PRISMA_OTEL_ENABLED=1; no-op otherwise — see lib/otel.ts).
otelSetup();
import {
  isPlanLimitBreakerOpen,
  isPlanLimitHoldError,
  openPlanLimitBreaker,
  closePlanLimitBreaker,
  PlanLimitOpenError,
  classifyDbError,
  type DbErrorType,
} from './db-utils';

// Default cache TTL for Accelerate edge caching (seconds).
// Only effective when withAccelerate() is wired and cacheStrategy is used per-query.
// Set to 0 to disable caching globally. Queries without cacheStrategy are NOT cached.
export const ACCELERATE_CACHE_TTL =
  Number(process.env.PRISMA_ACCELERATE_CACHE_TTL) || 300; // 5 min default

// Determine environment from ENVIRONMENT env var (defaults to 'development')
// Options: local, development, production
const env = process.env.ENVIRONMENT || 'development';
const isDev = env === 'development' || env === 'local';
const isLocal = env === 'local';
const useRemoteDb = process.env.USE_REMOTE_DB === 'true';

// Database URL selection logic:
// - ENVIRONMENT=local + USE_REMOTE_DB=true → use DATABASE_REMOTE (Prisma Accelerate)
// - ENVIRONMENT=local + USE_REMOTE_DB=false → use DATABASE_URL (local PostgreSQL)  
// - ENVIRONMENT=production → use DATABASE_URL if Prisma Accelerate format, else DATABASE_REMOTE

let databaseUrl = '';

if (isLocal) {
  // Local environment - check USE_REMOTE_DB flag
  if (useRemoteDb && process.env.DATABASE_REMOTE) {
    databaseUrl = process.env.DATABASE_REMOTE;
  } else {
    // Use local DATABASE_URL (postgresql://postgres:postgres@localhost:5432/tradenext)
    databaseUrl = process.env.DATABASE_URL || '';
  }
} else {
  // Production environment - prefer DATABASE_URL if it's Prisma Accelerate format
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && (dbUrl.startsWith('prisma+postgres://') || dbUrl.startsWith('prisma://'))) {
    databaseUrl = dbUrl;
  } else if (process.env.DATABASE_REMOTE) {
    // Fall back to DATABASE_REMOTE if available
    databaseUrl = process.env.DATABASE_REMOTE;
  } else {
    databaseUrl = dbUrl || '';
  }
}

// Check if using Prisma Accelerate (URL starts with prisma+postgres:// or prisma://)
const isAccelerateUrl = (url: string): boolean => {
  return url.startsWith('prisma+postgres://') || url.startsWith('prisma://');
};

const useAccelerate = isAccelerateUrl(databaseUrl);

// Only log in local/development for debugging
if (isDev) {
  logger.info({ 
    msg: "Prisma: Initializing", 
    environment: env,
    isLocal,
    useRemoteDb,
    hasDatabaseUrl: !!databaseUrl,
    dbUrlPrefix: databaseUrl ? databaseUrl.substring(0, 30) + "..." : "none",
    useAccelerate
  });
}

// Create Prisma client singleton
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prismaClient: any;

try {
  if (useAccelerate) {
    // For Prisma Accelerate / Prisma Postgres — use the accelerateUrl option
    // and activate built-in edge caching via withAccelerate().
    // Extension order matters: withAccelerate() is applied FIRST so that
    // the $allOperations extension (circuit breaker / op counting / timeout)
    // wraps the Accelerate-extended client, not the other way around.
    prismaClient = new PrismaClient({
      accelerateUrl: databaseUrl,
    }).$extends(withAccelerate());
  } else {
    const pool = new Pool({ 
      connectionString: databaseUrl,
      max: 5,
      min: 1,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
    });
    const adapter = new PrismaPg(pool);
    prismaClient = new PrismaClient({ adapter });
  }
} catch (error) {
  logger.error({ msg: "Prisma: Initialization failed", error: error instanceof Error ? error.message : String(error) });
  // Last resort fallback
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prismaClient = new PrismaClient({} as any);
}

// Use global singleton to avoid multiple connections in development
const globalForPrisma = globalThis as unknown as { prismaClient: AccelerateClient | undefined };

// ─── DB operations counter + write budget limiter (v3.19.0) ──────────────
// Tracks reads/writes per calendar day (IST). When writes exceed the budget,
// non-critical write operations are rejected to protect the Prisma Postgres
// plan limit (10K ops/day). The counter lives on globalThis so it survives
// hot-reloads in dev and is shared across module graphs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
const todayKey = (): string => {
  const now = new Date();
  // IST date key (YYYY-MM-DD)
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().split("T")[0];
};
/** Shared IST day key (YYYY-MM-DD) — reused by lib/sqlite.ts so the persisted
 * ops-counter snapshot stays in the same day-space as the in-memory counter. */
export const getIstDayKey = todayKey;
if (!g.__dbOpsCounter || g.__dbOpsCounter._day !== todayKey()) {
  g.__dbOpsCounter = { reads: 0, writes: 0, _day: todayKey() };
}
export const dbOpsCounter: { reads: number; writes: number; _day: string } = g.__dbOpsCounter;

// ─── DB error counts by type (v3.21.1) ─────────────────────────────────────
// Day-scoped (IST) counter of classified DB errors for the DB Health
// dashboard's per-type summary. Every DB failure recorded via recordDbError()
// also bumps ONE type bucket (classifyDbError is an exhaustive partition).
// Counts live on globalThis (hot-reload + module-graph safety, mirrors
// dbOpsCounter) and are persisted to the SQLite backup by lib/sqlite.ts under
// the "_backup_meta" key "db_error_counts" so they survive process restarts.
const DB_ERROR_TYPES: DbErrorType[] = [
  "plan_limit",
  "timeout",
  "accelerate_proxy",
  "connection",
  "write_budget",
  "other",
];
function seedErrorCounts(): Record<DbErrorType, number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seed: any = {};
  for (const t of DB_ERROR_TYPES) seed[t] = 0;
  return seed as Record<DbErrorType, number>;
}
if (!g.__dbErrorCounts || (g.__dbErrorCounts as { _day: string })._day !== todayKey()) {
  g.__dbErrorCounts = { _day: todayKey(), counts: seedErrorCounts() };
}
export const dbErrorCounts: { _day: string; counts: Record<DbErrorType, number> } =
  g.__dbErrorCounts;

export function getDbErrorCounts(): { day: string; counts: Record<DbErrorType, number> } {
  if (dbErrorCounts._day !== todayKey()) {
    dbErrorCounts._day = todayKey();
    dbErrorCounts.counts = seedErrorCounts();
  }
  return { day: dbErrorCounts._day, counts: { ...dbErrorCounts.counts } };
}

const WRITE_BUDGET = Number(process.env.DB_WRITE_BUDGET) || 8_000;

export function isDbWriteBudgetExceeded(): boolean {
  // Refresh day key if rollover happened
  if (dbOpsCounter._day !== todayKey()) {
    dbOpsCounter.reads = 0;
    dbOpsCounter.writes = 0;
    dbOpsCounter._day = todayKey();
  }
  return dbOpsCounter.writes >= WRITE_BUDGET;
}

// ─── DB failure ring buffer (v3.20.1) ─────────────────────────────────────
// In-memory ring buffer of recent DB errors for the admin Health tab.
// Keeps the last 50 errors with timestamp, model, operation, and message.
interface DbErrorEntry {
  at: string;
  model: string;
  operation: string;
  message: string;
}
const DB_ERROR_BUFFER_SIZE = 50;
if (!g.__dbErrorLog) g.__dbErrorLog = [] as DbErrorEntry[];
const dbErrorLog: DbErrorEntry[] = g.__dbErrorLog;

export function recordDbError(model: string, operation: string, error: unknown): void {
  dbErrorLog.push({
    at: new Date().toISOString(),
    model,
    operation,
    message: error instanceof Error ? error.message : String(error),
  });
  if (dbErrorLog.length > DB_ERROR_BUFFER_SIZE) dbErrorLog.shift();

  // Bump the typed day-scoped bucket (rollover to a fresh day first).
  if (dbErrorCounts._day !== todayKey()) {
    dbErrorCounts._day = todayKey();
    dbErrorCounts.counts = seedErrorCounts();
  }
  const type = classifyDbError(error);
  dbErrorCounts.counts[type] = (dbErrorCounts.counts[type] || 0) + 1;
}

export function getDbErrorLog(): DbErrorEntry[] {
  return [...dbErrorLog];
}

// v3.26.0: benign application-level unique-constraint conflicts (Prisma code
// P2002) are NOT DB health faults. The most frequent source is the
// leader-election "create-or-stand-by" race in lib/services/leader.ts: on a
// cold-start burst several instances contend for the SAME workerId
// (`leader-<role>`); every loser throws P2002, which the caller handles
// gracefully by standing down. These must not be recorded in the DB Errors
// panel / `other` bucket (they inflated the count on every multi-instance
// restart). The error is still THROWN and propagates to the caller unchanged —
// we only skip the diagnostic recording.
function isBenignUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export const WRITE_BUDGET_CONFIG = WRITE_BUDGET;

// ─── Plan-limit circuit breaker (v3.20.3) ──────────────────────────────────
// The breaker STATE + helpers live in lib/db-utils.ts (Prisma-free, testable).
// This file only wires them into the $allOperations extension below.
// (Import declared at the top with the other imports.)

// ─── Per-query timeout (v3.12.0) ───────────────────────────────────────────
// Prod Accelerate queries had NO timeout — a stalled proxy connection hung a
// healthy daily run for 16+ min with ZERO logs (run 8715fd51, 2026-08-16:
// "Capped daily recommendations…" at 12:12:34, then silence until another
// instance's reaper killed it at 12:29/12:30). Every query is now raced against
// a deadline so no single DB call can wedge the pipeline: on timeout the query
// rejects with a distinctive PrismaQueryTimeoutError, the pipeline's existing
// try/catch marks the run failed, and the next stage proceeds — fail-fast
// instead of silent hang.
const QUERY_TIMEOUT_MS = Number(process.env.PRISMA_QUERY_TIMEOUT_MS) || 120_000;

// Throttle the "breaker OPEN — tripping error" warning so a repetitively-triggered
// false-positive doesn't flood the cron/worker logs (default: 1 per 60s).
const BREAKER_TRIP_LOG_THROTTLE_MS = 60_000;

export class PrismaQueryTimeoutError extends Error {
  constructor(model: string, operation: string) {
    super(`Prisma query ${model}.${operation} timed out after ${QUERY_TIMEOUT_MS}ms`);
    this.name = "PrismaQueryTimeoutError";
  }
}

function withQueryTimeout<T>(promise: Promise<T>, model: string, operation: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new PrismaQueryTimeoutError(model, operation)),
      QUERY_TIMEOUT_MS,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// Wrap the base client so EVERY model/raw query is timeout-bounded
// (the $allOperations extension intercepts all operations incl. $queryRaw).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const extendedClient = (globalForPrisma.prismaClient ?? prismaClient).$extends({
  query: {
    $allOperations({ model, operation, args, query }: {
      model: string;
      operation: string;
      args: Record<string, unknown>;
      query: (args: Record<string, unknown>) => Promise<unknown>;
    }) {
      // Plan-limit circuit breaker — if open, fail fast WITHOUT hitting the
      // proxy (avoids the 120s per-query timeout during an account hold).
      if (isPlanLimitBreakerOpen()) {
        return Promise.reject(
          new PlanLimitOpenError(),
        ) as ReturnType<typeof query>;
      }

      // Track ops counter (refresh day key on rollover)
      if (dbOpsCounter._day !== todayKey()) {
        dbOpsCounter.reads = 0;
        dbOpsCounter.writes = 0;
        dbOpsCounter._day = todayKey();
      }
      const isWrite = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany", "executeRaw", "executeRawUnsafe"].includes(operation);
      if (isWrite) {
        dbOpsCounter.writes++;
      } else {
        dbOpsCounter.reads++;
      }

      // Write budget guard — reject non-critical writes when budget exceeded
      // (raw/exec operations are never blocked — they're used by critical infra)
      if (isWrite && !operation.startsWith("executeRaw") && dbOpsCounter.writes > WRITE_BUDGET) {
        logger.warn({ msg: "DB write budget exceeded", writes: dbOpsCounter.writes, budget: WRITE_BUDGET, model, operation });
        recordDbError(model ?? "?", operation, new Error(`write budget exceeded (${dbOpsCounter.writes}/${WRITE_BUDGET})`));
        return Promise.reject(new Error(`DB write budget exceeded (${dbOpsCounter.writes}/${WRITE_BUDGET} writes today). Try again tomorrow or set DB_WRITE_BUDGET env.`)) as ReturnType<typeof query>;
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const result = query(args);
      if (typeof (result as Promise<unknown> | undefined)?.then === "function") {
        const awaited = withQueryTimeout(
          result as Promise<unknown>,
          model ?? "?",
          operation,
        );
        return awaited
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          .then((val) => {
            // A probe that succeeded while the breaker was half-open means the
            // hold has lifted — close the breaker so normal ops resume.
            if (typeof g.__planLimitOpenAt === "number") closePlanLimitBreaker();
            return val;
          })
          .catch((err: unknown) => {
            // Record failures in the ring buffer (fire-and-forget, non-blocking).
            // SKIP benign application-level unique-constraint conflicts (P2002):
            // e.g. the leader-election "create-or-stand-by" race in
            // lib/services/leader.ts where multiple instances contend for the
            // same workerId and every loser throws P2002 — handled gracefully by
            // the caller, NOT a DB health fault, so it must not pollute the
            // DB Errors panel / `other` bucket (v3.26.0).
            if (!isBenignUniqueConflict(err)) {
              recordDbError(model ?? "?", operation, err);
            }
            // If this is a genuine PLAN-LIMIT HOLD / query timeout, open the
            // circuit breaker so subsequent calls fail fast instead of waiting
            // 120s each. Log the ACTUAL triggering error message (throttled)
            // so a spurious trip is diagnosable instead of invisible.
            //
            // v3.26.0: the breaker is tripped ONLY by isPlanLimitHoldError
            // (P6003 / "hold on your account" / "planLimitReached" / query
            // timeout) — NOT by isDbUnavailableError. Plain connection/network
            // errors ("fetch failed", DNS, TLS, ECONNRESET…) are usually a
            // transient Accelerate-proxy blip on a HEALTHY DB; tripping the
            // 5-min breaker on one froze the whole app (prod logs: a "fetch
            // failed" reap error → "Plan limit circuit breaker open" →
            // "Swing analysis processor crashed" + "Cron daemon resync
            // deferred" cascade with zero Prisma access for the cooldown).
            // Transient comms errors still drive per-query graceful degradation
            // (worker backoff + cached/empty fallbacks), they just don't
            // freeze the global breaker.
            if (isPlanLimitHoldError(err)) {
              openPlanLimitBreaker();
              if (Date.now() - g.__lastBreakerTripLog >= BREAKER_TRIP_LOG_THROTTLE_MS) {
                g.__lastBreakerTripLog = Date.now();
                logger.warn({
                  msg: "Plan-limit breaker OPEN — tripping error",
                  model: model ?? "?",
                  operation,
                  error: err instanceof Error ? err.message : String(err),
                  type: classifyDbError(err),
                });
              }
            }
            throw err;
          }) as ReturnType<typeof query>;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return result;
    },
  },
  }) as AccelerateClient;

export const db = globalForPrisma.prismaClient ?? extendedClient;
export const prisma = globalForPrisma.prismaClient ?? extendedClient;

/**
 * Add Accelerate edge caching to a single Prisma READ.
 *
 * The exported `prisma`/`db` is typed as the base PrismaClient for model-method
 * safety, but the RUNTIME client is extended with withAccelerate() so reads
 * accept `cacheStrategy` ({ttl}/{swr}/{tags}). Because the base type declares
 * `cacheStrategy?: never`, passing it inline fails to type-check. This helper
 * preserves Prisma's contextual typing for the args (via `Parameters<T>[0]`)
 * while injecting `cacheStrategy` at the boundary (safe — the runtime client
 * supports it).
 *
 * @example
 * await prisma.corporateAction.findMany(
 *   withAccelerateCache({ ttl: 300, swr: 60 })({ where, orderBy, select }),
 * );
 */
export function withAccelerateCache<T extends (args: any) => any>(
  strategy: { ttl: number; swr?: number; tags?: string[] },
) {
  return (args: Parameters<T>[0]): ReturnType<T> =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ ...(args as any), cacheStrategy: strategy } as any);
}

// Default export for backward compatibility
export default prisma;

// Only cache in dev/local to avoid issues in production
if (isDev) {
  globalForPrisma.prismaClient = extendedClient;
}
