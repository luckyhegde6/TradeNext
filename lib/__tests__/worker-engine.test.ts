/**
 * Tests for worker-engine (lib/services/worker/worker-engine.ts) — v3.8.0:
 *   - reapStaleWorkerTasks: reaps WorkerTasks + DailyRecommendationRuns stuck
 *     in "running" past the 30-min staleness threshold; graceful on errors.
 *   - checkScheduledJobs: dedup guard — skips spawning when a task for the
 *     same cron job is already pending/running (still advances nextRun).
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

// Dynamically imported inside checkScheduledJobs
jest.mock("@/lib/services/worker/task-orchestrator", () => ({
  __esModule: true,
  spawnCronTask: jest.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────

import { reapStaleWorkerTasks, checkScheduledJobs, STALE_MS, TASK_TIMEOUT_MS } from "@/lib/services/worker/worker-engine";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const prisma = require("@/lib/prisma").default as Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { spawnCronTask: mockSpawnCronTask } = require("@/lib/services/worker/task-orchestrator") as { spawnCronTask: jest.Mock };

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
    prisma.workerTask.findMany.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);

    const result = await reapStaleWorkerTasks();

    expect(result).toEqual({ reapedTasks: 2, reapedRuns: 0 });
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
        { id: "t-live", assignedTo: "worker-live" },
        { id: "t-dead", assignedTo: "worker-gone" },
      ])
      .mockResolvedValueOnce([]); // no live run producers

    const result = await reapStaleWorkerTasks();

    expect(result).toEqual({ reapedTasks: 1, reapedRuns: 0 });
    // ONLY the dead-owner task is reaped — the live one is left alone.
    expect(prisma.workerTask.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["t-dead"] } },
      data: expect.objectContaining({ status: "failed" }),
    });
    // The liveness probe queries heartbeats within the alive window.
    expect(prisma.workerStatus.findMany).toHaveBeenCalledWith({
      where: { lastHeartbeat: { gte: expect.any(Date) } },
      select: { workerId: true },
    });
  });

  it("reaps tasks with no owner at all (legacy rows)", async () => {
    prisma.workerStatus.findMany.mockResolvedValue([{ workerId: "worker-live" }]);
    prisma.workerTask.findMany
      .mockResolvedValueOnce([{ id: "t-noowner", assignedTo: null }])
      .mockResolvedValueOnce([]);

    const result = await reapStaleWorkerTasks();

    expect(result).toEqual({ reapedTasks: 1, reapedRuns: 0 });
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
  });

  it("reaps runs when the run-producing worker is dead", async () => {
    // No live workers at all → no live producers → stale run is reaped.
    prisma.workerStatus.findMany.mockResolvedValue([]);
    prisma.workerTask.findMany
      .mockResolvedValueOnce([{ id: "task-rec", assignedTo: "worker-dead" }])
      .mockResolvedValueOnce([]); // live producers = none
    prisma.dailyRecommendationRun.findMany.mockResolvedValue([{ id: "run-1" }]);

    const result = await reapStaleWorkerTasks();

    expect(result).toEqual({ reapedTasks: 1, reapedRuns: 1 });
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
  });

  it("never throws when the DB fails — returns zeros", async () => {
    prisma.workerStatus.findMany.mockRejectedValue(new Error("db down"));

    const result = await reapStaleWorkerTasks();

    expect(result).toEqual({ reapedTasks: 0, reapedRuns: 0 });
    expect(prisma.workerTask.updateMany).not.toHaveBeenCalled();
    expect(prisma.dailyRecommendationRun.updateMany).not.toHaveBeenCalled();
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

  it("TASK_TIMEOUT_MS is 40 minutes (must be less than STALE_MS)", () => {
    expect(TASK_TIMEOUT_MS).toBe(40 * 60_000);
    expect(TASK_TIMEOUT_MS).toBeLessThan(STALE_MS);
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
  });

  it("checkScheduledJobs performs no Prisma cron read when the breaker is OPEN", async () => {
    mockIsPlanLimitBreakerOpen.mockReturnValue(true);
    prisma.cronJob.findMany.mockResolvedValue([]);
    await checkScheduledJobs();
    expect(prisma.cronJob.findMany).not.toHaveBeenCalled();
    expect(mockSpawnCronTask).not.toHaveBeenCalled();
  });
});
