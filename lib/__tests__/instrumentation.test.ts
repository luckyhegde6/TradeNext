/**
 * instrumentation.ts regression guard (v3.28.2).
 *
 * The lost-leader `onLost` callbacks must ACTUALLY stop the worker poll loop
 * and the cron daemon. Before v3.28.2 they only logged: `acquireLeaderLock`
 * fails open on a DB-unavailable blip (returns true on EVERY instance), so
 * multiple instances could start a worker + daemon; when the DB recovered,
 * only one kept the leader row but the losers kept polling forever → multiple
 * active workers/tasks. This test pins the contract that onLost → stop.
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
  acquireLeaderLock: jest.fn(),
  startLeaderHeartbeat: jest.fn(),
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
  acquireLeaderLock: jest.Mock;
  startLeaderHeartbeat: jest.Mock;
};

describe("instrumentation lost-leader stop (v3.28.2)", () => {
  const originalRuntime = process.env.NEXT_RUNTIME;
  const originalPhase = process.env.NEXT_PHASE;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.NEXT_PHASE;
    // Everything is a leader by default so register() takes the start path.
    leader.acquireLeaderLock.mockResolvedValue(true);
  });

  afterAll(() => {
    if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = originalRuntime;
    if (originalPhase === undefined) delete process.env.NEXT_PHASE;
    else process.env.NEXT_PHASE = originalPhase;
  });

  it("starts worker + cron daemon when elected leader for both", async () => {
    await register();

    expect(workerEngine.startWorker).toHaveBeenCalledWith(30_000);
    expect(cronDaemon.startCronDaemon).toHaveBeenCalledTimes(1);
    expect(leader.acquireLeaderLock).toHaveBeenCalledWith("worker");
    expect(leader.acquireLeaderLock).toHaveBeenCalledWith("cron-daemon");
    expect(leader.acquireLeaderLock).toHaveBeenCalledWith("sqlite-sync");
  });

  it("fires stopWorkerEngine when the worker onLost callback is invoked", async () => {
    let workerOnLost: (() => void) | undefined;
    leader.startLeaderHeartbeat.mockImplementation(
      (role: string, onLost?: () => void) => {
        if (role === "worker") workerOnLost = onLost;
        return () => {};
      },
    );

    await register();
    expect(leader.startLeaderHeartbeat).toHaveBeenCalledWith("worker", expect.any(Function));

    // Leadership lost mid-run (another instance re-acquired the row).
    workerOnLost?.();
    expect(workerEngine.stopWorkerEngine).toHaveBeenCalledTimes(1);
  });

  it("fires stopCronDaemon when the cron onLost callback is invoked", async () => {
    let cronOnLost: (() => void) | undefined;
    leader.startLeaderHeartbeat.mockImplementation(
      (role: string, onLost?: () => void) => {
        if (role === "cron-daemon") cronOnLost = onLost;
        return () => {};
      },
    );

    await register();
    expect(leader.startLeaderHeartbeat).toHaveBeenCalledWith("cron-daemon", expect.any(Function));

    cronOnLost?.();
    expect(cronDaemon.stopCronDaemon).toHaveBeenCalledTimes(1);
  });

  it("does NOT start the worker engine when another instance is worker leader", async () => {
    leader.acquireLeaderLock.mockImplementation((role: string) =>
      Promise.resolve(role !== "worker"),
    );

    await register();

    expect(workerEngine.startWorker).not.toHaveBeenCalled();
    expect(workerEngine.stopWorkerEngine).not.toHaveBeenCalled();
    expect(cronDaemon.startCronDaemon).toHaveBeenCalledTimes(1);
  });

  it("returns early (no dynamic imports) outside the Node runtime", async () => {
    delete process.env.NEXT_RUNTIME;

    await register();

    expect(leader.acquireLeaderLock).not.toHaveBeenCalled();
    expect(workerEngine.startWorker).not.toHaveBeenCalled();
    expect(cronDaemon.startCronDaemon).not.toHaveBeenCalled();
  });
});