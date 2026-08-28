// lib/db-utils.ts
//
// Shared DB resilience utilities for graceful degradation when the database
// is unavailable (e.g. Prisma Postgres plan limit exceeded).

/**
 * Detect Prisma/PostgreSQL errors that indicate the database is unavailable:
 * - Plan limit exceeded (Prisma Postgres)
 * - Connection refused / timeout
 * - Too many connections
 * - Database does not exist
 * - Accelerate proxy errors (ECONNREFUSED, Invalid invocation, etc.)
 */
export function isDbUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const code = (error as any)?.code;
  const name = error.name?.toLowerCase() ?? "";

  // --- message-based checks ---
  if (
    // Prisma Postgres hold: "There is a hold on your account. Reason: planLimitReached."
    msg.includes("hold on your account") ||
    msg.includes("planlimitreached") ||
    msg.includes("plan limit reached") ||
    msg.includes("plan limit") ||
    // NOTE: no bare `msg.includes("exceeded")` — too broad; would match benign
    // constraint/data errors (e.g. value-out-of-range "exceeds max") and
    // wrongly trip the plan-limit breaker. The plan-limit wording is covered
    // by the specific "plan limit" matches above.
    msg.includes("connection refused") ||
    msg.includes("connection timeout") ||
    msg.includes("too many connections") ||
    msg.includes("database does not exist") ||
    msg.includes("prisma postgres") ||
    msg.includes("operational") ||
    msg.includes("engine is not ready") ||
    msg.includes("prepared statement") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("econnaborted") ||
    msg.includes("socket hang up") ||
    msg.includes("invalid invocation") ||
    msg.includes("bad gateway") ||
    msg.includes("service unavailable") ||
    msg.includes("gateway timeout") ||
    msg.includes("request timeout") ||
    msg.includes("accelerate") ||
    msg.includes("proxy") ||
    msg.includes("tls") ||
    msg.includes("certificate") ||
    msg.includes("enotfound") ||
    msg.includes("getaddrinfo") ||
    msg.includes("network") ||
    msg.includes("fetch failed")
  ) {
    return true;
  }

  // --- Prisma error codes ---
  if (
    code === "P6003" || // Prisma Postgres: account hold - planLimitReached
    code === "P1001" || // Prisma: can't reach database
    code === "P1017" || // Prisma: server closed connection
    code === "P2024" || // Prisma: timeout
    code === "P1000" || // Prisma: authentication failed
    code === "P1002" || // Prisma: DB server not reachable
    code === "P1003" || // Prisma: DB does not exist
    code === "P1008" || // Prisma: operations timed out
    code === "P1011" || // Prisma: error opening TLS connection
    code === "P1012" || // Prisma: schema error
    code === "P1013" || // Prisma: invalid database string
    code === "P1014" || // Prisma: model not found
    code === "P1016" || // Prisma: raw query failed
    code === "P1018" || // Prisma: disconnected
    code === "ECONNREFUSED" || // PrismaClientKnownRequestError
    code === "ECONNRESET" ||
    code === "ETIMEDOUT"
  ) {
    return true;
  }

  // --- Our own PrismaQueryTimeoutError (lib/prisma.ts) ---
  // A query that exceeded the 120s deadline almost always means the DB is
  // unreachable/hung (e.g. during a plan-limit hold the proxy blocks until
  // timeout). Treat as unavailable so fallback chains degrade to cached/empty.
  if (name.includes("prismaquerytimeout")) {
    return true;
  }

  // --- Our own PlanLimitOpenError (lib/prisma.ts circuit breaker) ---
  // A fail-fast rejection emitted when the breaker is open; callers should
  // still treat it as "DB unavailable" so fallback chains keep degrading.
  if (name.includes("planlimitopen")) {
    return true;
  }

  return false;
}

// ─── Plan-limit circuit breaker (v3.20.3) ────────────────────────────────────
// When the Prisma Postgres account is on HOLD (code P6003 / "planLimitReached"),
// EVERY operation blocks at the proxy until the per-query timeout — even reads
// and executeRaw (which the write-budget guard doesn't cover). That turns a
// plan-limited account into massive request latency + log flooding.
//
// This breaker, once a hold/timeout is observed, short-circuits ALL subsequent
// ops to fail fast for a cooldown window, then lets one probe through to test
// whether the hold has lifted. State lives on globalThis so it survives
// hot-reloads in dev and is shared across module graphs (mirrors lib/prisma.ts).
//
// These helpers are deliberately Prisma-free so they can be unit-tested
// without instantiating a PrismaClient.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;

const PLAN_LIMIT_COOLDOWN_MS = Number(process.env.PLAN_LIMIT_COOLDOWN_MS) || 5 * 60_000;

export class PlanLimitOpenError extends Error {
  constructor() {
    super("Plan limit circuit breaker open — Prisma account likely on hold; failing fast");
    this.name = "PlanLimitOpenError";
  }
}

/**
 * Detect an error that indicates the Prisma Postgres account is on HOLD
 * (code P6003 / "planLimitReached") or that a DB operation timed out — the two
 * symptoms that should trip the plan-limit circuit breaker.
 */
export function isPlanLimitHoldError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const code = (error as any)?.code;
  const msg = error.message.toLowerCase();
  const name = error.name?.toLowerCase() ?? "";
  return (
    code === "P6003" ||
    msg.includes("hold on your account") ||
    msg.includes("planlimitreached") ||
    name.includes("timeout")
  );
}

export function isPlanLimitBreakerOpen(): boolean {
  const openAt = g.__planLimitOpenAt as number | undefined;
  return typeof openAt === "number" && Date.now() - openAt < PLAN_LIMIT_COOLDOWN_MS;
}

export function openPlanLimitBreaker(): void {
  g.__planLimitOpenAt = Date.now();
}

export function closePlanLimitBreaker(): void {
  g.__planLimitOpenAt = null;
}

export function getPlanLimitBreakerStatus(): {
  open: boolean;
  cooldownMs: number;
  openedAt: number | null;
} {
  return {
    open: isPlanLimitBreakerOpen(),
    cooldownMs: PLAN_LIMIT_COOLDOWN_MS,
    openedAt: g.__planLimitOpenAt ?? null,
  };
}

// Test hook — reset breaker state deterministically between tests.
export function resetPlanLimitBreaker(): void {
  closePlanLimitBreaker();
}
