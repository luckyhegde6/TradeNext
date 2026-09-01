import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma, { dbOpsCounter, isDbWriteBudgetExceeded, WRITE_BUDGET_CONFIG, getDbErrorLog, getIstDayKey } from "@/lib/prisma";
import { getSqliteFallback } from "@/lib/sqlite";
import { isDbUnavailableError } from "@/lib/db-utils";
import { getDailyPriceCacheStatus, flushDailyPricesToDb } from "@/lib/services/priceCache";

/**
 * GET /api/admin/db-health
 *
 * Returns comprehensive DB health info:
 * - Prisma connectivity + ops counters + recent errors
 * - SQLite backup status + table row counts + sync history
 * - Daily price cache status (market-hours accumulator)
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
      prismaHealthy = true;
    }
  }

  // Get SQLite status
  const sqlite = getSqliteFallback();
  const sqliteHealth = sqlite?.getHealthStatus() ?? null;

  // Persist the ops counter snapshot so it survives restarts/deploys
  sqlite?.persistOpsCounter();

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
        prismaTableCounts[model] = -1;
      }
    }
  }

  // Refresh day key if rollover happened
  const currentDay = getIstDayKey();
  if (dbOpsCounter._day !== currentDay) {
    dbOpsCounter.reads = 0;
    dbOpsCounter.writes = 0;
    dbOpsCounter._day = currentDay;
  }

  // Recent DB errors from ring buffer
  const dbErrors = getDbErrorLog();

  // Daily price cache status
  const priceCacheStatus = getDailyPriceCacheStatus();

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    prisma: {
      healthy: prismaHealthy,
      latencyMs: prismaLatencyMs,
      error: prismaError,
      lastProbeAt: new Date().toISOString(),
      tableCounts: prismaTableCounts,
      ops: {
        reads: dbOpsCounter.reads,
        writes: dbOpsCounter.writes,
        totalOperations: dbOpsCounter.reads + dbOpsCounter.writes,
        planLimit: Number(process.env.DB_PLAN_LIMIT_OPS) || 10_000,
        planOperationsRemaining: Math.max(0, (Number(process.env.DB_PLAN_LIMIT_OPS) || 10_000) - dbOpsCounter.reads - dbOpsCounter.writes),
        writeBudget: WRITE_BUDGET_CONFIG,
        writeBudgetExceeded: isDbWriteBudgetExceeded(),
        writeBudgetRemaining: Math.max(0, WRITE_BUDGET_CONFIG - dbOpsCounter.writes),
        dayKey: dbOpsCounter._day,
      },
    },
    sqlite: sqliteHealth?.sqlite ?? {
      ready: false,
      syncing: false,
      lastSyncAt: null,
      tables: {},
      recentSyncs: [],
    },
    dailyPriceCache: priceCacheStatus,
    dbErrors,
  });
}

/**
 * POST /api/admin/db-health
 * Trigger a manual SQLite sync from Prisma or flush daily prices.
 *
 * Body: { action?: "sync_sqlite" | "flush_prices" }
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let action = "sync_sqlite";
  try {
    const body = await req.json();
    if (body?.action) action = body.action;
  } catch {
    // default to sync_sqlite
  }

  if (action === "flush_prices") {
    try {
      const result = await flushDailyPricesToDb();
      return NextResponse.json({
        success: true,
        message: `Flushed ${result.rows} rows to daily_prices (${result.errors} errors)`,
        ...result,
      });
    } catch (err) {
      return NextResponse.json(
        { error: "Price flush failed", detail: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
  }

  // Default: sync SQLite
  const sqlite = getSqliteFallback();
  if (!sqlite) {
    return NextResponse.json({ error: "SQLite backup not initialized" }, { status: 503 });
  }

  try {
    await sqlite.syncFromPrisma();
    // Persist ops counter so the snapshot reflects the post-sync state
    sqlite.persistOpsCounter();
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
