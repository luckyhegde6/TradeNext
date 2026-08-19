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
 */
export function isDbUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
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
    (error as any)?.code === "P1001" || // Prisma: can't reach database
    (error as any)?.code === "P1017" || // Prisma: server closed connection
    (error as any)?.code === "P2024"    // Prisma: timeout
  );
}
