/**
 * instrumentation.ts regression guard (v3.28.2 + v3.33.0 watchdog wiring).
 *
 * v3.28.2: the lost-leader `onLost` callbacks must ACTUALLY stop the worker
 * poll loop and the cron daemon (previously they only logged, so DB-blip
 * losers kept polling forever → multiple active workers/tasks).
 *
 * v3.33.0 (spec 11): the leader lock is self-healing — register() mounts the
 * `watchLeaderRole` watchdog for each role instead of directly acquiring the
 * lock or starting heartbeats. The watchdog calls `onAcquired` when this
 * instance owns the leader row and `onLost` when it loses it; register() wires
 * onAcquired → start worker/cron engines and onLost → stop engines. sqlite-sync
 * stays log-only (syncing is gated per-run by isLeader). This file pins that
 * contract with a handler-capturing watchLeaderRole mock.
 */
jest.mock("@/lib/services/worker/cron-daemon", () => ({
  startCronDaemon: jest.fn().mockResolvedValue({ alreadyRunning: false, registeredJobs: 0 }),
  stopCronDaemon: jest.fn(),
}));

jest.mock("@/lib/services/worker/worker-engine", () => ({
  startWorker: jest.fn(),
  stopWorkerEngine: jest.fn(),
}));

jest.mock("@/lib/services/intelligence/cache", () => ({
  restoreIntelligenceCacheFromDB: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/sqlite", () => ({
  initSqliteBackup: jest.fn().mockResolvedValue(undefined),
  startOpsCounterPersistence: jest.fn(),
  startWriteBehindFlush: jest.fn(),
  startNsePromoteFlush: jest.fn(),
}));

jest.mock("@/lib/services/priceCache", () => ({
  startDailyPriceFlushTimer: jest.fn(),
}));

jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("@/lib/services/leader", () => ({
  watchLeaderRole: jest.fn(),
  LEADER_SELF: "test-instance",
}));

import { register } from "../../instrumentation";

const cronDaemon = jest.requireMock("@/lib/services/worker/cron-daemon") as {
  startCronDaemon: jest.Mock;
  stopCronDaemon: jest.Mock;
};
const workerEngine = jest.requireMock("@/lib/services/worker/worker-engine") as {
  startWorker: jest.Mock;
  stopWorkerEngine: jest.Mock;
};
const leader = jest.requireMock("@/lib/services/leader") as {
  watchLeaderRole: jest.Mock;
  LEADER_SELF: string;
};
const sqlite = jest.requireMock("@/lib/sqlite") as {
  initSqliteBackup: jest.Mock;
  startOpsCounterPersistence: jest.Mock;
  startWriteBehindFlush: jest.Mock;
  startNsePromoteFlush: jest.Mock;
};
const logger = jest.requireMock("@/lib/logger").default as {
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  debug: jest.Mock;
};

type WatchdogHandlers = { onAcquired?: () => void; onLost?: () => void };

/**
 * Makes watchLeaderRole capture the per-role handlers passed by register()
 * and return a no-op stop() so each test can drive onAcquired/onLost directly.
 */
function captureWatchdogHandlers(): Record<string, WatchdogHandlers> {
  const captured: Record<string, WatchdogHandlers> = {};
  leader.watchLeaderRole.mockImplementation(
    (role: string, handlers: WatchdogHandlers) => {
      captured[role] = handlers;
      return () => {};
    },
  );
  return captured;
}

describe("instrumentation leader watchdog wiring (v3.28.2 + v3.33.0)", () => {
  const originalRuntime = process.env.NEXT_RUNTIME;
  const originalPhase = process.env.NEXT_PHASE;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.NEXT_PHASE;
  });

  afterAll(() => {
    if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = originalRuntime;
    if (originalPhase === undefined) delete process.env.NEXT_PHASE;
    else process.env.NEXT_PHASE = originalPhase;
  });

  it("mounts watchdogs for all 3 roles; onAcquired starts worker + cron engines", async () => {
    const handlers = captureWatchdogHandlers();
    await register();

    expect(leader.watchLeaderRole).toHaveBeenCalledTimes(3);
    expect(Object.keys(handlers).sort()).toEqual(["cron-daemon", "sqlite-sync", "worker"]);

    // Watchdog reports leadership for worker + cron-daemon → engines start.
    handlers.worker.onAcquired?.();
    handlers["cron-daemon"].onAcquired?.();

    expect(workerEngine.startWorker).toHaveBeenCalledWith(30_000);
    expect(cronDaemon.startCronDaemon).toHaveBeenCalledTimes(1);
    // Plan 09 Phase 5: NSE→Prisma promotion moved to the 6h push engine — the
    // ~60s promote timer must NOT be auto-started by register().
    expect(sqlite.startNsePromoteFlush).not.toHaveBeenCalled();
  });

  it("fires stopWorkerEngine when the worker onLost callback is invoked", async () => {
    const handlers = captureWatchdogHandlers();
    await register();

    expect(workerEngine.stopWorkerEngine).not.toHaveBeenCalled();
    // Leadership lost mid-run (another instance re-acquired the row).
    handlers.worker.onLost?.();
    expect(workerEngine.stopWorkerEngine).toHaveBeenCalledTimes(1);
  });

  it("fires stopCronDaemon when the cron onLost callback is invoked", async () => {
    const handlers = captureWatchdogHandlers();
    await register();

    expect(cronDaemon.stopCronDaemon).not.toHaveBeenCalled();
    handlers["cron-daemon"].onLost?.();
    expect(cronDaemon.stopCronDaemon).toHaveBeenCalledTimes(1);
  });

  it("does NOT start engines when the watchdog stays standby (no onAcquired)", async () => {
    const handlers = captureWatchdogHandlers();
    await register();

    // Another instance holds every leader row → watchdogs stay standby, so
    // neither onAcquired ever fires.
    expect(workerEngine.startWorker).not.toHaveBeenCalled();
    expect(cronDaemon.startCronDaemon).not.toHaveBeenCalled();
    expect(workerEngine.stopWorkerEngine).not.toHaveBeenCalled();
    expect(cronDaemon.stopCronDaemon).not.toHaveBeenCalled();
    expect(leader.watchLeaderRole).toHaveBeenCalledTimes(3);
    expect(handlers.worker.onAcquired).toBeDefined();
    expect(handlers["cron-daemon"].onAcquired).toBeDefined();
  });

  it("returns early (no dynamic imports) outside the Node runtime", async () => {
    delete process.env.NEXT_RUNTIME;

    await register();

    expect(leader.watchLeaderRole).not.toHaveBeenCalled();
    expect(workerEngine.startWorker).not.toHaveBeenCalled();
    expect(cronDaemon.startCronDaemon).not.toHaveBeenCalled();
  });

  it("self-heals after loss: onLost → stop, then a later onAcquired restarts the worker", async () => {
    const handlers = captureWatchdogHandlers();
    await register();

    handlers.worker.onAcquired?.();
    expect(workerEngine.startWorker).toHaveBeenCalledTimes(1);

    handlers.worker.onLost?.();
    expect(workerEngine.stopWorkerEngine).toHaveBeenCalledTimes(1);

    // The watchdog re-acquires the row after the stale window → engines restart
    // without throwing (v3.33.0 self-heal contract).
    expect(() => handlers.worker.onAcquired?.()).not.toThrow();
    expect(workerEngine.startWorker).toHaveBeenCalledTimes(2);
  });

  it("sqlite-sync onLost is log-only — never stops the engines", async () => {
    const handlers = captureWatchdogHandlers();
    await register();

    handlers["sqlite-sync"].onLost?.();

    expect(workerEngine.startWorker).not.toHaveBeenCalled();
    expect(workerEngine.stopWorkerEngine).not.toHaveBeenCalled();
    expect(cronDaemon.startCronDaemon).not.toHaveBeenCalled();
    expect(cronDaemon.stopCronDaemon).not.toHaveBeenCalled();
    // The loss is surfaced in the logs with the self identifier.
    expect(logger.warn).toHaveBeenCalled();
  });
});