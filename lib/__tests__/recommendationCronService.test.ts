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

// ─── Mocks (MUST be before any imports — SWC hoists jest.mock) ─────────

jest.mock("@/lib/logger", () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { __esModule: true, default: mock, info: mock.info, warn: mock.warn, error: mock.error, debug: mock.debug };
});

jest.mock("@/lib/prisma", () => {
  const mock = {
    cronJob: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  return { __esModule: true, default: mock };
});

// ─── Imports ──────────────────────────────────────────────────────────────

import { recordCronRun, RECOMMENDATION_CRON_NAME } from "@/lib/services/recommendationCronService";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const prisma = require("@/lib/prisma").default as {
  cronJob: {
    findFirst: jest.Mock;
    update: jest.Mock;
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

  it("is a safe no-op when the job does not exist", async () => {
    prisma.cronJob.findFirst.mockResolvedValue(null);

    const result = await recordCronRun("Nonexistent Job", true);

    expect(prisma.cronJob.update).not.toHaveBeenCalled();
    expect(result).toEqual({ found: false });
  });

  it("never throws when prisma fails — returns found:false", async () => {
    prisma.cronJob.findFirst.mockRejectedValue(new Error("db down"));

    const result = await recordCronRun(RECOMMENDATION_CRON_NAME, true);

    expect(result).toEqual({ found: false });
  });

  it("never throws when update fails — returns found:false", async () => {
    prisma.cronJob.findFirst.mockResolvedValue(JOB);
    prisma.cronJob.update.mockRejectedValue(new Error("update failed"));

    const result = await recordCronRun(RECOMMENDATION_CRON_NAME, true);

    expect(result).toEqual({ found: false });
  });
});
