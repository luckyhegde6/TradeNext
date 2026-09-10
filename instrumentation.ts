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
    const [{ startCronDaemon, stopCronDaemon }, { startWorker, stopWorkerEngine }, { restoreIntelligenceCacheFromDB }, { initSqliteBackup, startOpsCounterPersistence, startWriteBehindFlush }, { startDailyPriceFlushTimer }, { default: logger }] = await Promise.all([
      import("@/lib/services/worker/cron-daemon"),
      import("@/lib/services/worker/worker-engine"),
      import("@/lib/services/intelligence/cache"),
      import("@/lib/sqlite"),
      import("@/lib/services/priceCache"),
      import("@/lib/logger"),
    ]);

    // LEADER WATCHDOGS (v3.33.0, spec 11): replaces the one-shot boot election
    // below. Before, each role elected a leader exactly ONCE at boot and NO ONE
    // ever re-claimed the lock — a crashed/recycled leader left the scheduler /
    // worker engine dead until a manual admin "Start Engine" click. Each
    // `watchLeaderRole` block is now a self-healing loop:
    //   standby → adaptive probe → claim stale/absent lock → onAcquired
    //   leader  → existing heartbeat (leader.ts) → row lost → onLost → standby
    // DB-unavailable degrade (fail-open local leader) is preserved by leader.ts.
    const leader = await import("@/lib/services/leader");

    leader.watchLeaderRole("worker", {
      onAcquired: () => {
        // Poll loop picks up the WorkerTasks the daemon spawns (and admin runNow).
        // startWorker is idempotent (guards on its interval handle) so a
        // re-acquire after onLost restarts it without double-polling.
        startWorker(30_000);
      },
      onLost: () => {
        // v3.28.2: actually stop the poll loop when leadership is lost. Without
        // this, a fail-open DB blip lets EVERY instance start a worker; when the
        // DB recovers only one keeps the leader row but the losers kept polling
        // forever → multiple active workers/tasks.
        logger.warn({ msg: "Lost worker leadership — stopping poll loop", self: leader.LEADER_SELF });
        stopWorkerEngine();
      },
    });

    leader.watchLeaderRole("cron-daemon", {
      onAcquired: () => {
        startCronDaemon().then(() =>
          logger.info({ msg: "Cron daemon started (leader)", self: leader.LEADER_SELF }),
        );
      },
      onLost: () => {
        logger.warn({ msg: "Lost cron leadership — stopping daemon", self: leader.LEADER_SELF });
        stopCronDaemon();
      },
    });

    // Pre-load intelligence cache from DB so there's no cold-start penalty
    await restoreIntelligenceCacheFromDB().catch((err: unknown) =>
      logger.warn({ msg: "Intelligence cache restore failed (non-fatal)", error: err instanceof Error ? err.message : String(err) }),
    );

    // sqlite-sync is LOG-ONLY (no engine to stop): the Prisma→SQLite sync
    // inside initSqliteBackup is gated per-run by isLeader, so a lost row just
    // means this instance stops doing the heavy sync until it re-claims.
    leader.watchLeaderRole("sqlite-sync", {
      onAcquired: () => {},
      onLost: () => {
        logger.warn({ msg: "Lost sqlite-sync leadership — sync will be skipped", self: leader.LEADER_SELF });
      },
    });

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

    // v3.30.0 Plan 09 Phase 5: NSE mirror promotion is now driven by the 6h
    // push engine (pushSqliteToPrisma). The ~60s promote timer is env-gated
    // off (NSE_PROMOTE_ENABLED=1) and no longer auto-started here.

    logger.info({ msg: "Cron daemon + worker + intelligence cache + SQLite + price cache started via instrumentation", self: leader.LEADER_SELF });
  } catch (error) {
    // Never crash server startup — crons can still be started manually from
    // the admin Workers/Cron pages. console fallback in case logger's own
    // dynamic import is the thing that failed.
    // eslint-disable-next-line no-console
    console.error("[instrumentation] failed to auto-start cron daemon", error);
  }
}
