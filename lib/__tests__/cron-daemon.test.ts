/**
 * Tests for the in-process cron daemon (lib/services/worker/cron-daemon.ts) —
 * v3.11.0. Covers:
 *   - startCronDaemon: ensures system crons, registers active jobs on the
 *     node-cron scheduler (Asia/Kolkata default), idempotent second start.
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
  it("ensures system crons and registers each active job with Asia/Kolkata timezone", async () => {
    prisma.cronJob.findMany.mockResolvedValue([activeJob(), activeJob({ id: "job-2", cronExpression: "30 10 * * 1-5" })]);

    const result = await startCronDaemon();

    expect(mockEnsureCrons).toHaveBeenCalled();
    expect(result).toEqual({ alreadyRunning: false, registeredJobs: 2 });
    expect(mockSchedule).toHaveBeenCalledTimes(2);
    expect(mockSchedule.mock.calls[0]).toEqual([
      "30 4 * * 1-5",
      expect.any(Function),
      { timezone: "Asia/Kolkata" },
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

  it("writes an initial heartbeat row under the daemon workerId", async () => {
    await startCronDaemon();

    expect(prisma.workerStatus.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workerId: expect.stringContaining("cron-daemon-") },
        create: expect.objectContaining({ status: "idle", workerName: expect.stringContaining("cron-daemon") }),
      }),
    );
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

describe("isDaemonHeartbeatFresh", () => {
  it("false for null heartbeat", () => {
    expect(isDaemonHeartbeatFresh(null)).toBe(false);
  });

  it("true within the window, false beyond it", () => {
    const now = Date.UTC(2026, 7, 15, 12, 0, 0);
    expect(isDaemonHeartbeatFresh(new Date(now - 60_000), now)).toBe(true);
    expect(isDaemonHeartbeatFresh(new Date(now - 120_000), now)).toBe(true); // exact boundary
    expect(isDaemonHeartbeatFresh(new Date(now - 121_000), now)).toBe(false);
    expect(isDaemonHeartbeatFresh(new Date(now + 60_000), now)).toBe(true); // future clock skew tolerated
  });
});
