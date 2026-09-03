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
    const [{ startCronDaemon }, { startWorker }, { restoreIntelligenceCacheFromDB }, { initSqliteBackup, startOpsCounterPersistence, startWriteBehindFlush }, { startDailyPriceFlushTimer }, { default: logger }] = await Promise.all([
      import("@/lib/services/worker/cron-daemon"),
      import("@/lib/services/worker/worker-engine"),
      import("@/lib/services/intelligence/cache"),
      import("@/lib/sqlite"),
      import("@/lib/services/priceCache"),
      import("@/lib/logger"),
    ]);

    // LEADER ELECTION (v3.22.0): a multi-instance deploy (Netlify cold-start
    // burst / scale) would otherwise start a cron daemon, a worker poll loop,
    // and a full SQLite sync on EVERY instance — multiplying Prisma ops and
    // firing duplicate cron jobs. Only the elected leader starts each.
    // DB-unavailable degrades to running locally (leader.ts) so cron/work
    // never halt; leadership re-elects once the DB recovers.
    const leader = await import("@/lib/services/leader");

    const workerLeader = await leader.acquireLeaderLock("worker");
    if (workerLeader) {
      // Poll loop picks up the WorkerTasks the daemon spawns (and admin runNow).
      startWorker(30_000);
      leader.startLeaderHeartbeat("worker", () => {
        logger.warn({ msg: "Lost worker leadership — stopping", self: leader.LEADER_SELF });
      });
    } else {
      logger.warn({ msg: "Worker engine NOT started (another instance is worker leader)", self: leader.LEADER_SELF });
    }

    const cronLeader = await leader.acquireLeaderLock("cron-daemon");
    if (cronLeader) {
      startCronDaemon().then(() =>
        logger.info({ msg: "Cron daemon started (leader)", self: leader.LEADER_SELF }),
      );
      leader.startLeaderHeartbeat("cron-daemon", () => {
        logger.warn({ msg: "Lost cron leadership — stopping", self: leader.LEADER_SELF });
      });
    } else {
      logger.warn({ msg: "Cron daemon NOT started (another instance is cron leader)", self: leader.LEADER_SELF });
    }

    // Pre-load intelligence cache from DB so there's no cold-start penalty
    await restoreIntelligenceCacheFromDB().catch((err: unknown) =>
      logger.warn({ msg: "Intelligence cache restore failed (non-fatal)", error: err instanceof Error ? err.message : String(err) }),
    );

    // Acquire the sqlite-sync leader lock so the Prisma->SQLite sync inside
    // initSqliteBackup runs on exactly ONE instance (syncFromPrisma gates on
    // isLeader). Standing-by instances still init SQLite locally for fallback
    // reads + write-behind buffering, but skip the heavy full sync.
    const syncLeader = await leader.acquireLeaderLock("sqlite-sync");
    if (syncLeader) {
      leader.startLeaderHeartbeat("sqlite-sync", () => {
        logger.warn({ msg: "Lost sqlite-sync leadership — stopping sync", self: leader.LEADER_SELF });
      });
    } else {
      logger.warn({ msg: "SQLite sync will be skipped (another instance is sqlite-sync leader)", self: leader.LEADER_SELF });
    }

    // Initialize SQLite backup (background sync, non-blocking). NOTE: the
    // Prisma->SQLite sync inside is leader-gated (sqlite-sync) — SQLite itself
    // is initialized on EVERY instance for fallback reads + write-behind.
    await initSqliteBackup().catch((err: unknown) =>
      logger.warn({ msg: "SQLite backup init failed (non-fatal)", error: err instanceof Error ? err.message : String(err) }),
    );

    // Start daily price flush timer (batch-writes to daily_prices after 4pm IST)
    startDailyPriceFlushTimer();

    // Snapshot Prisma ops counter + per-type DB error counts to SQLite every
    // 60s so the admin dashboard survives restarts/deploys and tracks the full
    // IST day (startOpsCounterPersistence persists BOTH snapshots).
    startOpsCounterPersistence();

    // Periodically promote important write-behind log rows to Prisma and prune
    // 14-day-old rows (leader-gated to ONE instance/window in multi-instance
    // deploys). Closes the old gap where queued logs only reached Prisma on a
    // manual admin flush — but stays op-cheap (≤1 createMany per kind/window).
    startWriteBehindFlush();

    logger.info({ msg: "Cron daemon + worker + intelligence cache + SQLite + price cache started via instrumentation", self: leader.LEADER_SELF });
  } catch (error) {
    // Never crash server startup — crons can still be started manually from
    // the admin Workers/Cron pages. console fallback in case logger's own
    // dynamic import is the thing that failed.
    // eslint-disable-next-line no-console
    console.error("[instrumentation] failed to auto-start cron daemon", error);
  }
}
