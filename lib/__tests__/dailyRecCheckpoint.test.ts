/**
 * Tests for Daily Recommendations checkpoint phases (Spec 42 §5.5).
 *
 * Covers:
 *   - Phase dispatch in runDailyRecommendations (coordinator/batch/finalizer)
 *   - Coordinator phase idempotency (completed run skipped)
 *   - Coordinator phase creates run + persists screeners
 *
 * IMPORTANT: Do NOT use `import { jest } from "@jest/globals"`.
 */

// ─── Mocks (MUST be before any imports) ──────────────────────────────────

jest.mock("@/lib/logger", () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { __esModule: true, default: mock, info: mock.info, warn: mock.warn, error: mock.error, debug: mock.debug };
});

jest.mock("@/lib/prisma", () => {
  const mock = {
    dailyRecommendationRun: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    recommendationTracker: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    workerTask: {
      create: jest.fn().mockResolvedValue({ id: "task-1" }),
    },
  };
  return { __esModule: true, default: mock };
});

const sqliteFallback = {
  upsertDailyRecommendationRun: jest.fn(),
  upsertRecommendationTracker: jest.fn(),
  upsertDailyRecommendationStock: jest.fn(),
  getRecommendationTrackers: jest.fn(() => []),
  getRecommendationStocks: jest.fn(() => []),
};
jest.mock("@/lib/sqlite", () => ({
  __esModule: true,
  getSqliteFallback: jest.fn(() => sqliteFallback),
  default: { getSqliteFallback: jest.fn(() => sqliteFallback) },
}));

jest.mock("@/lib/cache", () => ({
  __esModule: true,
  recommendationsCache: { del: jest.fn(), flushAll: jest.fn() },
  invalidateRecommendationsCache: jest.fn(),
}));

jest.mock("@/lib/audit", () => ({
  __esModule: true,
  createAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../services/chartinkUnifiedScreenerService", () => ({
  __esModule: true,
  runChartinkUnifiedScreeners: jest.fn().mockResolvedValue([
    {
      symbol: "RELIANCE",
      screenerNames: ["tv_1"],
      screenerCount: 50,
      price: 2500,
      marketCap: 100000,
    },
    {
      symbol: "TCS",
      screenerNames: ["chartink_1"],
      screenerCount: 30,
      price: 3500,
      marketCap: 120000,
    },
  ]),
}));

// ─── Imports ─────────────────────────────────────────────────────────────

import { runDailyRecommendations } from "@/lib/services/dailyRecommendationService";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const prisma = require("@/lib/prisma").default as Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getSqliteFallback } = require("@/lib/sqlite") as Record<string, any>;

describe("runDailyRecommendations phase dispatch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.dailyRecommendationRun.findUnique.mockResolvedValue(null);
  });

  it("coordinator phase: creates run and returns run structure", async () => {
    const sqlite = getSqliteFallback();
    sqlite.upsertDailyRecommendationRun.mockResolvedValue(undefined);

    const result = await runDailyRecommendations({
      triggeredBy: "system",
      phase: "coordinator",
    });

    expect(result.runId).toBeDefined();
    expect(typeof result.runId).toBe("string");
    expect(result.totalScreeners).toBeGreaterThan(0);
    expect(result.uniqueStocks).toBeGreaterThan(0);
    expect(prisma.dailyRecommendationRun.findUnique).toHaveBeenCalledWith({
      where: { id: result.runId },
      select: { id: true, status: true, uniqueStocks: true, completedAt: true },
    });
    expect(sqlite.upsertDailyRecommendationRun).toHaveBeenCalled();
  });

  it("coordinator phase: idempotent — skips when run already completed", async () => {
    prisma.dailyRecommendationRun.findUnique.mockResolvedValue({
      id: "existing-run",
      status: "completed",
      uniqueStocks: 42,
      completedAt: new Date(),
    });

    const result = await runDailyRecommendations({
      triggeredBy: "system",
      phase: "coordinator",
      runId: "existing-run",
    });

    expect(result.uniqueStocks).toBe(42);
    expect(result.aiProcessed).toBe(0);
    expect(result.stocks).toEqual([]);
    // Should NOT create a new run or persist anything
    expect(getSqliteFallback().upsertDailyRecommendationRun).not.toHaveBeenCalled();
  });

  it("coordinator phase: idempotent — skips when run exists with same runId", async () => {
    prisma.dailyRecommendationRun.findUnique.mockResolvedValue({
      id: "same-run-id",
      status: "completed",
      uniqueStocks: 10,
      completedAt: new Date(),
    });

    const result = await runDailyRecommendations({
      triggeredBy: "system",
      phase: "coordinator",
      runId: "same-run-id",
    });

    expect(result.uniqueStocks).toBe(10);
  });

  it("batch phase: requires runId", async () => {
    await expect(
      runDailyRecommendations({ phase: "batch" } as any),
    ).rejects.toThrow("Batch phase requires runId");
  });

  it("finalizer phase: requires runId", async () => {
    await expect(
      runDailyRecommendations({ phase: "finalizer" } as any),
    ).rejects.toThrow("Finalizer phase requires runId");
  });

  it("finalizer phase: idempotent — skips when run already completed", async () => {
    prisma.dailyRecommendationRun.findUnique.mockResolvedValue({
      id: "completed-run",
      status: "completed",
      uniqueStocks: 25,
    });

    const result = await runDailyRecommendations({
      triggeredBy: "system",
      phase: "finalizer",
      runId: "completed-run",
      taskId: "task-123",
    });

    expect(result.uniqueStocks).toBe(25);
    expect(result.aiProcessed).toBe(0);
  });

  it("no phase: runs monolithic path (backward compatible)", async () => {
    prisma.dailyRecommendationRun.findUnique.mockResolvedValue(null);
    const sqlite = getSqliteFallback();
    sqlite.upsertDailyRecommendationRun.mockResolvedValue(undefined);

    const result = await runDailyRecommendations({
      triggeredBy: "system",
    });

    expect(result.runId).toBeDefined();
    expect(result.totalScreeners).toBeGreaterThan(0);
  });
});
