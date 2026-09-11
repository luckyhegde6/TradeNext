/**
 * Tests for worker-engine (lib/services/worker/worker-engine.ts) — v3.8.0:
 *   - reapStaleWorkerTasks: reaps WorkerTasks + DailyRecommendationRuns stuck
 *     in "running" past the 30-min staleness threshold; graceful on errors.
 *   - checkScheduledJobs: dedup guard — skips spawning when a task for the
 *     same cron job is already pending/running (still advances nextRun).
 *   - v3.37.0 (issue #119): TASK_TIMEOUT_MS 240 min + TASK_HEARTBEAT_MS busy
 *     heartbeat; reaper + pollAndExecute catch both record the cron-ledger
 *     OUTCOME (failed) via recordSystemRunOutcome BEFORE the failed-status
 *     write; pollAndExecute lifecycle (claim, busy→idle heartbeats, timeout,
 *     breaker gating) covered with fake timers.
 *
 * IMPORTANT: Do NOT use `import { jest } from "@jest/globals"`.
 * SWC (used by next/jest) requires `jest` to be the global variable
 * for `jest.mock()` hoisting to work correctly.
 */

// ─── Mocks (MUST be before any imports — SWC hoists jest.mock) ─────────

jest.mock("@/lib/logger", () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { __esModule: true, default: mock, info: mock.info, warn: mock.warn, error: mock.error, debug: mock.debug };
});

// v3.23.x: controlled mock so we can toggle the Prisma plan-limit breaker.
// Defaults to CLOSED (false) so the existing suite runs unchanged.
const mockIsPlanLimitBreakerOpen = jest.fn().mockReturnValue(false);
jest.mock("@/lib/db-utils", () => ({
  __esModule: true,
  isDbUnavailableError: jest.fn().mockReturnValue(false),
  isPlanLimitBreakerOpen: (...a: unknown[]) => mockIsPlanLimitBreakerOpen(...(a as [])) as boolean,
}));

jest.mock("@/lib/prisma", () => {
  const mock = {
    workerTask: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    dailyRecommendationRun: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    cronJob: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    workerStatus: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
  };
  return { __esModule: true, default: mock };
});

jest.mock("@/lib/services/worker/worker-service", () => ({
  __esModule: true,
  executeTask: jest.fn(),
  // v3.37.0 (issue #119 Fix 4): worker-engine now imports + calls
  // recordSystemRunOutcome (cron-ledger outcome recording from the engine
  // catch + reaper). The mock MUST export it or the binding is undefined and
  // the reaper loop throws mid-reap (aborting before the updateMany).
  recordSystemRunOutcome: jest.fn(() => Promise.resolve()),
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

// v3.37.0 (issue #119): pollAndExecute's discovery path tries the SQLite
// mirror FIRST (`getSqliteControl()`), falling back to Prisma when absent.
// Mock it as ABSENT (null) so the poll tests exercise the Prisma path and the
// `sql?.upsertWorkerTask?.(...)` mirror syncs are consistent no-ops.
jest.mock("@/lib/sqlite", () => ({
  __esModule: true,
  getSqliteFallback: jest.fn(() => null),
}));

// Dynamically imported inside checkScheduledJobs
jest.mock("@/lib/services/worker/task-orchestrator", () => ({
  __esModule: true,
  spawnCronTask: jest.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────

import {
  reapStaleWorkerTasks,
  checkScheduledJobs,
  pollAndExecute,
  STALE_MS,
  TASK_TIMEOUT_MS,
  TASK_HEARTBEAT_MS,
} from "@/lib/services/worker/worker-engine";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const prisma = require("@/lib/prisma").default as Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { spawnCronTask: mockSpawnCronTask } = require("@/lib/services/worker/task-orchestrator") as { spawnCronTask: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { executeTask: mockExecuteTask, recordSystemRunOutcome: mockRecordSystemRunOutcome } = require(
  "@/lib/services/worker/worker-service",
) as { executeTask: jest.Mock; recordSystemRunOutcome: jest.Mock };

describe("reapStaleWorkerTasks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // No live workers by default — everything is reapable unless a test
    // marks a worker alive via workerStatus.findMany.
    prisma.workerStatus.findMany.mockResolvedValue([]);
    prisma.workerTask.findMany.mockResolvedValue([]);
    prisma.dailyRecommendationRun.findMany.mockResolvedValue([]);
  });

  it("reaps WorkerTasks stuck in running past the threshold", async () => {
    prisma.workerTask.findMany.mockResolvedValue([
      { id: "t1", taskType: "recommendations" },
      { id: "t2", taskType: "market_data" },
    ]);

    const result = await reapStaleWorkerTasks();

    expect(result).toEqual({ reapedTasks: 2, reapedRuns: 0 });
    // v3.37.0 (issue #119): each reaped task records a cron-ledger FAILED
    // outcome FIRST (recordSystemRunOutcome's guard requires status
    // "running"), then the status write flips it to failed.
    expect(mockRecordSystemRunOutcome).toHaveBeenCalledTimes(2);
    expect(mockRecordSystemRunOutcome).toHaveBeenNthCalledWith(1, "t1", "recommendations", false);
    expect(mockRecordSystemRunOutcome).toHaveBeenNthCalledWith(2, "t2", "market_data", false);
    const outcomeOrder = mockRecordSystemRunOutcome.mock.invocationCallOrder;
    expect(Math.max(...outcomeOrder)).toBeLessThan(
      (prisma.workerTask.updateMany as jest.Mock).mock.invocationCallOrder[0],
    );
    expect(prisma.workerTask.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["t1", "t2"] } },
      data: expect.objectContaining({
        status: "failed",
        completedAt: expect.any(Date),
        error: expect.stringContaining("45 min"),
      }),
    });
  });

  it("reaps DailyRecommendationRuns stuck in running (keyed on createdAt)", async () => {
    prisma.dailyRecommendationRun.findMany.mockResolvedValue([{ id: "run-1" }]);

    const result = await reapStaleWorkerTasks();

    expect(result).toEqual({ reapedTasks: 0, reapedRuns: 1 });
    expect(prisma.dailyRecommendationRun.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["run-1"] } },
      data: expect.objectContaining({
        status: "failed",
        errorMessage: expect.stringContaining("45 min"),
      }),
    });
  });

  // ── v3.12.0 heartbeat awareness ──────────────────────────────────────────

  it("does NOT reap tasks whose owner worker has a fresh heartbeat", async () => {
    // worker-live has a recent heartbeat; worker-gone is dead.
    prisma.workerStatus.findMany.mockResolvedValue([{ workerId: "worker-live" }]);
    prisma.workerTask.findMany
      .mockResolvedValueOnce([
        { id: "t-live", assignedTo: "worker-live", taskType: "recommendations" },
        { id: "t-dead", assignedTo: "worker-gone", taskType: "market_data" },
      ])
      .mockResolvedValueOnce([]); // no live run producers

    const result = await reapStaleWorkerTasks();

    expect(result).toEqual({ reapedTasks: 1, reapedRuns: 0 });
    // ONLY the dead-owner task is reaped — the live one is left alone.
    expect(prisma.workerTask.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["t-dead"] } },
      data: expect.objectContaining({ status: "failed" }),
    });
    // ...and only the dead-owner task records a failed outcome.
    expect(mockRecordSystemRunOutcome).toHaveBeenCalledTimes(1);
    expect(mockRecordSystemRunOutcome).toHaveBeenCalledWith("t-dead", "market_data", false);
    // The liveness probe queries heartbeats within the alive window.
    expect(prisma.workerStatus.findMany).toHaveBeenCalledWith({
      where: { lastHeartbeat: { gte: expect.any(Date) } },
      select: { workerId: true },
    });
  });

  it("reaps tasks with no owner at all (legacy rows)", async () => {
    prisma.workerStatus.findMany.mockResolvedValue([{ workerId: "worker-live" }]);
    prisma.workerTask.findMany
      .mockResolvedValueOnce([{ id: "t-noowner", assignedTo: null, taskType: "recommendations" }])
      .mockResolvedValueOnce([]);

    const result = await reapStaleWorkerTasks();

    expect(result).toEqual({ reapedTasks: 1, reapedRuns: 0 });
    expect(mockRecordSystemRunOutcome).toHaveBeenCalledTimes(1);
    expect(mockRecordSystemRunOutcome).toHaveBeenCalledWith("t-noowner", "recommendations", false);
    expect(prisma.workerTask.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["t-noowner"] } },
      data: expect.objectContaining({ status: "failed" }),
    });
  });

  it("does NOT reap runs while a live worker is executing a recommendations task", async () => {
    prisma.workerStatus.findMany.mockResolvedValue([{ workerId: "worker-live" }]);
    prisma.workerTask.findMany
      .mockResolvedValueOnce([]) // no stale tasks
      .mockResolvedValueOnce([{ id: "task-rec" }]); // live producer in flight
    prisma.dailyRecommendationRun.findMany.mockResolvedValue([{ id: "run-1" }]);

    const result = await reapStaleWorkerTasks();

    expect(result).toEqual({ reapedTasks: 0, reapedRuns: 0 });
    expect(prisma.dailyRecommendationRun.updateMany).not.toHaveBeenCalled();
    // v3.37.0 (issue #119): run reaping never records a cron-ledger outcome —
    // no task was reaped, so recordSystemRunOutcome must stay untouched.
    expect(mockRecordSystemRunOutcome).not.toHaveBeenCalled();
  });

  it("reaps runs when the run-producing worker is dead", async () => {
    // No live workers at all → no live producers → stale run is reaped.
    prisma.workerStatus.findMany.mockResolvedValue([]);
    prisma.workerTask.findMany
      .mockResolvedValueOnce([
        { id: "task-rec", assignedTo: "worker-dead", taskType: "recommendations" },
      ])
      .mockResolvedValueOnce([]); // live producers = none
    prisma.dailyRecommendationRun.findMany.mockResolvedValue([{ id: "run-1" }]);

    const result = await reapStaleWorkerTasks();

    expect(result).toEqual({ reapedTasks: 1, reapedRuns: 1 });
    // v3.37.0 (issue #119): the dead producer task IS reaped, so it records a
    // FAILED cron-ledger outcome first (the run reap itself never records).
    expect(mockRecordSystemRunOutcome).toHaveBeenCalledTimes(1);
    expect(mockRecordSystemRunOutcome).toHaveBeenCalledWith("task-rec", "recommendations", false);
    expect(prisma.dailyRecommendationRun.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["run-1"] } },
      data: expect.objectContaining({ status: "failed" }),
    });
  });

  it("is a no-op when nothing is stale", async () => {
    const result = await reapStaleWorkerTasks();
    expect(result).toEqual({ reapedTasks: 0, reapedRuns: 0 });
    expect(prisma.workerTask.updateMany).not.toHaveBeenCalled();
    expect(prisma.dailyRecommendationRun.updateMany).not.toHaveBeenCalled();
    expect(mockRecordSystemRunOutcome).not.toHaveBeenCalled();
  });

  it("never throws when the DB fails — returns zeros", async () => {
    prisma.workerStatus.findMany.mockRejectedValue(new Error("db down"));

    const result = await reapStaleWorkerTasks();

    expect(result).toEqual({ reapedTasks: 0, reapedRuns: 0 });
    expect(prisma.workerTask.updateMany).not.toHaveBeenCalled();
    expect(prisma.dailyRecommendationRun.updateMany).not.toHaveBeenCalled();
    expect(mockRecordSystemRunOutcome).not.toHaveBeenCalled();
  });
});

describe("checkScheduledJobs", () => {
  const dueJob = {
    id: "job-1",
    name: "Daily Recommendations (System)",
    isActive: true,
    nextRun: new Date(Date.now() - 60_000), // due
    cronExpression: "30 4 * * 1-5",
    taskType: "recommendations",
    config: { systemManaged: true },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.cronJob.findMany.mockResolvedValue([dueJob]);
    prisma.cronJob.update.mockResolvedValue({});
    mockSpawnCronTask.mockResolvedValue({});
  });

  it("skips spawning when a task for the same cron job is already pending/running", async () => {
    prisma.workerTask.findFirst.mockResolvedValue({ id: "task-1", name: "Scheduled: Daily Recommendations (System)" });

    await checkScheduledJobs();

    expect(mockSpawnCronTask).not.toHaveBeenCalled();
    // nextRun still advanced so the schedule keeps ticking
    expect(prisma.cronJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({ nextRun: expect.any(Date) }),
    });
  });

  it("spawns a task and advances nextRun when no recent task exists", async () => {
    prisma.workerTask.findFirst.mockResolvedValue(null);

    await checkScheduledJobs();

    expect(mockSpawnCronTask).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        name: "Scheduled: Daily Recommendations (System)",
        taskType: "recommendations",
        triggeredBy: "system",
      }),
    );
    expect(prisma.cronJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({ nextRun: expect.any(Date) }),
    });
  });

  it("is a no-op when no cron jobs are due", async () => {
    prisma.cronJob.findMany.mockResolvedValue([]);

    await checkScheduledJobs();

    expect(mockSpawnCronTask).not.toHaveBeenCalled();
    expect(prisma.workerTask.findFirst).not.toHaveBeenCalled();
  });
});

// ─── v3.16.0 timeout constants ────────────────────────────────────────────

describe("timeout constants", () => {
  it("STALE_MS is 45 minutes", () => {
    expect(STALE_MS).toBe(45 * 60_000);
  });

  // v3.37.0 (issue #119): TASK_TIMEOUT_MS raised 40 → 240 min as a pure
  // last-resort safety net. The old "TASK_TIMEOUT_MS must be less than
  // STALE_MS" rule is GONE — a legitimately slow task is kept alive for the
  // cross-instance reaper by the per-task BUSY heartbeat, not by racing the
  // timeout.
  it("TASK_TIMEOUT_MS is 240 minutes", () => {
    expect(TASK_TIMEOUT_MS).toBe(240 * 60_000);
  });

  it("TASK_HEARTBEAT_MS is 4 minutes (busy heartbeat outruns STALE_MS)", () => {
    expect(TASK_HEARTBEAT_MS).toBe(240_000);
    expect(TASK_HEARTBEAT_MS).toBeLessThan(STALE_MS);
  });
});

// ─── v3.23.x: plan-limit breaker gating (user directive) ──────────────────
// When the Prisma plan-limit breaker is OPEN (account on hold / DB down), the
// worker poll, the stale-task reaper and the cron scheduler all SKIP their
// Prisma reads entirely — they no-op and re-check once the breaker closes.
// This eliminates the prod "Worker DB unavailable — backing off poll" and
// "Stale worker-task reap failed" spam every 30s × instances during a hold.

describe("plan-limit breaker gating", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsPlanLimitBreakerOpen.mockReturnValue(false);
  });

  it("reapStaleWorkerTasks is a no-op (0/0) when the breaker is OPEN", async () => {
    mockIsPlanLimitBreakerOpen.mockReturnValue(true);
    const result = await reapStaleWorkerTasks();
    expect(result).toEqual({ reapedTasks: 0, reapedRuns: 0 });
    // No Prisma reads/writes were attempted while the breaker is open.
    expect(prisma.workerStatus.findMany).not.toHaveBeenCalled();
    expect(prisma.workerTask.findMany).not.toHaveBeenCalled();
    expect(prisma.dailyRecommendationRun.findMany).not.toHaveBeenCalled();
    expect(prisma.workerTask.updateMany).not.toHaveBeenCalled();
    expect(mockRecordSystemRunOutcome).not.toHaveBeenCalled();
  });

  it("checkScheduledJobs performs no Prisma cron read when the breaker is OPEN", async () => {
    mockIsPlanLimitBreakerOpen.mockReturnValue(true);
    prisma.cronJob.findMany.mockResolvedValue([]);
    await checkScheduledJobs();
    expect(prisma.cronJob.findMany).not.toHaveBeenCalled();
    expect(mockSpawnCronTask).not.toHaveBeenCalled();
  });
});

// ─── v3.37.0 (issue #119): pollAndExecute lifecycle ───────────────────────
// Covers: the atomic claim (updateMany pending → running), the immediate
// busy heartbeat, the 4-min busy-heartbeat interval while a long task runs,
// the 240-min last-resort timeout, the engine-catch cron-ledger OUTCOME
// recorded BEFORE the failed-status write, and plan-limit breaker gating.

async function flushMicrotasks(count = 40) {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
  }
}

describe("pollAndExecute", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockIsPlanLimitBreakerOpen.mockReturnValue(false);
    // maybeReap runs on the FIRST poll of the suite (lastReapAt starts at 0
    // and the faked Date.now is far newer) — empty reaper reads keep it a
    // no-op. Later polls are throttled by REAP_INTERVAL_MS so they skip it.
    prisma.workerStatus.findMany.mockResolvedValue([]);
    prisma.workerTask.findMany.mockResolvedValue([]);
    prisma.dailyRecommendationRun.findMany.mockResolvedValue([]);
    prisma.workerTask.findFirst.mockResolvedValue({
      id: "task-1",
      name: "Test Task",
      taskType: "recommendations",
      payload: { x: 1 },
      status: "pending",
      cronJobId: "job-1",
    });
    prisma.workerTask.updateMany.mockResolvedValue({ count: 1 });
    prisma.workerTask.update.mockResolvedValue({});
    prisma.workerStatus.upsert.mockResolvedValue({});
    mockExecuteTask.mockResolvedValue({ success: true, result: { x: 1 } });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("claims a pending task, runs it, writes completed + idle heartbeat", async () => {
    await pollAndExecute();

    // Atomic claim: pending → running assigned to this worker.
    expect(prisma.workerTask.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.workerTask.updateMany).toHaveBeenCalledWith({
      where: { id: "task-1", status: "pending" },
      data: expect.objectContaining({
        status: "running",
        assignedTo: expect.stringContaining("worker-"),
        startedAt: expect.any(Date),
      }),
    });

    expect(mockExecuteTask).toHaveBeenCalledWith("task-1", "recommendations", { x: 1 });

    expect(prisma.workerTask.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: expect.objectContaining({
        status: "completed",
        completedAt: expect.any(Date),
        result: { x: 1 },
        error: null,
      }),
    });

    // Immediate busy heartbeat at claim + idle heartbeat in finally = 2 upserts.
    expect(prisma.workerStatus.upsert).toHaveBeenCalledTimes(2);
    const firstHeartbeat = (prisma.workerStatus.upsert as jest.Mock).mock.calls[0][0];
    expect(firstHeartbeat.create.currentTaskId).toBe("task-1");
    expect(firstHeartbeat.create.status).toBe("busy");
    const idleHeartbeat = (prisma.workerStatus.upsert as jest.Mock).mock.calls[1][0];
    expect(idleHeartbeat.create.currentTaskId).toBeNull();
    expect(idleHeartbeat.create.status).toBe("idle");
  });

  it("skips execution when another worker wins the atomic claim (count 0)", async () => {
    prisma.workerTask.updateMany.mockResolvedValue({ count: 0 });
    await pollAndExecute();
    expect(mockExecuteTask).not.toHaveBeenCalled();
    expect(prisma.workerStatus.upsert).not.toHaveBeenCalled();
    expect(prisma.workerTask.update).not.toHaveBeenCalled();
  });

  it("no-ops when there is no pending task", async () => {
    prisma.workerTask.findFirst.mockResolvedValue(null);
    await pollAndExecute();
    expect(prisma.workerTask.updateMany).not.toHaveBeenCalled();
    expect(mockExecuteTask).not.toHaveBeenCalled();
    expect(prisma.workerStatus.upsert).not.toHaveBeenCalled();
  });

  it("no-ops entirely when the plan-limit breaker is OPEN", async () => {
    mockIsPlanLimitBreakerOpen.mockReturnValue(true);
    await pollAndExecute();
    expect(prisma.workerTask.findFirst).not.toHaveBeenCalled();
    expect(prisma.workerTask.updateMany).not.toHaveBeenCalled();
    expect(prisma.workerStatus.upsert).not.toHaveBeenCalled();
    expect(mockExecuteTask).not.toHaveBeenCalled();
  });

  it("records the cron-ledger FAILURE before the failed-status write on error", async () => {
    mockExecuteTask.mockRejectedValue(new Error("boom"));
    await pollAndExecute();

    expect(mockRecordSystemRunOutcome).toHaveBeenCalledWith("task-1", "recommendations", false);
    expect(prisma.workerTask.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: expect.objectContaining({ status: "failed", error: "boom" }),
    });
    const outcomeOrder = (mockRecordSystemRunOutcome as jest.Mock).mock.invocationCallOrder[0];
    const updateOrder = (prisma.workerTask.update as jest.Mock).mock.invocationCallOrder[0];
    expect(outcomeOrder).toBeLessThan(updateOrder);
  });

  it("emits a busy heartbeat every TASK_HEARTBEAT_MS while a long task runs", async () => {
    let resolveExecute: (v: unknown) => void = () => {};
    const gate = new Promise((res) => {
      resolveExecute = res as (v: unknown) => void;
    });
    mockExecuteTask.mockReturnValue(gate);

    const pollPromise = pollAndExecute();
    await flushMicrotasks(30);

    await jest.advanceTimersByTimeAsync(TASK_HEARTBEAT_MS);
    await flushMicrotasks(20);
    await jest.advanceTimersByTimeAsync(TASK_HEARTBEAT_MS);
    await flushMicrotasks(20);

    // Immediate busy heartbeat + 2 interval ticks (no idle yet — task running).
    expect(prisma.workerStatus.upsert).toHaveBeenCalledTimes(3);

    resolveExecute({ success: true, result: { x: 1 } });
    await pollPromise;

    // + idle heartbeat in finally; the interval stops after the task ends.
    expect(prisma.workerStatus.upsert).toHaveBeenCalledTimes(4);
    expect(prisma.workerTask.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: expect.objectContaining({ status: "completed" }),
    });
  });

  it("fails the task via the 240-min timeout and records the ledger outcome first", async () => {
    mockExecuteTask.mockReturnValue(new Promise<unknown>(() => {})); // never settles
    const pollPromise = pollAndExecute();
    await flushMicrotasks(30);

    await jest.advanceTimersByTimeAsync(TASK_TIMEOUT_MS + 1000);
    await pollPromise;

    expect(mockRecordSystemRunOutcome).toHaveBeenCalledWith("task-1", "recommendations", false);
    expect(prisma.workerTask.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("timed out after 240 min"),
      }),
    });
    const outcomeOrder = (mockRecordSystemRunOutcome as jest.Mock).mock.invocationCallOrder[0];
    const updateOrder = (prisma.workerTask.update as jest.Mock).mock.invocationCallOrder[0];
    expect(outcomeOrder).toBeLessThan(updateOrder);
  });
});
