/**
 * Tests for dailyRecommendationService — Orchestration of screeners → AI → DB.
 *
 * All external dependencies (Prisma, screeners, AI, events, audit) are mocked.
 *
 * IMPORTANT: Do NOT use `import { jest } from "@jest/globals"`.
 * SWC (used by next/jest) requires `jest` to be the global variable
 * for `jest.mock()` hoisting to work correctly.
 *
 * CRITICAL: Jest.mock() factories are hoisted BEFORE variable declarations.
 * Complex mocks must be defined INSIDE the factory and accessed via require().
 */

// ─── Mock Variables (must be declared before jest.mock for SWC hoisting) ──

/* eslint-disable @typescript-eslint/no-explicit-any */

// Mock @openrouter/agent to prevent ESM import issues
jest.mock("@openrouter/agent", () => ({
  __esModule: true,
  OpenRouter: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: jest.fn() } },
  })),
  SDKHooks: {},
}));

// Prisma mock — defined inside factory to avoid TDZ issues with SWC hoisting
jest.mock("@/lib/prisma", () => {
  const mock = {
    dailyRecommendationRun: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    dailyRecommendationStock: {
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    recommendationTracker: {
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    recommendationStatusHistory: {
      create: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
  };
  return { __esModule: true, default: mock };
});

jest.mock("@/lib/logger", () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { __esModule: true, default: mock, info: mock.info, warn: mock.warn, error: mock.error, debug: mock.debug };
});

jest.mock("@/lib/cache", () => ({
  __esModule: true,
  recommendationsCache: {
    get: jest.fn(() => null),
    set: jest.fn(),
    del: jest.fn(),
    flushAll: jest.fn(),
  },
}));

const mockRunDailyScreeners = jest.fn() as any;
jest.mock("@/lib/services/chartinkService", () => ({
  __esModule: true,
  runDailyScreeners: (...args: any[]) => mockRunDailyScreeners(args[0]),
}));

const mockAnalyzeStocks = jest.fn() as any;
jest.mock("@/lib/services/ai/recommendation-agent", () => ({
  __esModule: true,
  analyzeStocks: (...args: any[]) => mockAnalyzeStocks(args[0], args[1]),
}));

jest.mock("@/lib/services/ai/circuit-breaker", () => ({
  __esModule: true,
  getAICircuitBreaker: () => ({
    call: (fn: () => Promise<any>) => fn(),
  }),
  CircuitBreakerError: class CircuitBreakerError extends Error {
    stats: any;
    constructor(msg: string, stats: any) {
      super(msg);
      this.stats = stats;
    }
  },
}));

const mockGetRecommendationMetrics = jest.fn(() => ({
  record: jest.fn(),
})) as any;
jest.mock("@/lib/services/ai/performance-monitor", () => ({
  __esModule: true,
  getRecommendationMetrics: (...args: any[]) => mockGetRecommendationMetrics(args[0]),
}));

const mockRecordPrediction = jest.fn() as any;
jest.mock("@/lib/services/ai/prediction-tracker", () => ({
  __esModule: true,
  recordPrediction: (...args: any[]) => mockRecordPrediction(args[0]),
}));

const mockRecordScreenerEvent = jest.fn() as any;
const mockRecordAIEvent = jest.fn() as any;
jest.mock("@/lib/services/unifiedEventService", () => ({
  __esModule: true,
  recordScreenerEvent: (...args: any[]) => mockRecordScreenerEvent(args[0], args[1], args[2]),
  recordAIEvent: (...args: any[]) => mockRecordAIEvent(args[0], args[1], args[2]),
}));

const mockRecordMetric = jest.fn() as any;
jest.mock("@/lib/services/systemHealthService", () => ({
  __esModule: true,
  recordMetric: (...args: any[]) => mockRecordMetric(args[0]),
}));

jest.mock("@/lib/audit", () => ({
  __esModule: true,
  createAuditLog: jest.fn(() => Promise.resolve()),
}));

// ─── Imports ──────────────────────────────────────────────────────────────

import {
  runDailyRecommendations,
  getLatestRecommendations,
  getRecommendationHistory,
  getStockRecommendationDetail,
} from "@/lib/services/dailyRecommendationService";

// Get mock references via require (mocks already applied by SWC hoisting)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require("@/lib/prisma").default as Record<string, any>;

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeScreenerResult(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "RELIANCE",
    name: "Reliance Industries",
    price: 2500,
    change: 50,
    changePercent: 2.04,
    volume: 1000000,
    screenerNames: ["Short Term Breakouts", "Bullish Momentum"],
    screenerCount: 2,
    ...overrides,
  };
}

function makeAIResult(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "RELIANCE",
    price: 2500,
    change: 50,
    changePercent: 2.04,
    volume: 1000000,
    screenerNames: ["Short Term Breakouts", "Bullish Momentum"],
    aiRecommendation: {
      recommendation: "BUY",
      confidence: 75,
      targetPrice: 2750,
      stopLoss: 2375,
      timeHorizon: "medium",
      reasoning: "Strong momentum.",
      riskFactors: ["Market risk"],
    },
    tokensUsed: 500,
    executionMs: 2000,
    success: true,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("dailyRecommendationService", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default Prisma mocks
    mockPrisma.dailyRecommendationRun.create.mockResolvedValue({
      id: "run-123",
      status: "running",
      runDate: new Date(),
    });
    mockPrisma.dailyRecommendationRun.update.mockResolvedValue({});
    mockPrisma.recommendationTracker.create.mockResolvedValue({
      id: "tracker-1",
      symbol: "RELIANCE",
      entryPrice: 2500,
    });
    mockPrisma.recommendationTracker.createMany.mockResolvedValue({ count: 0 });
    mockPrisma.recommendationTracker.findFirst.mockResolvedValue(null);
    mockPrisma.recommendationTracker.findMany.mockResolvedValue([]);
    mockPrisma.recommendationTracker.update.mockResolvedValue({});
    mockPrisma.recommendationTracker.updateMany.mockResolvedValue({});
    mockPrisma.dailyRecommendationStock.findFirst.mockResolvedValue({
      id: "stock-1",
      symbol: "RELIANCE",
      runId: "run-123",
    });
    mockPrisma.dailyRecommendationStock.findMany.mockResolvedValue([
      { id: "stock-1", symbol: "RELIANCE", runId: "run-123" },
    ]);
    mockPrisma.dailyRecommendationStock.update.mockResolvedValue({});
    mockPrisma.dailyRecommendationStock.createMany.mockResolvedValue({ count: 0 });
    mockPrisma.recommendationStatusHistory.create.mockResolvedValue({});
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.$transaction.mockImplementation((ops: any[]) => Promise.all(ops));
  });

  // ── runDailyRecommendations ──────────────────────────────────────────

  describe("runDailyRecommendations", () => {
    test("creates a run record and marks completed on success", async () => {
      mockRunDailyScreeners.mockResolvedValue([makeScreenerResult()]);
      mockAnalyzeStocks.mockResolvedValue([makeAIResult()]);

      const result = await runDailyRecommendations();

      expect(result.runId).toBe("run-123");
      expect(result.uniqueStocks).toBe(1);
      expect(result.aiProcessed).toBe(1);

      // Run created with status "running"
      expect(mockPrisma.dailyRecommendationRun.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "running" }) }),
      );

      // Run updated to "completed"
      const updateCalls = mockPrisma.dailyRecommendationRun.update.mock.calls;
      const completeUpdate = updateCalls.find(
        (call: any) => call[0]?.data?.status === "completed",
      );
      expect(completeUpdate).toBeDefined();
    });

    test("marks run as failed when screeners throw", async () => {
      mockRunDailyScreeners.mockRejectedValue(new Error("Screener crash"));

      await expect(runDailyRecommendations()).rejects.toThrow("Screener crash");

      const updateCalls = mockPrisma.dailyRecommendationRun.update.mock.calls;
      const failedUpdate = updateCalls.find(
        (call: any) => call[0]?.data?.status === "failed",
      );
      expect(failedUpdate).toBeDefined();
      expect(failedUpdate![0].data.errorMessage).toContain("Screener crash");
    });

    test("creates stock entries for each screener result", async () => {
      const screenerResults = [
        makeScreenerResult({ symbol: "RELIANCE" }),
        makeScreenerResult({ symbol: "TCS", price: 3800 }),
      ];
      mockRunDailyScreeners.mockResolvedValue(screenerResults);
      mockAnalyzeStocks.mockResolvedValue([
        makeAIResult({ symbol: "RELIANCE" }),
        makeAIResult({ symbol: "TCS", price: 3800 }),
      ]);

      // First findMany (pre-fetch) returns empty, then createMany creates,
      // then second findMany (re-fetch) returns the new trackers
      mockPrisma.recommendationTracker.findMany
        .mockResolvedValueOnce([]) // pre-fetch: no existing trackers
        .mockResolvedValueOnce([ // re-fetch after createMany: return created trackers
          { id: "tracker-1", symbol: "RELIANCE", status: "active" },
          { id: "tracker-2", symbol: "TCS", status: "active" },
        ]);

      // Mock stock entries findMany for AI update step
      mockPrisma.dailyRecommendationStock.findMany.mockResolvedValue([
        { id: "stock-1", symbol: "RELIANCE", runId: "run-123" },
        { id: "stock-2", symbol: "TCS", runId: "run-123" },
      ]);

      await runDailyRecommendations();

      // Batched: createMany called instead of N individual creates
      expect(mockPrisma.dailyRecommendationStock.createMany).toHaveBeenCalled();
    });

    test("upserts recommendation tracker for each stock", async () => {
      mockRunDailyScreeners.mockResolvedValue([makeScreenerResult()]);
      mockAnalyzeStocks.mockResolvedValue([makeAIResult()]);

      await runDailyRecommendations();

      // Batched: findMany (check existing) → createMany (no existing)
      expect(mockPrisma.recommendationTracker.findMany).toHaveBeenCalled();
      expect(mockPrisma.recommendationTracker.createMany).toHaveBeenCalled();
    });

    test("updates stock entry with AI results", async () => {
      mockRunDailyScreeners.mockResolvedValue([makeScreenerResult()]);
      mockAnalyzeStocks.mockResolvedValue([makeAIResult()]);

      await runDailyRecommendations();

      expect(mockPrisma.dailyRecommendationStock.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            aiRecommendation: "BUY",
            confidence: 75,
            targetPrice: 2750,
          }),
        }),
      );
    });

    test("records prediction for each AI result", async () => {
      mockRunDailyScreeners.mockResolvedValue([makeScreenerResult()]);
      mockAnalyzeStocks.mockResolvedValue([makeAIResult()]);

      await runDailyRecommendations();

      expect(mockRecordPrediction).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: "RELIANCE",
          prediction: "BUY",
          confidence: 75,
          entryPrice: 2500,
        }),
      );
    });

    test("records screener events at start and completion", async () => {
      mockRunDailyScreeners.mockResolvedValue([makeScreenerResult()]);
      mockAnalyzeStocks.mockResolvedValue([makeAIResult()]);

      await runDailyRecommendations();

      expect(mockRecordScreenerEvent).toHaveBeenCalledWith(
        "run_start",
        expect.any(String),
        expect.any(Object),
      );
      expect(mockRecordScreenerEvent).toHaveBeenCalledWith(
        "run_complete",
        expect.any(String),
        expect.any(Object),
      );
    });

    test("records health metrics", async () => {
      mockRunDailyScreeners.mockResolvedValue([makeScreenerResult()]);
      mockAnalyzeStocks.mockResolvedValue([makeAIResult()]);

      await runDailyRecommendations();

      expect(mockRecordMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          metricType: "screener_duration",
          metricName: "daily_recommendation_run",
        }),
      );
    });

    test("handles empty screener results (0 stocks)", async () => {
      mockRunDailyScreeners.mockResolvedValue([]);
      mockAnalyzeStocks.mockResolvedValue([]);

      const result = await runDailyRecommendations();

      expect(result.uniqueStocks).toBe(0);
      expect(result.aiProcessed).toBe(0);
      expect(mockPrisma.dailyRecommendationStock.create).not.toHaveBeenCalled();
    });

    test("handles AI analysis failure gracefully with HOLD defaults", async () => {
      mockRunDailyScreeners.mockResolvedValue([makeScreenerResult()]);
      // AI returns failed results
      mockAnalyzeStocks.mockResolvedValue([
        makeAIResult({
          success: false,
          error: "AI timeout",
          aiRecommendation: {
            recommendation: "HOLD",
            confidence: 50,
            targetPrice: 2500,
            stopLoss: 2375,
            timeHorizon: "medium",
            reasoning: "AI analysis unavailable — defaulting to HOLD",
            riskFactors: ["AI analysis unavailable"],
          },
          tokensUsed: 0,
          executionMs: 0,
        }),
      ]);

      const result = await runDailyRecommendations();
      expect(result.aiFailed).toBe(1);
      expect(result.aiProcessed).toBe(0);
    });

    test("caps AI analysis at MAX_AI_STOCKS (100)", async () => {
      // Create 120 stocks
      const manyStocks = Array.from({ length: 120 }, (_, i) =>
        makeScreenerResult({ symbol: `STOCK${i + 1}`, price: 100 * (i + 1) }),
      );
      mockRunDailyScreeners.mockResolvedValue(manyStocks);
      // AI gets called with only 100
      const aiResults = Array.from({ length: 100 }, (_, i) =>
        makeAIResult({ symbol: `STOCK${i + 1}`, price: 100 * (i + 1) }),
      );
      mockAnalyzeStocks.mockResolvedValue(aiResults);

      // Mock findMany to return entries for all 120 stocks
      mockPrisma.dailyRecommendationStock.findMany.mockResolvedValue(
        Array.from({ length: 120 }, (_, i) => ({
          id: `stock-${i + 1}`,
          symbol: `STOCK${i + 1}`,
          runId: "run-123",
        })),
      );

      const result = await runDailyRecommendations();
      expect(result.uniqueStocks).toBe(120);
      expect(result.aiProcessed).toBe(100);
      // analyzeStocks called with array of length 100
      expect(mockAnalyzeStocks.mock.calls[0][0]).toHaveLength(100);
    });
  });

  // ── Query helpers ────────────────────────────────────────────────────

  describe("getLatestRecommendations", () => {
    test("returns the latest completed run with stocks", async () => {
      const mockRun = {
        id: "run-1",
        status: "completed",
        runDate: new Date(),
        stocks: [
          { symbol: "RELIANCE", screenerCount: 3, tracker: { id: "t1" } },
        ],
      };
      mockPrisma.dailyRecommendationRun.findFirst.mockResolvedValue(mockRun);

      const result = await getLatestRecommendations();
      expect(result.run).toEqual(mockRun);
      expect(result.stocks).toHaveLength(1);
    });

    test("returns empty when no runs exist", async () => {
      mockPrisma.dailyRecommendationRun.findFirst.mockResolvedValue(null);

      const result = await getLatestRecommendations();
      expect(result.run).toBeNull();
      expect(result.stocks).toEqual([]);
    });

    test("falls back to any run with stocks if no completed run", async () => {
      // First call (completed/failed) returns null
      mockPrisma.dailyRecommendationRun.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: "run-2",
          status: "running",
          stocks: [{ symbol: "TCS", screenerCount: 2, tracker: { id: "t2" } }],
        });

      const result = await getLatestRecommendations();
      expect(result.run).toBeDefined();
      expect(result.stocks).toHaveLength(1);
    });
  });

  describe("getRecommendationHistory", () => {
    test("returns paginated run history", async () => {
      mockPrisma.dailyRecommendationRun.findMany.mockResolvedValue([
        { id: "run-1", status: "completed", stocks: [{ symbol: "RELIANCE", screenerCount: 2, volume: 1000 }] },
        { id: "run-2", status: "completed", stocks: [{ symbol: "TCS", screenerCount: 1, volume: 500 }] },
      ]);

      const result = await getRecommendationHistory({ limit: 10, offset: 0 });
      expect(result).toHaveLength(2);
      expect(mockPrisma.dailyRecommendationRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 0 }),
      );
    });

    test("uses default pagination when not specified", async () => {
      mockPrisma.dailyRecommendationRun.findMany.mockResolvedValue([]);

      await getRecommendationHistory();
      expect(mockPrisma.dailyRecommendationRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 30, skip: 0 }),
      );
    });
  });

  describe("getStockRecommendationDetail", () => {
    test("returns tracker and history for a symbol", async () => {
      const mockTracker = {
        id: "tracker-1",
        symbol: "RELIANCE",
        dailyStocks: [{ symbol: "RELIANCE", runId: "run-1" }],
        statusHistory: [],
      };
      mockPrisma.recommendationTracker.findFirst.mockResolvedValue(mockTracker);

      const result = await getStockRecommendationDetail("RELIANCE");
      expect(result.tracker).toEqual(mockTracker);
      expect(result.history).toHaveLength(1);
    });

    test("normalizes symbol to uppercase", async () => {
      mockPrisma.recommendationTracker.findFirst.mockResolvedValue(null);

      await getStockRecommendationDetail("reliance");
      expect(mockPrisma.recommendationTracker.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ symbol: "RELIANCE" }),
        }),
      );
    });

    test("returns empty history when tracker not found", async () => {
      mockPrisma.recommendationTracker.findFirst.mockResolvedValue(null);

      const result = await getStockRecommendationDetail("UNKNOWN");
      expect(result.tracker).toBeNull();
      expect(result.history).toEqual([]);
    });
  });
});
