import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getSqliteFallback } from "@/lib/sqlite";
import { isDbUnavailableError } from "@/lib/db-utils";

/**
 * GET /api/admin/db-health
 *
 * Returns comprehensive DB health info:
 * - Prisma connectivity + ops counters
 * - SQLite backup status + table row counts + sync history
 * - Trigger manual sync via POST
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Probe Prisma connectivity
  let prismaHealthy = false;
  let prismaLatencyMs = 0;
  let prismaError: string | null = null;
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    prismaLatencyMs = Date.now() - start;
    prismaHealthy = true;
  } catch (err) {
    prismaError = err instanceof Error ? err.message : String(err);
    if (!isDbUnavailableError(err)) {
      // Non-connectivity error (e.g. schema issue) — Prisma is reachable
      prismaHealthy = true;
    }
  }

  // Get SQLite status
  const sqlite = getSqliteFallback();
  const sqliteHealth = sqlite?.getHealthStatus() ?? null;

  // Table row counts from Prisma (if healthy)
  let prismaTableCounts: Record<string, number> = {};
  if (prismaHealthy) {
    const tables = [
      "DailyRecommendationRun",
      "DailyRecommendationStock",
      "CorporateAction",
      "ChartinkScreener",
      "WorkerStatus",
      "ServerLog",
      "AuditLog",
      "CronJob",
      "WorkerTask",
    ] as const;
    for (const model of tables) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prismaTableCounts[model] = await (prisma as any)[model].count();
      } catch {
        prismaTableCounts[model] = -1; // error
      }
    }
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    prisma: {
      healthy: prismaHealthy,
      latencyMs: prismaLatencyMs,
      error: prismaError,
      lastProbeAt: sqliteHealth?.prisma.lastProbeAt ?? null,
      tableCounts: prismaTableCounts,
      ops: sqliteHealth?.prisma ?? {
        reads: 0,
        writes: 0,
        writeBudget: 0,
        writeBudgetExceeded: false,
        writeBudgetRemaining: 0,
      },
    },
    sqlite: sqliteHealth?.sqlite ?? {
      ready: false,
      syncing: false,
      lastSyncAt: null,
      tables: {},
      recentSyncs: [],
    },
  });
}

/**
 * POST /api/admin/db-health
 * Trigger a manual SQLite sync from Prisma.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sqlite = getSqliteFallback();
  if (!sqlite) {
    return NextResponse.json({ error: "SQLite backup not initialized" }, { status: 503 });
  }

  try {
    await sqlite.syncFromPrisma();
    const health = sqlite.getHealthStatus();
    return NextResponse.json({
      success: true,
      message: "SQLite sync completed",
      sqlite: health.sqlite,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Sync failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
