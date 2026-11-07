/**
 * Tests for worker-service recordSystemRunOutcome — v3.37.0 (issue #119 Fix 4).
 *
 * recordSystemRunOutcome(taskId, taskType, success) is the SINGLE writer for
 * system-cron run OUTCOMES (successCount / failureCount) from the engine:
 *
 *   - Look up the task by id (cronJobId + status only)
 *   - Skip when the task type has no system job mapping (manual/arbitrary types)
 *   - Skip when the task is NOT linked to a cron job (manual admin runs)
 *   - v3.37.0 GUARD: skip when the task is no longer RUNNING — the engine's
 *     240-min timeout path and the stale-task reaper now record the outcome
 *     THEMSELVES (before their failed-status write). A late background
 *     continuation of executeTask() must skip here so a single run is never
 *     double-counted on the cron ledger.
 *   - Never throws (non-fatal): a DB failure must not break the task flow.
 *
 * When recording, recordCronRun is always called with skipSpawnCounted:true —
 * spawned system tasks already advanced runCount/nextRun at spawn time.
 *
 * SYSTEM_JOB_NAME_BY_TASK_TYPE fixture below mirrors the real map in
 * recommendationCronService.ts L52-57 (recommendations /
 * recommendation_performance / market_data / ai_connection_test).
 */

// ─── Mocks (MUST be before any imports — SWC hoists jest.mock) ─────────

jest.mock("@/lib/logger", () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { __esModule: true, default: mock, info: mock.info, warn: mock.warn, error: mock.error, debug: mock.debug };
});

jest.mock("@/lib/prisma", () => {
  const mock = {
    workerTask: {
      findUnique: jest.fn(),
    },
    cronJob: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  return { __esModule: true, default: mock };
});

jest.mock("@/lib/index-service", () => ({
  __esModule: true,
  getIndexStocks: jest.fn(),
  syncStocksToDatabase: jest.fn(),
}));

jest.mock("@/lib/services/worker/task-orchestrator", () => ({
  __esModule: true,
  logTaskEvent: jest.fn(),
}));

// Record the outcome only — recordCronRun is mocked; the fixture map mirrors
// recommendationCronService.ts L52-57.
jest.mock("@/lib/services/dailyRecommendationService", () => ({
  checkRecommendationPerformance: jest.fn(async () => ({ checked: 12, updated: 10, skippedNoPrice: 2, targetAchieved: 3, stopLossHit: 1 })),
  runDailyRecommendations: jest.fn(async () => ({
    runId: "run-ai-down",
    totalScreeners: 7,
    successfulScreeners: 7,
    totalStocks: 100,
    uniqueStocks: 0,
    aiProcessed: 0,
    aiFailed: 100,
    executionTimeMs: 1234,
    stocks: [],
  })),
}));
jest.mock("@/lib/services/googleSheets/metricsService", () => ({
  getMetrics: jest.fn(async () => ({ ok: true, snapshot: { snapshotAt: "2026-11-04T10:00:00.000Z", totalTracked: 10 } })),
}));
jest.mock("@/lib/services/googleSheets/exporter", () => ({
  exportMetricsSnapshot: jest.fn(async () => "enabled"),
}));
jest.mock("@/lib/services/swingPerformanceService", () => ({
  checkSwingPerformance: jest.fn(async () => ({ checked: 5, targetAchieved: 2, stopLossHit: 1, expired: 0, updated: 3 })),
}));

jest.mock("@/lib/services/recommendationCronService", () => ({
  __esModule: true,
  SYSTEM_JOB_NAME_BY_TASK_TYPE: {
    recommendations: "Daily Recommendations (System)",
    recommendation_performance: "Recommendation Performance Check (System)",
    market_data: "Daily Market Sync (System)",
    ai_connection_test: "AI Connection Test (System)",
  },
  recordCronRun: jest.fn(() => Promise.resolve({ found: true })),
}));

// ─── Imports ──────────────────────────────────────────────────────────────

import { executeTask, recordSystemRunOutcome } from "@/lib/services/worker/worker-service";
import { logTaskEvent } from "@/lib/services/worker/task-orchestrator";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const prisma = require("@/lib/prisma").default as Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { recordCronRun: mockRecordCronRun } = require("@/lib/services/recommendationCronService") as {
  recordCronRun: jest.Mock;
};

const RUNNING_TASK = { cronJobId: "job-1", status: "running" };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.workerTask.findUnique.mockResolvedValue(RUNNING_TASK);
  mockRecordCronRun.mockResolvedValue({ found: true });
});

describe("recordSystemRunOutcome (v3.37.0 Fix 4 guards)", () => {
  test("records a SUCCESS outcome for a linked running task with skipSpawnCounted", async () => {
    await recordSystemRunOutcome("task-1", "recommendations", true);

    expect(prisma.workerTask.findUnique).toHaveBeenCalledWith({
      where: { id: "task-1" },
      select: { cronJobId: true, status: true },
    });
    expect(mockRecordCronRun).toHaveBeenCalledTimes(1);
    expect(mockRecordCronRun).toHaveBeenCalledWith("Daily Recommendations (System)", true, {
      skipSpawnCounted: true,
    });
  });

  test("records a FAILURE outcome with skipSpawnCounted", async () => {
    await recordSystemRunOutcome("task-1", "recommendations", false);

    expect(mockRecordCronRun).toHaveBeenCalledTimes(1);
    expect(mockRecordCronRun).toHaveBeenCalledWith("Daily Recommendations (System)", false, {
      skipSpawnCounted: true,
    });
  });

  test("v3.37.0 guard: skips tasks that are no longer RUNNING (timeout/reaper already recorded)", async () => {
    for (const status of ["failed", "completed", "pending", "canceled"]) {
      prisma.workerTask.findUnique.mockResolvedValue({ cronJobId: "job-1", status });

      await recordSystemRunOutcome("task-1", "recommendations", false);

      expect(mockRecordCronRun).not.toHaveBeenCalled();
    }
  });

  test("passes through the mapped job name for every other system task type", async () => {
    const cases = [
      ["recommendation_performance", "Recommendation Performance Check (System)", true],
      ["market_data", "Daily Market Sync (System)", true],
      ["ai_connection_test", "AI Connection Test (System)", true],
    ] as const;

    for (const [taskType, jobName, success] of cases) {
      await recordSystemRunOutcome("task-1", taskType, success as boolean);
      expect(mockRecordCronRun).toHaveBeenLastCalledWith(jobName, success, { skipSpawnCounted: true });
    }
    expect(mockRecordCronRun).toHaveBeenCalledTimes(3);
  });

  test("graceful guard: unmapped type makes zero Prisma calls; DB failure never throws", async () => {
    // Unmapped task type → no Prisma read, no ledger write.
    await recordSystemRunOutcome("task-1", "csv_processing", false);
    expect(prisma.workerTask.findUnique).not.toHaveBeenCalled();
    expect(mockRecordCronRun).not.toHaveBeenCalled();

    // DB failure on a mapped type → resolves without throwing (non-fatal), warn logged.
    prisma.workerTask.findUnique.mockRejectedValue(new Error("db boom"));
    await expect(recordSystemRunOutcome("task-1", "market_data", false)).resolves.toBeUndefined();
    expect(mockRecordCronRun).not.toHaveBeenCalled();
  });
});

describe("daily recommendation task outcome timeline", () => {
  test("records AI-unavailable run outcome and counts under the worker task", async () => {
    const result = await executeTask("task-daily-1", "recommendations", { source: "admin_manual" });
    expect(result.success).toBe(true);
    expect(logTaskEvent).toHaveBeenCalledWith(
      "task-daily-1",
      "task_progress",
      "Daily recommendations pipeline finished",
      {
        runId: "run-ai-down",
        runOutcome: "ai_unavailable",
        totalStocks: 100,
        aiProcessed: 0,
        aiFailed: 100,
        successfulScreeners: 7,
        executionTimeMs: 1234,
        triggeredBy: "admin",
      },
    );
  });
});

describe("recommendation performance task event timeline", () => {
  test("records main performance and Swing companion progress under the same task", async () => {
    const result = await executeTask("task-performance-1", "recommendation_performance");
    expect(result.success).toBe(true);
    expect(logTaskEvent).toHaveBeenCalledWith(
      "task-performance-1",
      "task_progress",
      "Recommendation performance check completed",
      { checked: 12, updated: 10, skippedNoPrice: 2, targetAchieved: 3, stopLossHit: 1, success: true },
    );
    expect(logTaskEvent).toHaveBeenCalledWith(
      "task-performance-1",
      "task_progress",
      "Swing performance companion started",
    );
    expect(logTaskEvent).toHaveBeenCalledWith(
      "task-performance-1",
      "task_progress",
      "Swing performance companion completed",
      { checked: 5, targetAchieved: 2, stopLossHit: 1, expired: 0 },
    );
    expect(logTaskEvent).toHaveBeenCalledWith(
      "task-performance-1",
      "task_progress",
      "Google Sheets KPI snapshot publish finished",
      { outcome: "enabled", snapshotAt: "2026-11-04T10:00:00.000Z", totalTracked: 10 },
    );
  });

  test("Swing companion failure is logged as a non-fatal task progress event", async () => {
    const swing = jest.requireMock("@/lib/services/swingPerformanceService").checkSwingPerformance as jest.Mock;
    swing.mockRejectedValueOnce(new Error("private provider details"));
    const result = await executeTask("task-performance-2", "recommendation_performance");
    expect(result.success).toBe(true);
    expect(logTaskEvent).toHaveBeenCalledWith(
      "task-performance-2",
      "task_progress",
      "Swing performance companion failed (non-fatal)",
      { errorType: "Error" },
    );
  });
});
