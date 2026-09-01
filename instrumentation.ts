// instrumentation.ts — Next.js server-lifecycle hook (v3.11.0).
//
// Starts the in-process cron daemon + task worker when the app runs as a
// persistent Node server (next start / npm run dev). The daemon replaces the
// old Netlify scheduled functions: cron schedules now live in the DB and are
// managed through the admin Cron tab.
//
// EDGE-SAFETY: instrumentation.ts is bundled for BOTH Node and Edge runtimes,
// so it MUST keep ZERO top-level imports — a static `import` of lib/logger
// pulls in lib/trace -> crypto and breaks the Edge Instrumentation compile
// ("Node.js module is loaded which is not supported in the Edge Runtime").
// All node-only modules are imported DYNAMICALLY inside register() behind the
// NEXT_RUNTIME guard; the Edge variant is then just this file with nothing in
// it, and register() returns before any dynamic import runs.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  try {
    const [{ startCronDaemon }, { startWorker }, { restoreIntelligenceCacheFromDB }, { initSqliteBackup, startOpsCounterPersistence }, { startDailyPriceFlushTimer }, { default: logger }] = await Promise.all([
      import("@/lib/services/worker/cron-daemon"),
      import("@/lib/services/worker/worker-engine"),
      import("@/lib/services/intelligence/cache"),
      import("@/lib/sqlite"),
      import("@/lib/services/priceCache"),
      import("@/lib/logger"),
    ]);

    // Poll loop picks up the WorkerTasks the daemon spawns (and admin runNow).
    startWorker(30_000);
    await startCronDaemon();

    // Pre-load intelligence cache from DB so there's no cold-start penalty
    await restoreIntelligenceCacheFromDB().catch((err: unknown) =>
      logger.warn({ msg: "Intelligence cache restore failed (non-fatal)", error: err instanceof Error ? err.message : String(err) }),
    );

    // Initialize SQLite backup (background sync, non-blocking)
    await initSqliteBackup().catch((err: unknown) =>
      logger.warn({ msg: "SQLite backup init failed (non-fatal)", error: err instanceof Error ? err.message : String(err) }),
    );

    // Start daily price flush timer (batch-writes to daily_prices after 4pm IST)
    startDailyPriceFlushTimer();

    // Snapshot Prisma ops counter + per-type DB error counts to SQLite every
    // 60s so the admin dashboard survives restarts/deploys and tracks the full
    // IST day (startOpsCounterPersistence persists BOTH snapshots).
    startOpsCounterPersistence();

    logger.info({ msg: "Cron daemon + worker + intelligence cache + SQLite + price cache started via instrumentation" });
  } catch (error) {
    // Never crash server startup — crons can still be started manually from
    // the admin Workers/Cron pages. console fallback in case logger's own
    // dynamic import is the thing that failed.
    // eslint-disable-next-line no-console
    console.error("[instrumentation] failed to auto-start cron daemon", error);
  }
}
