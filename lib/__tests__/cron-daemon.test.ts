/**
 * Tests for the in-process cron daemon (lib/services/worker/cron-daemon.ts) —
 * v3.11.0. Covers:
 *   - startCronDaemon: ensures system crons, registers active jobs on the
 *     node-cron scheduler (UTC default — expressions are evaluated in UTC by
 *     lib/cron-parser, so registering in IST split-brained nextRun), idempotent
 *     second start.
 *   - syncCronJobs: re-register on expression change, skip invalid
 *     expressions, drop deactivated jobs, per-job timezone from config.
 *   - fireJob: re-fetches the row, delegates to spawnDueCronJob, no-op when
 *     the job is missing/inactive.
 *   - heartbeat upsert + getCronDaemonStatus + stopCronDaemon cleanup.
 *
 * IMPORTANT: Do NOT use `import { jest } from "@jest/globals"`.
 * SWC (used by next/jest) requires `jest` to be the global variable
 * for `jest.mock()` hoisting to work correctly.
 */

// ─── Mocks (MUST be before any imports — SWC hoists jest.mock) ─────────

// NOTE: every module-scope variable referenced by a jest.mock factory must be
// `mock`-prefixed so SWC hoists its declaration above the import graph (the
// node-cron factory runs while the test file's imports are being evaluated).
const mockScheduled: Array<{ expression: string; fn: () => void; opts?: { timezone?: string }; task: { destroy: jest.Mock } }> = [];
const mockSchedule = jest.fn((expression: string, fn: () => void, opts?: { timezone?: string }) => {
  const task = { destroy: jest.fn(), stop: jest.fn(), start: jest.fn() };
  mockScheduled.push({ expression, fn, opts, task });
  return task;
});
const mockValidate = jest.fn((_expression?: string) => true);

// NOTE: jest.mock factories run while the import graph is being evaluated
// (before module-scope consts initialize). Never DEREFERENCE a module-scope
// mock variable inside the factory body — only CAPTURE it in a closure that
// runs later (the dailyRecommendationService.test.ts pattern).
jest.mock("node-cron", () => ({
  __esModule: true,
  default: {
    schedule: (...args: unknown[]) => mockSchedule(...(args as [string, () => void, { timezone?: string }])),
    validate: (...args: unknown[]) => mockValidate(...(args as [string])),
  },
}));

jest.mock("@/lib/logger", () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { __esModule: true, default: mock, info: mock.info, warn: mock.warn, error: mock.error, debug: mock.debug };
});

jest.mock("@/lib/prisma", () => {
  const mock = {
    cronJob: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    workerTask: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    dailyRecommendationRun: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    workerStatus: {
      upsert: jest.fn(),
    },
  };
  return { __esModule: true, default: mock };
});

jest.mock("@/lib/services/worker/worker-service", () => ({
  __esModule: true,
  executeTask: jest.fn(),
}));

const mockSqliteHeartbeat = jest.fn();
// v3.45.0: mutable so the degraded fireJob tests can present a `cron_job`
// mirror. Defaults keep the heartbeat-only surface the other suites rely on.
const mockSqliteFallback: { current: Record<string, any> | null } = {
  current: { isReady: () => true, writeLivenessHeartbeat: mockSqliteHeartbeat },
};
// v3.47.0 (spec 25): the 5-min resync tick drains the write-behind outbox via
// getSqliteFallback's sibling `pushSqliteToPrisma` (dynamic import). Captured so
// the wiring test can assert the tick triggers it.
const mockPushSqliteToPrisma = jest.fn().mockResolvedValue({ ran: true, synced: 0, failed: 0, errors: [] });
jest.mock("@/lib/sqlite", () => ({
  __esModule: true,
  getSqliteFallback: jest.fn(() => mockSqliteFallback.current),
  pushSqliteToPrisma: (...a: unknown[]) => mockPushSqliteToPrisma(...(a as [])),
}));

// ── v3.45.0 (spec 21): the degraded branch in fireJob ──────────────────────
// db-utils was previously unmocked (real `isPlanLimitBreakerOpen` → false), so
// the new breaker read in fireJob is controlled here explicitly.
const mockIsPlanLimitBreakerOpen = jest.fn().mockReturnValue(false);
jest.mock("@/lib/db-utils", () => ({
  __esModule: true,
  isDbUnavailableError: jest.fn(() => false),
  isPlanLimitBreakerOpen: (...a: unknown[]) => mockIsPlanLimitBreakerOpen(...(a as [])) as boolean,
}));

const mockIsDegradedModeActive = jest.fn().mockReturnValue(false);
jest.mock("@/lib/services/degradedMode", () => ({
  __esModule: true,
  isDegradedModeActive: (...a: unknown[]) => mockIsDegradedModeActive(...(a as [])) as boolean,
}));

const mockCanExecuteDegradedWork = jest.fn().mockResolvedValue(true);
const mockDegradedLeaseHolder = jest.fn().mockReturnValue("leader-self-abc");
jest.mock("@/lib/services/degradedLeader", () => ({
  __esModule: true,
  canExecuteDegradedWork: (...a: unknown[]) => mockCanExecuteDegradedWork(...(a as [])) as Promise<boolean>,
  degradedLeaseHolder: (...a: unknown[]) => mockDegradedLeaseHolder(...(a as [])) as string,
}));

const mockEnqueueDegradedTask = jest.fn().mockReturnValue("deg-7");
const mockRunDegradedQueueOnce = jest.fn().mockResolvedValue({
  claimed: 0,
  completed: 0,
  failed: 0,
  skipped: 0,
  requeuedStale: 0,
});
jest.mock("@/lib/services/worker/degradedQueue", () => ({
  __esModule: true,
  enqueueDegradedTask: (...a: unknown[]) => mockEnqueueDegradedTask(...(a as [])) as string | null,
  runDegradedQueueOnce: (...a: unknown[]) => mockRunDegradedQueueOnce(...(a as [])) as Promise<unknown>,
}));

jest.mock("@/lib/services/worker/degradedExecutor", () => ({
  __esModule: true,
  executeDegradedTask: jest.fn(),
}));

jest.mock("@/lib/services/worker/worker-logger", () => ({
  __esModule: true,
  createTaskLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
  })),
  writeLog: jest.fn(),
}));

jest.mock("@/lib/cron-parser", () => ({
  __esModule: true,
  calculateNextRun: jest.fn(() => new Date("2026-08-12T04:30:00.000Z")),
}));

jest.mock("@/lib/services/worker/task-orchestrator", () => ({
  __esModule: true,
  spawnCronTask: jest.fn(),
}));

jest.mock("@/lib/services/recommendationCronService", () => ({
  __esModule: true,
  ensureRecommendationCrons: jest.fn(() => Promise.resolve({ ensured: 0, jobs: [] })),
  recordCronRun: jest.fn(() => Promise.resolve({ found: true })),
  RECOMMENDATION_CRON_NAME: "Daily Recommendations (System)",
  RECOMMENDATION_PERFORMANCE_CRON_NAME: "Recommendation Performance Check (System)",
}));

// ─── Imports ──────────────────────────────────────────────────────────────

import {
  startCronDaemon,
  stopCronDaemon,
  syncCronJobs,
  getCronDaemonStatus,
  getRegisteredJobIds,
  isDaemonHeartbeatFresh,
} from "@/lib/services/worker/cron-daemon";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const prisma = require("@/lib/prisma").default as Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ensureRecommendationCrons: mockEnsureCrons } = require("@/lib/services/recommendationCronService") as {
  ensureRecommendationCrons: jest.Mock;
};

const activeJob = (overrides: Record<string, unknown> = {}) => ({
  id: "job-1",
  name: "Daily Recommendations (System)",
  taskType: "recommendations",
  cronExpression: "30 4 * * 1-5",
  isActive: true,
  config: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockScheduled.length = 0;
  mockValidate.mockReturnValue(true);
  prisma.cronJob.findMany.mockResolvedValue([]);
  prisma.cronJob.findUnique.mockResolvedValue(activeJob());
  prisma.cronJob.update.mockResolvedValue({});
  prisma.workerTask.findFirst.mockResolvedValue(null);
  prisma.workerStatus.upsert.mockResolvedValue({});
});

afterEach(() => {
  stopCronDaemon(); // clears intervals + destroys tasks between tests
});

describe("startCronDaemon", () => {
  it("ensures system crons and registers each active job with UTC timezone", async () => {
    prisma.cronJob.findMany.mockResolvedValue([activeJob(), activeJob({ id: "job-2", cronExpression: "30 10 * * 1-5" })]);

    const result = await startCronDaemon();

    expect(mockEnsureCrons).toHaveBeenCalled();
    expect(result).toEqual({ alreadyRunning: false, registeredJobs: 2 });
    expect(mockSchedule).toHaveBeenCalledTimes(2);
    expect(mockSchedule.mock.calls[0]).toEqual([
      "30 4 * * 1-5",
      expect.any(Function),
      { timezone: "UTC" },
    ]);
    expect(getRegisteredJobIds()).toEqual(["job-1", "job-2"]);
  });

  it("is idempotent — second start does not re-register", async () => {
    prisma.cronJob.findMany.mockResolvedValue([activeJob()]);

    const first = await startCronDaemon();
    const second = await startCronDaemon();

    expect(first).toEqual({ alreadyRunning: false, registeredJobs: 1 });
    expect(second).toEqual({ alreadyRunning: true, registeredJobs: 1 });
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });

  it("writes an initial liveness heartbeat to the LOCAL SQLite store (zero Prisma ops)", async () => {
    const { getSqliteFallback } = require("@/lib/sqlite") as {
      getSqliteFallback: jest.Mock;
    };
    await startCronDaemon();

    // v3.22.0: the daemon heartbeat is written to the local SQLite liveness
    // store — NOT a Prisma workerStatus.upsert — to keep Prisma ops ~0.
    expect(mockSqliteHeartbeat).toHaveBeenCalledWith(
      "cron-daemon",
      expect.objectContaining({ daemonId: expect.stringContaining("cron-daemon-") }),
    );
    expect(getSqliteFallback().isReady()).toBe(true);
    expect(prisma.workerStatus.upsert).not.toHaveBeenCalled();
  });
});

describe("syncCronJobs", () => {
  it("re-registers a job whose expression changed", async () => {
    prisma.cronJob.findMany.mockResolvedValue([activeJob({ cronExpression: "30 4 * * 1-5" })]);
    await startCronDaemon();
    expect(getRegisteredJobIds()).toEqual(["job-1"]);

    prisma.cronJob.findMany.mockResolvedValue([activeJob({ cronExpression: "0 5 * * 1-5" })]);
    await syncCronJobs();

    expect(mockSchedule).toHaveBeenCalledTimes(2);
    expect(mockScheduled[1].expression).toBe("0 5 * * 1-5");
    expect(mockScheduled[0].task.destroy).toHaveBeenCalled();
  });

  it("skips jobs with invalid cron expressions (never throws)", async () => {
    mockValidate.mockReturnValue(false);
    prisma.cronJob.findMany.mockResolvedValue([activeJob()]);

    const result = await syncCronJobs();

    expect(result.registered).toBe(0);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it("drops jobs that were deactivated or deleted", async () => {
    prisma.cronJob.findMany.mockResolvedValue([activeJob()]);
    await startCronDaemon();

    prisma.cronJob.findMany.mockResolvedValue([]);
    await syncCronJobs();

    expect(getRegisteredJobIds()).toEqual([]);
    expect(mockScheduled[0].task.destroy).toHaveBeenCalled();
  });

  it("honours a per-job timezone from config", async () => {
    prisma.cronJob.findMany.mockResolvedValue([activeJob({ config: { timezone: "America/New_York" } })]);

    await syncCronJobs();

    expect(mockSchedule.mock.calls[0][2]).toEqual({ timezone: "America/New_York" });
  });
});

// ─── Spec 25: missed-tick catch-up + outbox-drain wiring ────────────────────
// Netlify suspends/recycles the process (ticks missed → node-cron "missed
// execution" warnings). startCronDaemon runs catchUpMissedCronJobs on boot AND
// on the 5-min resync tick, and drains the SQLite→Prisma outbox on that same
// tick. The catch-up logic itself is unit-tested in worker-engine.test.ts;
// these tests pin the WIRING (boot + resync tick drive the real functions
// through the daemon's own mocks).

describe("spec 25 missed-tick catch-up + outbox-drain wiring", () => {
  const spawnMock = () =>
    (require("@/lib/services/worker/task-orchestrator") as { spawnCronTask: jest.Mock }).spawnCronTask;

  it("runs catch-up on boot and spawns a job whose tick was missed", async () => {
    const missed = activeJob({ id: "job-missed", nextRun: new Date(Date.now() - 5 * 60_000) });
    prisma.cronJob.findMany.mockResolvedValue([missed]);
    prisma.workerTask.findFirst.mockResolvedValue(null);

    await startCronDaemon();

    expect(spawnMock()).toHaveBeenCalledWith(
      "job-missed",
      expect.objectContaining({ taskType: "recommendations" }),
    );
    expect(prisma.cronJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "job-missed" } }),
    );
  });

  it("spawns even a LONG-overdue job — no lateness cutoff (spec 25 §B)", async () => {
    // A once-daily job whose tick was missed >15 min ago must still run; the
    // dedup guard in spawnDueCronJob (not a lateness window) prevents doubles.
    const stale = activeJob({ id: "job-stale", nextRun: new Date(Date.now() - 6 * 60 * 60_000) });
    prisma.cronJob.findMany.mockResolvedValue([stale]);
    prisma.workerTask.findFirst.mockResolvedValue(null);

    await startCronDaemon();

    expect(spawnMock()).toHaveBeenCalledWith("job-stale", expect.objectContaining({ taskType: "recommendations" }));
    expect(prisma.cronJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "job-stale" } }),
    );
  });

  it("resync tick (5-min) also runs catch-up — recovers a job missed during a recycle", async () => {
    jest.useFakeTimers();
    try {
      prisma.cronJob.findMany.mockResolvedValue([]);
      await startCronDaemon();
      expect(spawnMock()).not.toHaveBeenCalled();

      // The instance was recycled ~2 min ago: node-cron timers died with the
      // old process; a once-daily job ticked while suspended and is now overdue
      // on a fresh instance. The next 5-min resync tick must recover it.
      prisma.cronJob.findMany.mockResolvedValue([
        activeJob({ id: "job-missed", nextRun: new Date(Date.now() - 5 * 60_000) }),
      ]);

      await jest.advanceTimersByTimeAsync(5 * 60_000);

      expect(spawnMock()).toHaveBeenCalledWith(
        "job-missed",
        expect.objectContaining({ taskType: "recommendations" }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("resync tick (5-min) drains the write-behind outbox (spec 25 §A)", async () => {
    jest.useFakeTimers();
    try {
      prisma.cronJob.findMany.mockResolvedValue([]);
      await startCronDaemon();

      // Not on boot — only on the recurring tick, so a fresh instance is not
      // stampeded with a push while it is still warming up.
      expect(mockPushSqliteToPrisma).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(5 * 60_000);

      expect(mockPushSqliteToPrisma).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("fireJob (node-cron handler)", () => {
  it("re-fetches the job and delegates to spawnDueCronJob", async () => {
    const sysJob = activeJob({ config: { systemManaged: true } });
    prisma.cronJob.findMany.mockResolvedValue([sysJob]);
    prisma.cronJob.findUnique.mockResolvedValue(sysJob);
    await startCronDaemon();

    const { spawnCronTask } = require("@/lib/services/worker/task-orchestrator") as { spawnCronTask: jest.Mock };
    spawnCronTask.mockResolvedValue({});

    // The scheduler callback is fire-and-forget (`void fireJob(...)`) — trigger
    // it, then flush the microtask chain (dynamic import → dedup → spawn).
    mockScheduled[0].fn();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(prisma.cronJob.findUnique).toHaveBeenCalledWith({ where: { id: "job-1" } });
    expect(spawnCronTask).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        name: "Scheduled: Daily Recommendations (System)",
        taskType: "recommendations",
        triggeredBy: "system", // systemManaged is derived from config — see spawnDueCronJob
      }),
    );
  });

  it("is a no-op when the job was deleted or deactivated", async () => {
    prisma.cronJob.findMany.mockResolvedValue([activeJob()]);
    await startCronDaemon();

    const { spawnCronTask } = require("@/lib/services/worker/task-orchestrator") as { spawnCronTask: jest.Mock };
    prisma.cronJob.findUnique.mockResolvedValue(null);

    mockScheduled[0].fn();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(spawnCronTask).not.toHaveBeenCalled();
  });

  it("logs but never throws when the DB lookup fails", async () => {
    prisma.cronJob.findMany.mockResolvedValue([activeJob()]);
    await startCronDaemon();

    prisma.cronJob.findUnique.mockRejectedValue(new Error("db down"));

    mockScheduled[0].fn();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

/**
 * v3.45.0 (spec 21) — fireJob's degraded branch.
 *
 * The original fireJob opened with `prisma.cronJob.findUnique`, so during a
 * plan-limit hold EVERY tick threw into a `catch` that only logged. The daemon
 * therefore fired most often precisely when it could do least, and the work was
 * never recorded anywhere. These tests pin that the tick is now enqueued to the
 * durable queue instead, and — just as importantly — that the normal path is
 * untouched when the breaker is closed.
 */
describe("fireJob degraded branch (spec 21)", () => {
  // Non-null view of the mutable mirror holder: `null` means "no mirror", which
  // these tests exercise separately, so each assignment site asserts what it needs.
  const mirror = (): Record<string, any> => mockSqliteFallback.current as Record<string, any>;

  const mirrorJob = {
    id: "job-1",
    name: "Daily Recommendations (System)",
    is_active: true,
    task_type: "recommendations",
    cron_expression: "0 10 * * *",
    config: JSON.stringify({ systemManaged: true }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockScheduled.length = 0;
    mockIsPlanLimitBreakerOpen.mockReturnValue(false);
    mockIsDegradedModeActive.mockReturnValue(false);
    mockCanExecuteDegradedWork.mockResolvedValue(true);
    mockSqliteFallback.current = {
      isReady: () => true,
      writeLivenessHeartbeat: mockSqliteHeartbeat,
      getCronJobs: () => [],
    };
  });

  it("enqueues from the mirror and never touches Prisma during a hold", async () => {
    prisma.cronJob.findMany.mockResolvedValue([activeJob()]);
    prisma.cronJob.findUnique.mockResolvedValue(activeJob());
    await startCronDaemon();

    mockIsPlanLimitBreakerOpen.mockReturnValue(true);
    mockIsDegradedModeActive.mockReturnValue(true);
    mirror().getCronJobs = () => [mirrorJob];

    mockScheduled[0].fn();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(prisma.cronJob.findUnique).not.toHaveBeenCalled();
    expect(mockEnqueueDegradedTask).toHaveBeenCalledWith({
      id: "job-1",
      name: "Daily Recommendations (System)",
      taskType: "recommendations",
      cronExpression: "0 10 * * *",
      // The mirror stores config as a JSON string; it must arrive parsed, or
      // the executor would read `config.systemManaged` off a string.
      config: { systemManaged: true },
    });
  });

  it("accepts a mirror job whose config is already an object", async () => {
    prisma.cronJob.findMany.mockResolvedValue([activeJob()]);
    await startCronDaemon();

    mockIsPlanLimitBreakerOpen.mockReturnValue(true);
    mockIsDegradedModeActive.mockReturnValue(true);
    mirror().getCronJobs = () => [{ ...mirrorJob, config: { systemManaged: true } }];

    mockScheduled[0].fn();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockEnqueueDegradedTask).toHaveBeenCalledWith(
      expect.objectContaining({ config: { systemManaged: true } }),
    );
  });

  it("treats unparsable config as null rather than throwing into node-cron", async () => {
    prisma.cronJob.findMany.mockResolvedValue([activeJob()]);
    await startCronDaemon();

    mockIsPlanLimitBreakerOpen.mockReturnValue(true);
    mockIsDegradedModeActive.mockReturnValue(true);
    mirror().getCronJobs = () => [{ ...mirrorJob, config: "{not json" }];

    mockScheduled[0].fn();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockEnqueueDegradedTask).toHaveBeenCalledWith(
      expect.objectContaining({ config: null }),
    );
  });

  it("does not enqueue an inactive mirror job", async () => {
    prisma.cronJob.findMany.mockResolvedValue([activeJob()]);
    await startCronDaemon();

    mockIsPlanLimitBreakerOpen.mockReturnValue(true);
    mockIsDegradedModeActive.mockReturnValue(true);
    mirror().getCronJobs = () => [{ ...mirrorJob, is_active: false }];

    mockScheduled[0].fn();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockEnqueueDegradedTask).not.toHaveBeenCalled();
  });

  it("drops (and does not crash on) a job absent from the mirror", async () => {
    prisma.cronJob.findMany.mockResolvedValue([activeJob()]);
    await startCronDaemon();

    mockIsPlanLimitBreakerOpen.mockReturnValue(true);
    mockIsDegradedModeActive.mockReturnValue(true);
    mirror().getCronJobs = () => [];

    mockScheduled[0].fn();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // We cannot know the task type, and the registry refuses unknown types
    // anyway — guessing would only enqueue noise.
    expect(mockEnqueueDegradedTask).not.toHaveBeenCalled();
  });

  it("skips enqueue when the mirror is not ready", async () => {
    prisma.cronJob.findMany.mockResolvedValue([activeJob()]);
    await startCronDaemon();

    mockIsPlanLimitBreakerOpen.mockReturnValue(true);
    mockIsDegradedModeActive.mockReturnValue(true);
    mockSqliteFallback.current = null;

    mockScheduled[0].fn();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockEnqueueDegradedTask).not.toHaveBeenCalled();
  });

  it("never lets a mirror failure escape into the scheduler", async () => {
    prisma.cronJob.findMany.mockResolvedValue([activeJob()]);
    await startCronDaemon();

    mockIsPlanLimitBreakerOpen.mockReturnValue(true);
    mockIsDegradedModeActive.mockReturnValue(true);
    mirror().getCronJobs = () => {
      throw new Error("mirror corrupt");
    };

    mockScheduled[0].fn();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockEnqueueDegradedTask).not.toHaveBeenCalled();
  });

  it("enqueues from the mirror when the mode is engaged even if the breaker is CLOSED", async () => {
    // spec §E — the breaker must not gate this branch: a threshold/force state
    // engages preemptively on a healthy DB, and `off` (mode inactive) is what
    // restores the Prisma path.
    prisma.cronJob.findMany.mockResolvedValue([activeJob()]);
    await startCronDaemon();

    mockIsPlanLimitBreakerOpen.mockReturnValue(false);
    mockIsDegradedModeActive.mockReturnValue(true);
    mirror().getCronJobs = () => [mirrorJob];

    mockScheduled[0].fn();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(prisma.cronJob.findUnique).not.toHaveBeenCalled();
    expect(mockEnqueueDegradedTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job-1" }),
    );
  });

  it("keeps the Prisma path byte-identical when the breaker is closed", async () => {
    const sysJob = activeJob({ config: { systemManaged: true } });
    prisma.cronJob.findMany.mockResolvedValue([sysJob]);
    prisma.cronJob.findUnique.mockResolvedValue(sysJob);
    await startCronDaemon();

    const { spawnCronTask } = require("@/lib/services/worker/task-orchestrator") as {
      spawnCronTask: jest.Mock;
    };
    spawnCronTask.mockResolvedValue({});

    mockScheduled[0].fn();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(prisma.cronJob.findUnique).toHaveBeenCalledWith({ where: { id: "job-1" } });
    expect(spawnCronTask).toHaveBeenCalledTimes(1);
    expect(mockEnqueueDegradedTask).not.toHaveBeenCalled();
  });

  it("still uses Prisma during a hold when the mode is inactive (kill-switch wins)", async () => {
    const sysJob = activeJob();
    prisma.cronJob.findMany.mockResolvedValue([sysJob]);
    prisma.cronJob.findUnique.mockResolvedValue(sysJob);
    await startCronDaemon();

    mockIsPlanLimitBreakerOpen.mockReturnValue(true);
    mockIsDegradedModeActive.mockReturnValue(false);

    mockScheduled[0].fn();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(prisma.cronJob.findUnique).toHaveBeenCalled();
    expect(mockEnqueueDegradedTask).not.toHaveBeenCalled();
  });

  // `mockReturnValue` survives `jest.clearAllMocks()`, so a "breaker open" case
  // here would leak into every later describe in this file.
  afterEach(() => {
    mockIsPlanLimitBreakerOpen.mockReturnValue(false);
    mockSqliteFallback.current = { isReady: () => true, writeLivenessHeartbeat: mockSqliteHeartbeat };
  });
});

describe("getCronDaemonStatus + stopCronDaemon", () => {
  it("reports stopped before start, live after start", async () => {
    expect(getCronDaemonStatus().running).toBe(false);

    prisma.cronJob.findMany.mockResolvedValue([activeJob()]);
    await startCronDaemon();

    const status = getCronDaemonStatus();
    expect(status.running).toBe(true);
    expect(status.registeredJobs).toBe(1);
    expect(status.daemonId).toContain("cron-daemon-");
    expect(status.lastHeartbeatAt).toBeInstanceOf(Date);
  });

  it("stopCronDaemon destroys all tasks and flips running to false", async () => {
    prisma.cronJob.findMany.mockResolvedValue([activeJob(), activeJob({ id: "job-2" })]);
    await startCronDaemon();

    stopCronDaemon();

    expect(getCronDaemonStatus().running).toBe(false);
    expect(getRegisteredJobIds()).toEqual([]);
    for (const s of mockScheduled) expect(s.task.destroy).toHaveBeenCalled();
  });
});

describe("restart after stopCronDaemon (watchdog onLost → stop → re-acquire self-heal path)", () => {
  it("stop followed by a fresh start re-registers tasks as a NON-idempotent boot", async () => {
    prisma.cronJob.findMany.mockResolvedValue([activeJob()]);
    await startCronDaemon();
    expect(getCronDaemonStatus().running).toBe(true);
    expect(mockSchedule).toHaveBeenCalledTimes(1);

    // Instrumentation's cron onLost → stopCronDaemon() (v3.28.2).
    stopCronDaemon();
    expect(getCronDaemonStatus().running).toBe(false);
    expect(getRegisteredJobIds()).toEqual([]);
    expect(mockScheduled[0].task.destroy).toHaveBeenCalled();

    // Later onAcquired → startCronDaemon() again. The stale `running` guard
    // must NOT short-circuit the restart (alreadyRunning false = real boot),
    // and the jobs must be re-registered on the scheduler.
    const restart = await startCronDaemon();
    expect(restart).toEqual({ alreadyRunning: false, registeredJobs: 1 });
    expect(mockSchedule).toHaveBeenCalledTimes(2);
    expect(getRegisteredJobIds()).toEqual(["job-1"]);
    expect(getCronDaemonStatus().running).toBe(true);
    // one initial heartbeat per start (the interval timer is cleared on stop)
    expect(mockSqliteHeartbeat).toHaveBeenCalledTimes(2);
  });
});

describe("isDaemonHeartbeatFresh", () => {
  it("false for null heartbeat", () => {
    expect(isDaemonHeartbeatFresh(null)).toBe(false);
  });

  it("true within the window, false beyond it", () => {
    const now = Date.UTC(2026, 7, 15, 12, 0, 0);
    // v3.20.1: DAEMON_HEARTBEAT_WINDOW_MS = 2 × 900s = 1800s
    expect(isDaemonHeartbeatFresh(new Date(now - 60_000), now)).toBe(true);
    expect(isDaemonHeartbeatFresh(new Date(now - 120_000), now)).toBe(true);
    expect(isDaemonHeartbeatFresh(new Date(now - 1799_000), now)).toBe(true); // just within 1800s window
    expect(isDaemonHeartbeatFresh(new Date(now - 1801_000), now)).toBe(false); // just beyond 1800s window
    expect(isDaemonHeartbeatFresh(new Date(now + 60_000), now)).toBe(true); // future clock skew tolerated
  });
});
