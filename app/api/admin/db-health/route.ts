import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma, { dbOpsCounter, isDbWriteBudgetExceeded, WRITE_BUDGET_CONFIG, getDbErrorLog, getIstDayKey, getDbErrorCounts } from "@/lib/prisma";
import { ensureSqliteBackup, getSqliteFallback, exportSqliteBackup, restoreSqliteBackup, getWriteBehindStats, flushWriteBehind } from "@/lib/sqlite";
import { isDbUnavailableError } from "@/lib/db-utils";
import { createAuditLog } from "@/lib/audit";
import { getDailyPriceCacheStatus, flushDailyPricesToDb } from "@/lib/services/priceCache";
import { getLeaderInfo, LEADER_SELF } from "@/lib/services/leader";

/**
 * GET /api/admin/db-health
 *
 * Returns comprehensive DB health info:
 * - Prisma connectivity + ops counters + recent errors
 * - SQLite backup status + table row counts + sync history
 * - Daily price cache status (market-hours accumulator)
 * - Per-type DB error summary (day-scoped, persisted to SQLite)
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Refresh the day key first (rollover resets counts to the new IST day),
  // then snapshot the ops counter BEFORE the probe + table counts below, so
  // the displayed total does not grow on every refresh (each refresh adds ~11
  // reads via its own probe). The Prisma dashboard remains authoritative; this
  // snapshot reflects the state right after the rollover check.
  const planLimit = Number(process.env.DB_PLAN_LIMIT_OPS) || 10_000;
  const currentDay = getIstDayKey();
  if (dbOpsCounter._day !== currentDay) {
    dbOpsCounter.reads = 0;
    dbOpsCounter.writes = 0;
    dbOpsCounter._day = currentDay;
  }
  const opsSnapshot = {
    reads: dbOpsCounter.reads,
    writes: dbOpsCounter.writes,
    day: dbOpsCounter._day,
  };

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

  // Get SQLite status — ensure the backup layer is initialized first so a
  // failed boot-time init is retried on demand instead of serving
  // "SQLite Not Ready" forever (v3.21.1).
  const sqlite = await ensureSqliteBackup();
  const sqliteHealth = sqlite?.getHealthStatus() ?? null;

  // Persist snapshots so the ops counter + per-type error counts survive
  // restarts/deploys on the same IST day.
  sqlite?.persistOpsCounter();
  sqlite?.persistDbErrorCounts();

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

  // Recent DB errors from ring buffer
  const dbErrors = getDbErrorLog();

  // Per-type DB error summary (day-scoped, persisted to SQLite)
  const dbErrorSummary = getDbErrorCounts();

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
        reads: opsSnapshot.reads,
        writes: opsSnapshot.writes,
        totalOperations: opsSnapshot.reads + opsSnapshot.writes,
        planLimit,
        planOperationsRemaining: Math.max(0, planLimit - opsSnapshot.reads - opsSnapshot.writes),
        writeBudget: WRITE_BUDGET_CONFIG,
        writeBudgetExceeded: isDbWriteBudgetExceeded(),
        writeBudgetRemaining: Math.max(0, WRITE_BUDGET_CONFIG - opsSnapshot.writes),
        dayKey: opsSnapshot.day,
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
    dbErrorSummary,
    // v3.22.0: write-behind queue stats + leader election status + liveness
    // heartbeats (SQLite-backed, zero Prisma footprint in the response path).
    writeBehind: getWriteBehindStats(),
    leader: {
      self: LEADER_SELF,
      worker: await getLeaderInfo("worker"),
      cronDaemon: await getLeaderInfo("cron-daemon"),
      sqliteSync: await getLeaderInfo("sqlite-sync"),
    },
    liveness: getSqliteFallback()?.getLivenessHeartbeats() ?? [],
  });
}

/**
 * POST /api/admin/db-health
 * Trigger a manual SQLite sync from Prisma, flush daily prices, or perform an
 * admin backup / restore of the in-memory SQLite backup layer.
 *
 * Body: { action?: "sync_sqlite" | "flush_prices" | "flush_logs" | "deploy_prep" | "backup" | "restore" }
 *  - backup:      returns { data: base64 } of the exported .sqlite blob
 *  - restore:     { data: <base64 sqlite> } applies the uploaded backup
 *  - deploy_prep: run the "Prepare for Deploy" sequence — flush write-behind logs
 *                 from SQLite into Prisma (so in-memory queued logs survive the
 *                 deploy/restart), then force-refresh the SQLite read-mirror from
 *                 Prisma, then persist ops/error snapshots and return a summary.
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

  if (action === "backup") {
    const bytes = exportSqliteBackup();
    if (!bytes) {
      return NextResponse.json({ error: "SQLite backup not initialized" }, { status: 503 });
    }
    const base64 = Buffer.from(bytes).toString("base64");
    const filename = `tradenext-sqlite-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`;
    void createAuditLog({
      userId: session.user.id ? parseInt(session.user.id) : undefined,
      userEmail: session.user.email,
      action: "ADMIN_DB_BACKUP",
      resource: "sqlite",
      resourceId: filename,
      responseStatus: 200,
      metadata: { size: bytes.byteLength },
    });
    return NextResponse.json({
      success: true,
      filename,
      size: bytes.byteLength,
      mime: "application/x-sqlite3",
      data: base64,
    });
  }

  if (action === "restore") {
    let body: { data?: string; file?: string } = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid restore payload" }, { status: 400 });
    }
    const b64 = body?.data || body?.file;
    if (!b64 || typeof b64 !== "string") {
      return NextResponse.json({ error: "Missing base64 sqlite data" }, { status: 400 });
    }
    try {
      const bytes = Buffer.from(b64, "base64");
      const result = await restoreSqliteBackup(new Uint8Array(bytes));
      // Persist snapshots from the restored DB so ops/error counts survive.
      getSqliteFallback()?.persistOpsCounter();
      getSqliteFallback()?.persistDbErrorCounts();
      void createAuditLog({
        userId: session.user.id ? parseInt(session.user.id) : undefined,
        userEmail: session.user.email,
        action: "ADMIN_DB_RESTORE",
        resource: "sqlite",
        responseStatus: 200,
        metadata: { tables: result.db, bytes: bytes.byteLength },
      });
      return NextResponse.json({
        success: true,
        message: `SQLite backup restored (${result.db} tables)`,
        tables: result.db,
      });
    } catch (err) {
      return NextResponse.json(
        { error: "Restore failed", detail: err instanceof Error ? err.message : String(err) },
        { status: 400 },
      );
    }
  }

  if (action === "flush_prices") {
    try {
      const result = await flushDailyPricesToDb();
      void createAuditLog({
        userId: session.user.id ? parseInt(session.user.id) : undefined,
        userEmail: session.user.email,
        action: "ADMIN_DB_FLUSH_PRICES",
        resource: "daily_prices",
        responseStatus: 200,
        metadata: { rows: result.rows, errors: result.errors },
      });
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

  if (action === "flush_logs") {
    // v3.22.0: bulk-flush the write-behind log queue (APIRequestLog / ServerLog
    // / AuditLog) from SQLite into Prisma. Manual admin trigger; the leader
    // worker also flushes periodically (nightly + after writes).
    try {
      const result = await flushWriteBehind();
      void createAuditLog({
        userId: session.user.id ? parseInt(session.user.id) : undefined,
        userEmail: session.user.email,
        action: "ADMIN_DB_FLUSH_LOGS",
        resource: "write_behind",
        responseStatus: 200,
        metadata: { flushed: result.flushed, retained: result.retained, pending: result.pending },
      });
      return NextResponse.json({
        success: true,
        message: `Write-behind log flush complete (${Object.values(result.flushed).reduce((a, b) => a + b, 0)} rows)`,
        ...result,
      });
    } catch (err) {
      return NextResponse.json(
        { error: "Log flush failed", detail: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
  }

  if (action === "deploy_prep") {
    // "Prepare for Deploy": the SQLite backup layer is an in-memory sql.js DB,
    // so a deploy/restart wipes the queued write-behind logs + heartbeat data.
    // Step 1 — bulk-flush pending write-behind logs (APIRequestLog/ServerLog/
    // AuditLog) from SQLite into Prisma so nothing queued is lost on restart.
    // Step 2 — force-refresh the SQLite read-mirror from the current Prisma
    // state so DB-down reads after deploy serve recent data.
    try {
      const flushed = await flushWriteBehind();
      const sqlite = await ensureSqliteBackup();
      if (!sqlite) {
        return NextResponse.json(
          { error: "SQLite backup not initialized (logs flushed, mirror sync skipped)" },
          { status: 503 },
        );
      }
      await sqlite.syncFromPrisma({ force: true });
      sqlite.persistOpsCounter();
      sqlite.persistDbErrorCounts();
      const health = sqlite.getHealthStatus();
      const rowsFlushed = Object.values(flushed.flushed).reduce((a, b) => a + b, 0);
      void createAuditLog({
        userId: session.user.id ? parseInt(session.user.id) : undefined,
        userEmail: session.user.email,
        action: "ADMIN_DB_DEPLOY_PREP",
        resource: "sqlite",
        responseStatus: 200,
        metadata: { rowsFlushed, pushed: flushed.flushed, retained: flushed.retained, pending: flushed.pending },
      });
      return NextResponse.json({
        success: true,
        message: `Deploy prep complete — promoted ${rowsFlushed} important write-behind rows to Prisma and refreshed the SQLite mirror`,
        flushed: flushed.flushed,
        retained: flushed.retained,
        pending: flushed.pending,
        rowsFlushed,
        sqlite: health.sqlite,
      });
    } catch (err) {
      return NextResponse.json(
        { error: "Deploy prep failed", detail: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
  }

  // Default: sync SQLite
  const sqlite = await ensureSqliteBackup();
  if (!sqlite) {
    return NextResponse.json({ error: "SQLite backup not initialized" }, { status: 503 });
  }

  try {
    // Manual admin action — force the sync regardless of leader election so it
    // works on whatever instance the admin is hitting (leader-gated otherwise).
    await sqlite.syncFromPrisma({ force: true });
    // Persist snapshots so the post-sync state survives restarts/deploys
    sqlite.persistOpsCounter();
    sqlite.persistDbErrorCounts();
    const health = sqlite.getHealthStatus();
    void createAuditLog({
      userId: session.user.id ? parseInt(session.user.id) : undefined,
      userEmail: session.user.email,
      action: "ADMIN_DB_SYNC",
      resource: "sqlite",
      responseStatus: 200,
    });
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
