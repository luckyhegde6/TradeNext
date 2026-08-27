// Prisma client singleton - only log in development for debugging
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import logger from './logger';

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
let prismaClient: PrismaClient;

try {
  if (useAccelerate) {
    // For Prisma Accelerate, use the accelerateUrl option
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaClient = new PrismaClient({ 
      accelerateUrl: databaseUrl 
    } as any);
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
const globalForPrisma = globalThis as unknown as { prismaClient: PrismaClient | undefined };

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
if (!g.__dbOpsCounter || g.__dbOpsCounter._day !== todayKey()) {
  g.__dbOpsCounter = { reads: 0, writes: 0, _day: todayKey() };
}
export const dbOpsCounter: { reads: number; writes: number; _day: string } = g.__dbOpsCounter;

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
}

export function getDbErrorLog(): DbErrorEntry[] {
  return [...dbErrorLog];
}

export const WRITE_BUDGET_CONFIG = WRITE_BUDGET;

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
    $allOperations({ model, operation, args, query }) {
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
        // Record failures in the ring buffer (fire-and-forget, non-blocking)
        return awaited.catch((err: unknown) => {
          recordDbError(model ?? "?", operation, err);
          throw err;
        }) as ReturnType<typeof query>;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return result;
    },
  },
}) as PrismaClient;

export const db = globalForPrisma.prismaClient ?? extendedClient;
export const prisma = globalForPrisma.prismaClient ?? extendedClient;

// Default export for backward compatibility
export default prisma;

// Only cache in dev/local to avoid issues in production
if (isDev) {
  globalForPrisma.prismaClient = extendedClient;
}
