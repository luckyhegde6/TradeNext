/**
 * Tests for recordCronRun (lib/services/recommendationCronService.ts).
 *
 * Covers:
 *   - Success: finds job by name, sets lastRun, increments runCount +
 *     successCount, advances nextRun, returns updated ledger
 *   - Failure: increments failureCount instead of successCount
 *   - Missing job: safe no-op (found:false), never throws
 *   - Prisma error: caught, returns found:false
 *
 * IMPORTANT: Do NOT use `import { jest } from "@jest/globals"`.
 * SWC (used by next/jest) requires `jest` to be the global variable
 * for `jest.mock()` hoisting to work correctly.
 */

// â”€â”€â”€ Mocks (MUST be before any imports â€” SWC hoists jest.mock) â”€â”€â”€â”€â”€â”€â”€â”€â”€

jest.mock("@/lib/logger", () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { __esModule: true, default: mock, info: mock.info, warn: mock.warn, error: mock.error, debug: mock.debug };
});

jest.mock("@/lib/prisma", () => {
  const mock = {
    cronJob: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  return { __esModule: true, default: mock };
});

// â”€â”€â”€ Imports â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import {
  recordCronRun,
  ensureRecommendationCrons,
  RECOMMENDATION_CRON_NAME,
  RECOMMENDATION_CRON_EXPR,
  RECOMMENDATION_PERFORMANCE_CRON_NAME,
  RECOMMENDATION_PERFORMANCE_CRON_EXPR,
  MARKET_SYNC_CRON_NAME,
  MARKET_SYNC_CRON_EXPR,
  AI_CONNECTION_TEST_CRON_NAME,
  AI_CONNECTION_TEST_CRON_EXPR,
  SYSTEM_JOB_NAME_BY_TASK_TYPE,
} from "@/lib/services/recommendationCronService";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const prisma = require("@/lib/prisma").default as {
  cronJob: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
    deleteMany: jest.Mock;
  };
};

const JOB = {
  id: "job-1",
  name: RECOMMENDATION_CRON_NAME,
  cronExpression: "30 4 * * 1-5",
};

describe("recordCronRun", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("records a successful run (lastRun, runCount+1, successCount+1, nextRun advanced)", async () => {
    prisma.cronJob.findFirst.mockResolvedValue(JOB);
    prisma.cronJob.update.mockResolvedValue({
      ...JOB,
      lastRun: new Date("2026-08-11T05:00:00.000Z"),
      runCount: 1,
      successCount: 1,
      failureCount: 0,
      nextRun: new Date("2026-08-12T04:30:00.000Z"),
    });

    const result = await recordCronRun(RECOMMENDATION_CRON_NAME, true);

    expect(prisma.cronJob.findFirst).toHaveBeenCalledWith({
      where: { name: RECOMMENDATION_CRON_NAME },
    });
    expect(prisma.cronJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        lastRun: expect.any(Date),
        runCount: { increment: 1 },
        successCount: { increment: 1 },
        failureCount: undefined,
        nextRun: expect.any(Date),
      }),
    });
    expect(result).toEqual({
      found: true,
      lastRun: expect.any(Date),
      runCount: 1,
      successCount: 1,
      failureCount: 0,
      nextRun: expect.any(Date),
    });
  });

  it("increments failureCount (not successCount) on failed runs", async () => {
    prisma.cronJob.findFirst.mockResolvedValue(JOB);
    prisma.cronJob.update.mockResolvedValue({
      ...JOB,
      lastRun: new Date("2026-08-11T05:00:00.000Z"),
      runCount: 1,
      successCount: 0,
      failureCount: 1,
      nextRun: new Date("2026-08-12T04:30:00.000Z"),
    });

    const result = await recordCronRun(RECOMMENDATION_CRON_NAME, false);

    expect(prisma.cronJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        successCount: undefined,
        failureCount: { increment: 1 },
      }),
    });
    expect(result.found).toBe(true);
    expect(result.failureCount).toBe(1);
  });

  it("skipSpawnCounted writes outcome counters only (no runCount/nextRun double-count)", async () => {
    prisma.cronJob.findFirst.mockResolvedValue(JOB);
    prisma.cronJob.update.mockResolvedValue({
      ...JOB,
      lastRun: new Date("2026-08-11T05:00:00.000Z"),
      runCount: 1,
      successCount: 1,
      failureCount: 0,
      nextRun: new Date("2026-08-12T04:30:00.000Z"),
    });

    const result = await recordCronRun(RECOMMENDATION_CRON_NAME, true, { skipSpawnCounted: true });

    expect(prisma.cronJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        lastRun: expect.any(Date),
        successCount: { increment: 1 },
      }),
    });
    // The spawn-timed path already counted the run â€” outcome recording must not.
    const updateArg = prisma.cronJob.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateArg.data).not.toHaveProperty("runCount");
    expect(updateArg.data).not.toHaveProperty("nextRun");
    expect(result.found).toBe(true);
  });

  it("is a safe no-op when the job does not exist", async () => {
    prisma.cronJob.findFirst.mockResolvedValue(null);

    const result = await recordCronRun("Nonexistent Job", true);

    expect(prisma.cronJob.update).not.toHaveBeenCalled();
    expect(result).toEqual({ found: false });
  });

  it("never throws when prisma fails â€” returns found:false", async () => {
    prisma.cronJob.findFirst.mockRejectedValue(new Error("db down"));

    const result = await recordCronRun(RECOMMENDATION_CRON_NAME, true);

    expect(result).toEqual({ found: false });
  });

  it("never throws when update fails â€” returns found:false", async () => {
    prisma.cronJob.findFirst.mockResolvedValue(JOB);
    prisma.cronJob.update.mockRejectedValue(new Error("update failed"));

    const result = await recordCronRun(RECOMMENDATION_CRON_NAME, true);

    expect(result).toEqual({ found: false });
  });
});

describe("ensureRecommendationCrons", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // No duplicates by default â€” the v3.8.0 dedupe post-pass is a no-op.
    prisma.cronJob.findMany.mockResolvedValue([]);
    prisma.cronJob.deleteMany.mockResolvedValue({ count: 0 });
  });

  it("creates the AI Connection Test job (taskType ai_connection_test, step-30 expr) alongside the other three system jobs", async () => {
    prisma.cronJob.findFirst.mockResolvedValue(null);

    const result = await ensureRecommendationCrons();

    expect(prisma.cronJob.create).toHaveBeenCalledTimes(4);
    const aiCall = prisma.cronJob.create.mock.calls.find(
      (args: unknown[]) => (args[0] as { data?: { name?: string } }).data?.name === AI_CONNECTION_TEST_CRON_NAME,
    );
    expect(aiCall).toBeDefined();
    const aiData = (aiCall as unknown[])[0] as { data: { taskType: string; cronExpression: string; isActive: boolean; config: Record<string, unknown> } };
    expect(aiData.data.taskType).toBe("ai_connection_test");
    expect(aiData.data.cronExpression).toBe(AI_CONNECTION_TEST_CRON_EXPR);
    expect(aiData.data.isActive).toBe(true);
    expect(aiData.data.config).toEqual({ systemManaged: true, timezone: "Asia/Kolkata" });

    expect(result.ensured).toBe(4);
    expect(result.jobs).toEqual(
      expect.arrayContaining([
        {
          name: AI_CONNECTION_TEST_CRON_NAME,
          taskType: "ai_connection_test",
          cronExpression: AI_CONNECTION_TEST_CRON_EXPR,
        },
      ]),
    );
  });

  it("recomputes nextRun (no create) when all four jobs exist unchanged", async () => {
    const existingByDef: Record<string, { id: string; name: string; taskType: string; cronExpression: string; isActive: boolean }> = {
      [RECOMMENDATION_CRON_NAME]: { id: "r1", name: RECOMMENDATION_CRON_NAME, taskType: "recommendations", cronExpression: RECOMMENDATION_CRON_EXPR, isActive: true },
      [RECOMMENDATION_PERFORMANCE_CRON_NAME]: { id: "r2", name: RECOMMENDATION_PERFORMANCE_CRON_NAME, taskType: "recommendation_performance", cronExpression: RECOMMENDATION_PERFORMANCE_CRON_EXPR, isActive: true },
      [MARKET_SYNC_CRON_NAME]: { id: "r3", name: MARKET_SYNC_CRON_NAME, taskType: "market_data", cronExpression: MARKET_SYNC_CRON_EXPR, isActive: true },
      [AI_CONNECTION_TEST_CRON_NAME]: { id: "r4", name: AI_CONNECTION_TEST_CRON_NAME, taskType: "ai_connection_test", cronExpression: AI_CONNECTION_TEST_CRON_EXPR, isActive: true },
    };
    prisma.cronJob.findFirst.mockImplementation(
      async ({ where }: { where: { name: string } }) => existingByDef[where.name] ?? null,
    );
    // clearAllMocks() does NOT clear implementations â€” recordCronRun tests
    // earlier in this file set update to reject with "db down", which would
    // poison this test. Set an explicit resolved implementation.
    prisma.cronJob.update.mockResolvedValue({});

    const result = await ensureRecommendationCrons();

    // v3.10.1: nextRun is ALWAYS recomputed with UTC semantics so rows
    // anchored by the old local-timezone parser self-correct. No create.
    expect(prisma.cronJob.create).not.toHaveBeenCalled();
    expect(prisma.cronJob.update).toHaveBeenCalledTimes(4);
    for (const call of prisma.cronJob.update.mock.calls) {
      const { data, where } = call[0] as { data: Record<string, unknown>; where: { id: string } };
      expect(where.id).toMatch(/^r[1-4]$/);
      // Only nextRun changes when the definition hasn't drifted.
      expect(Object.keys(data)).toEqual(["nextRun"]);
      expect(data.nextRun).toBeInstanceOf(Date);
    }
    expect(result.ensured).toBe(4);
  });

  it("self-heals a drifted AI Connection Test job (inactive/old expr) via update", async () => {
    prisma.cronJob.findFirst.mockResolvedValue({
      id: "r4",
      name: AI_CONNECTION_TEST_CRON_NAME,
      taskType: "ai_connection_test",
      cronExpression: "0 8 * * 1-5",
      isActive: false,
    });
    prisma.cronJob.update.mockResolvedValue({});

    const result = await ensureRecommendationCrons();

    expect(prisma.cronJob.update).toHaveBeenCalledWith({
      where: { id: "r4" },
      data: expect.objectContaining({
        taskType: "ai_connection_test",
        cronExpression: AI_CONNECTION_TEST_CRON_EXPR,
        isActive: true,
        config: { systemManaged: true, timezone: "Asia/Kolkata" },
      }),
    });
    expect(prisma.cronJob.create).not.toHaveBeenCalled();
    expect(result.ensured).toBe(4);
  });

  it("deletes duplicate system jobs keeping the earliest row (v3.8.0)", async () => {
    prisma.cronJob.findFirst.mockResolvedValue(null); // all four would be created fresh
    // â€¦but the DB already holds duplicates from a past findFirst-then-create race
    prisma.cronJob.findMany.mockResolvedValue([
      { id: "r1", name: RECOMMENDATION_CRON_NAME, createdAt: new Date("2026-08-01T00:00:00Z") },
      { id: "r1-dup", name: RECOMMENDATION_CRON_NAME, createdAt: new Date("2026-08-10T00:00:00Z") },
      { id: "r2", name: RECOMMENDATION_PERFORMANCE_CRON_NAME, createdAt: new Date("2026-08-01T00:00:00Z") },
      { id: "r3", name: MARKET_SYNC_CRON_NAME, createdAt: new Date("2026-08-01T00:00:00Z") },
      { id: "r4", name: AI_CONNECTION_TEST_CRON_NAME, createdAt: new Date("2026-08-01T00:00:00Z") },
    ]);
    prisma.cronJob.deleteMany.mockResolvedValue({ count: 1 });

    const result = await ensureRecommendationCrons();

    // Keep the EARLIEST row per name, delete only the later duplicate
    expect(prisma.cronJob.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["r1-dup"] } },
    });
    expect(result.ensured).toBe(4);
  });
});

describe("SYSTEM_JOB_NAME_BY_TASK_TYPE", () => {
  it("maps all four system task types to their job names", () => {
    expect(SYSTEM_JOB_NAME_BY_TASK_TYPE).toEqual({
      recommendations: RECOMMENDATION_CRON_NAME,
      recommendation_performance: RECOMMENDATION_PERFORMANCE_CRON_NAME,
      market_data: MARKET_SYNC_CRON_NAME,
      ai_connection_test: AI_CONNECTION_TEST_CRON_NAME,
    });
  });

  it("unknown task types map to undefined (outcome writer no-ops)", () => {
    expect(SYSTEM_JOB_NAME_BY_TASK_TYPE["alert_check"]).toBeUndefined();
    expect(SYSTEM_JOB_NAME_BY_TASK_TYPE["screener"]).toBeUndefined();
  });
});
