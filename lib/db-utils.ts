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
    msg.includes("plan limit") ||
    msg.includes("exceeded") ||
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

  // --- PrismaClientKnownRequestError name check ---
  if (name.includes("prismaclient") && name.includes("request")) {
    // Known request error with no matching code — still likely a connectivity issue
    return true;
  }

  return false;
}
