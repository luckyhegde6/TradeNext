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
    recommendationArchive: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
  };
  // Pure stub — injects cacheStrategy at the query boundary (mirrors the
  // recommendationPerformanceService.test.ts stub). Backward-compatible with
  // existing findFirst.mock.calls[0][0]?.where/select assertions (spread
  // preserves keys) and lets the v3.28.4 regression test assert cacheStrategy.
  return {
    __esModule: true,
    default: mock,
    withAccelerateCache: (strategy: any) => (args: any) => ({ ...(args as object), cacheStrategy: strategy }),
  };
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
    keys: jest.fn(() => []),
  },
}));

const mockRunDailyScreeners = jest.fn() as any;
jest.mock("@/lib/services/chartinkUnifiedScreenerService", () => ({
  __esModule: true,
  runChartinkUnifiedScreeners: (...args: any[]) => mockRunDailyScreeners(args[0]),
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
// Service calls .catch() on recordPrediction (fire-and-forget) — must resolve
mockRecordPrediction.mockResolvedValue(undefined);

const mockRecordScreenerEvent = jest.fn() as any;
const mockRecordAIEvent = jest.fn() as any;
const mockRecordSystemEvent = jest.fn() as any;
jest.mock("@/lib/services/unifiedEventService", () => ({
  __esModule: true,
  recordScreenerEvent: (...args: any[]) => mockRecordScreenerEvent(args[0], args[1], args[2]),
  recordAIEvent: (...args: any[]) => mockRecordAIEvent(args[0], args[1], args[2]),
  recordSystemEvent: (...args: any[]) => mockRecordSystemEvent(args[0], args[1], args[2]),
}));

const mockRecordMetric = jest.fn() as any;
jest.mock("@/lib/services/systemHealthService", () => ({
  __esModule: true,
  recordMetric: (...args: any[]) => mockRecordMetric(args[0]),
}));

// v3.8.0 pre-flight gate — MUST be mocked: the real module pulls in
// notificationService + ai-monitoring which touch unmocked prisma models.
const mockRunAiConnectionTest = jest.fn() as any;
jest.mock("@/lib/services/ai/connectionTestService", () => ({
  __esModule: true,
  runAiConnectionTest: (...args: any[]) => mockRunAiConnectionTest(args[0]),
}));

jest.mock("@/lib/audit", () => ({
  __esModule: true,
  createAuditLog: jest.fn(() => Promise.resolve()),
}));

// v3.12.0 perf-check live-price fallback — getStockQuote must be mocked so
// the fallback never touches the real NSE/DB in tests.
const mockGetStockQuote = jest.fn() as any;
jest.mock("@/lib/stock-service", () => ({
  __esModule: true,
  getStockQuote: (...args: any[]) => mockGetStockQuote(args[0], args[1]),
}));

// ─── Imports ──────────────────────────────────────────────────────────────

import {
  runDailyRecommendations,
  getLatestRecommendations,
  getRecommendationHistory,
  getStockRecommendationDetail,
  checkRecommendationPerformance,
} from "@/lib/services/dailyRecommendationService";

// Get mock references via require (mocks already applied by SWC hoisting)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require("@/lib/prisma").default as Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cache = require("@/lib/cache").recommendationsCache;

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

    // Cache mock default: always a miss (cold path) unless a test overrides.
    // clearAllMocks() does NOT reset implementations, so this must be set here
    // or a previous test's mockReturnValue leaks into later tests.
    cache.get.mockReturnValue(null);

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
    mockPrisma.recommendationArchive.findMany.mockResolvedValue([]);
    mockPrisma.recommendationArchive.createMany.mockResolvedValue({ count: 0 });
    mockPrisma.recommendationArchive.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.$queryRaw.mockResolvedValue([]);
    // Default live-quote fallback price (perf-check tests only).
    mockGetStockQuote.mockResolvedValue({ lastPrice: 500, closePrice: 500 });
    mockPrisma.$transaction.mockImplementation((ops: any[]) => Promise.all(ops));
    // Default pre-flight result: "ok" so the v3.8.0 gate behaves exactly like
    // the pre-gate flow for tests that don't exercise it. (next/jest loads
    // .env/.env.local, which sets OPENROUTERKEY on this machine, so
    // hasValidConfig() is true and the gate runs whenever aiInput is non-empty.)
    mockRunAiConnectionTest.mockResolvedValue({
      testedAt: new Date().toISOString(),
      status: "ok",
      configuredModel: "test-model",
      primary: { model: "test-model", ok: true, responseTimeMs: 1 },
      fallbacks: [],
    });
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

      // Run created with status "running" and default triggeredBy "system"
      expect(mockPrisma.dailyRecommendationRun.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "running", triggeredBy: "system" }) }),
      );

      // Run updated to "completed"
      const updateCalls = mockPrisma.dailyRecommendationRun.update.mock.calls;
      const completeUpdate = updateCalls.find(
        (call: any) => call[0]?.data?.status === "completed",
      );
      expect(completeUpdate).toBeDefined();
    });

    test("persists triggeredBy when options provided", async () => {
      mockRunDailyScreeners.mockResolvedValue([makeScreenerResult()]);
      mockAnalyzeStocks.mockResolvedValue([makeAIResult()]);

      await runDailyRecommendations({ triggeredBy: "admin" });

      expect(mockPrisma.dailyRecommendationRun.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ triggeredBy: "admin" }) }),
      );
    });

    // ── AI pre-flight gate (v3.8.0) ────────────────────────────────────
    // loadConfig() falls back to env (prisma mock has no `secret`), so
    // hasValidConfig() only returns true when OPENROUTERKEY is set.

    test("pre-flight OK → analyzes with the configured model", async () => {
      process.env.OPENROUTERKEY = "test-key";
      try {
        mockRunDailyScreeners.mockResolvedValue([makeScreenerResult()]);
        mockAnalyzeStocks.mockResolvedValue([makeAIResult()]);
        mockRunAiConnectionTest.mockResolvedValue({
          testedAt: new Date().toISOString(),
          status: "ok",
          configuredModel: "nvidia/nemotron-3-ultra-550b-a55b:free",
          primary: { model: "nvidia/nemotron-3-ultra-550b-a55b:free", ok: true, responseTimeMs: 120 },
          fallbacks: [],
        });

        const result = await runDailyRecommendations();

        // Gate probes with the longer pre-flight budget
        expect(mockRunAiConnectionTest).toHaveBeenCalledWith(120_000);
        expect(mockAnalyzeStocks).toHaveBeenCalledWith(
          expect.any(Array),
          expect.objectContaining({ model: "nvidia/nemotron-3-ultra-550b-a55b:free" }),
        );
        expect(result.aiProcessed).toBe(1);
      } finally {
        delete process.env.OPENROUTERKEY;
      }
    });

    test("pre-flight fallback → runs THIS run with the recommended model", async () => {
      process.env.OPENROUTERKEY = "test-key";
      try {
        mockRunDailyScreeners.mockResolvedValue([makeScreenerResult()]);
        mockAnalyzeStocks.mockResolvedValue([makeAIResult()]);
        mockRunAiConnectionTest.mockResolvedValue({
          testedAt: new Date().toISOString(),
          status: "fallback",
          configuredModel: "nvidia/nemotron-3-ultra-550b-a55b:free",
          primary: { model: "nvidia/nemotron-3-ultra-550b-a55b:free", ok: false, responseTimeMs: 120, error: "timeout" },
          fallbacks: [{ model: "openrouter/free", ok: true, responseTimeMs: 10 }],
          recommendedModel: "openrouter/free",
        });

        await runDailyRecommendations();

        expect(mockAnalyzeStocks).toHaveBeenCalledWith(
          expect.any(Array),
          expect.objectContaining({ model: "openrouter/free" }),
        );
      } finally {
        delete process.env.OPENROUTERKEY;
      }
    });

    test("pre-flight FAILED → run marked failed, no picks persisted (last good run kept)", async () => {
      process.env.OPENROUTERKEY = "test-key";
      try {
        mockRunDailyScreeners.mockResolvedValue([makeScreenerResult()]);
        mockAnalyzeStocks.mockResolvedValue([makeAIResult()]); // must NOT be reached
        mockRunAiConnectionTest.mockResolvedValue({
          testedAt: new Date().toISOString(),
          status: "failed",
          configuredModel: "nvidia/nemotron-3-ultra-550b-a55b:free",
          primary: { model: "nvidia/nemotron-3-ultra-550b-a55b:free", ok: false, responseTimeMs: 120, error: "timeout" },
          fallbacks: [],
        });

        const result = await runDailyRecommendations();

        expect(mockAnalyzeStocks).not.toHaveBeenCalled();
        expect(result.aiProcessed).toBe(0);
        expect(result.aiFailed).toBe(1);
        expect(result.uniqueStocks).toBe(0);
        expect(result.stocks).toEqual([]);
        // v3.11.1: NO synthetic HOLD rows — entries are DELETED, never updated
        expect(mockPrisma.dailyRecommendationStock.update).not.toHaveBeenCalled();
        expect(mockPrisma.dailyRecommendationStock.deleteMany).toHaveBeenCalledWith(
          { where: { runId: "run-123" } },
        );
        // Run marked failed with uniqueStocks 0 so getLatestRecommendations
        // (uniqueStocks > 0) falls back to the last good run
        const failedUpdate = mockPrisma.dailyRecommendationRun.update.mock.calls.find(
          (call: any) => call[0]?.data?.status === "failed",
        );
        expect(failedUpdate).toBeDefined();
        expect(failedUpdate![0].data.uniqueStocks).toBe(0);
        expect(failedUpdate![0].data.aiFailed).toBe(1);
      } finally {
        delete process.env.OPENROUTERKEY;
      }
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

    test("marks run failed without picks when ALL AI results fail", async () => {
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
      expect(result.uniqueStocks).toBe(0);
      // v3.11.1: no HOLD-default persistence — entries deleted instead
      expect(mockPrisma.dailyRecommendationStock.update).not.toHaveBeenCalled();
      expect(mockPrisma.dailyRecommendationStock.deleteMany).toHaveBeenCalledWith(
        { where: { runId: "run-123" } },
      );
    });

    test("partial AI failure — persists only successful verdicts, deletes failed entries", async () => {
      mockRunDailyScreeners.mockResolvedValue([
        makeScreenerResult({ symbol: "RELIANCE", price: 2500 }),
        makeScreenerResult({ symbol: "TCS", price: 3800 }),
      ]);
      mockAnalyzeStocks.mockResolvedValue([
        makeAIResult({ symbol: "RELIANCE", price: 2500 }), // success
        makeAIResult({
          symbol: "TCS",
          price: 3800,
          success: false,
          error: "AI timeout",
          aiRecommendation: {
            recommendation: "HOLD",
            confidence: 50,
            targetPrice: 4180,
            stopLoss: 3610,
            timeHorizon: "medium",
            reasoning: "AI analysis unavailable",
            riskFactors: ["AI analysis unavailable"],
          },
          tokensUsed: 0,
          executionMs: 0,
        }),
      ]);
      // Two entries pre-fetched for the AI-update step
      mockPrisma.dailyRecommendationStock.findMany.mockResolvedValue([
        { id: "stock-1", symbol: "RELIANCE", runId: "run-123" },
        { id: "stock-2", symbol: "TCS", runId: "run-123" },
      ]);

      const result = await runDailyRecommendations();

      expect(result.aiProcessed).toBe(1);
      expect(result.aiFailed).toBe(1);
      expect(result.uniqueStocks).toBe(1);
      // TCS (failed) entry deleted — RELIANCE (success) entry updated
      expect(mockPrisma.dailyRecommendationStock.deleteMany).toHaveBeenCalledWith({
        where: { runId: "run-123", symbol: { notIn: ["RELIANCE"] } },
      });
      const tcsUpdate = mockPrisma.dailyRecommendationStock.update.mock.calls.find(
        (call: any) => call[0]?.where?.id === "stock-2",
      );
      expect(tcsUpdate).toBeUndefined();
    });

    test("caps AI analysis at MAX_AI_STOCKS (100) by market cap", async () => {
      // Create 200 stocks — the new pipeline selects top 100 by market cap
      const manyStocks = Array.from({ length: 200 }, (_, i) =>
        makeScreenerResult({
          symbol: `STOCK${i + 1}`,
          price: 100 * (i + 1),
          marketCap: (200 - i) * 1_000_000_000, // Descending market cap
        }),
      );
      mockRunDailyScreeners.mockResolvedValue(manyStocks);
      // AI gets called with only 100 (selectTopByMarketCap top-100 by market cap)
      const aiResults = Array.from({ length: 100 }, (_, i) =>
        makeAIResult({ symbol: `STOCK${i + 1}`, price: 100 * (i + 1) }),
      );
      mockAnalyzeStocks.mockResolvedValue(aiResults);

      // Mock findMany to return entries for all 100 capped stocks
      mockPrisma.dailyRecommendationStock.findMany.mockResolvedValue(
        Array.from({ length: 100 }, (_, i) => ({
          id: `stock-${i + 1}`,
          symbol: `STOCK${i + 1}`,
          runId: "run-123",
        })),
      );

      const result = await runDailyRecommendations();
      expect(result.uniqueStocks).toBe(100);
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
          { symbol: "RELIANCE", screenerCount: 3, aiRecommendation: "BUY", tracker: { id: "t1" } },
          { symbol: "TCS", screenerCount: 2, aiRecommendation: "SELL", tracker: { id: "t2" } },
        ],
      };
      mockPrisma.dailyRecommendationRun.findFirst.mockResolvedValue(mockRun);

      const result = await getLatestRecommendations();
      expect(result.run).toEqual(mockRun);
      expect(result.stocks).toHaveLength(2);
    });

    test("returns the latest run even when all stocks are HOLD (honest latest date)", async () => {
      const mockRun = {
        id: "run-hold",
        status: "completed",
        runDate: new Date(),
        stocks: [
          { symbol: "RELIANCE", screenerCount: 3, aiRecommendation: "HOLD", tracker: { id: "t1" } },
          { symbol: "TCS", screenerCount: 2, aiRecommendation: "HOLD", tracker: { id: "t2" } },
        ],
      };
      mockPrisma.dailyRecommendationRun.findFirst.mockResolvedValue(mockRun);

      const result = await getLatestRecommendations();
      expect(result.run).toEqual(mockRun);
      expect(result.stocks).toHaveLength(2);

      // v3.10.1 honest latest-run: NO BUY/SELL verdict filter — an all-HOLD
      // run must surface today's date instead of a stale actionable run.
      const where = mockPrisma.dailyRecommendationRun.findFirst.mock.calls[0][0]?.where;
      expect(where.status).toEqual({ in: ["completed", "failed"] });
      expect(where.uniqueStocks).toEqual({ gt: 0 });
      expect(where.stocks).toBeUndefined();
    });

    test("surfaces the newest zero-pick failed run while keeping the last good run", async () => {
      const goodRun = {
        id: "run-good",
        status: "completed",
        runDate: new Date("2026-08-13T00:00:00Z"),
        stocks: [
          { symbol: "RELIANCE", screenerCount: 3, aiRecommendation: "BUY", tracker: { id: "t1" } },
        ],
      };
      const failedRun = {
        id: "run-failed",
        status: "failed",
        runDate: new Date("2026-08-14T00:00:00Z"),
      };
      // v3.11.1: second query = newest run row (even with zero picks), so the
      // client can show "AI unavailable on <date> — showing picks from <date>".
      mockPrisma.dailyRecommendationRun.findFirst
        .mockResolvedValueOnce(goodRun)
        .mockResolvedValueOnce(failedRun);

      const result = await getLatestRecommendations();
      expect(result.run?.id).toBe("run-good");
      expect(result.stocks).toHaveLength(1);
      expect(result.latestRun?.id).toBe("run-failed");
      expect(result.latestRun?.status).toBe("failed");
    });

    test("returns empty when no runs exist", async () => {
      mockPrisma.dailyRecommendationRun.findFirst.mockResolvedValue(null);

      const result = await getLatestRecommendations();
      expect(result.run).toBeNull();
      expect(result.stocks).toEqual([]);
    });

    test("latest selection: one stocks query + one lightweight newest-run row", async () => {
      mockPrisma.dailyRecommendationRun.findFirst.mockResolvedValue(null);

      await getLatestRecommendations();
      // v3.10.1: no BUY/SELL verdict-filter fallback round-trip. v3.11.1 adds
      // ONE lightweight newest-run row (id/runDate/status only) for the
      // AI-unavailable notice — the old two-query (actionable → fallback)
      // design is gone.
      expect(mockPrisma.dailyRecommendationRun.findFirst).toHaveBeenCalledTimes(2);
      const newestCall = mockPrisma.dailyRecommendationRun.findFirst.mock.calls[1][0];
      expect(newestCall?.select).toEqual({ id: true, runDate: true, status: true });
    });

    // v3.12.0 — cross-instance stale-cache guard: the in-memory cache is
    // PER-INSTANCE, so invalidateRecommendationsCache() on one Netlify instance
    // never reaches the others. Every cached read re-probes the DB for the
    // run-id fingerprint and serves the cache only when it matches.
    describe("validated cache (cross-instance staleness guard)", () => {
      test("serves the cached payload when the DB run-id fingerprint matches", async () => {
        const cachedData = {
          run: { id: "run-1", status: "completed", runDate: new Date(), stocks: [] },
          stocks: [{ symbol: "RELIANCE", screenerCount: 3, tracker: { id: "t1" } }],
          latestRun: { id: "run-1", status: "completed" },
        };
        cache.get.mockReturnValue({ runId: "run-1", newestRunId: "run-1", data: cachedData });
        // Fingerprint probes (2) return the SAME ids → cache is fresh.
        mockPrisma.dailyRecommendationRun.findFirst
          .mockResolvedValueOnce({ id: "run-1" }) // fingerprint: qualifying run
          .mockResolvedValueOnce({ id: "run-1" }); // fingerprint: newest run

        const result = await getLatestRecommendations();

        expect(result).toBe(cachedData);
        // Only the 2 fingerprint probes ran — the heavy stocks-include query did NOT.
        expect(mockPrisma.dailyRecommendationRun.findFirst).toHaveBeenCalledTimes(2);
        expect(cache.set).not.toHaveBeenCalled();
      });

      test("refetches when a NEW qualifying run exists on another instance", async () => {
        cache.get.mockReturnValue({
          runId: "run-old",
          newestRunId: "run-old",
          data: { run: { id: "run-old" }, stocks: [], latestRun: { id: "run-old" } },
        });
        mockPrisma.dailyRecommendationRun.findFirst
          .mockResolvedValueOnce({ id: "run-new" }) // fingerprint sees new run
          .mockResolvedValueOnce({ id: "run-new" }) // fingerprint newest
          .mockResolvedValueOnce({
            // latestRun (heavy include query)
            id: "run-new",
            status: "completed",
            runDate: new Date(),
            stocks: [{ symbol: "RELIANCE", screenerCount: 2, tracker: { id: "t1" } }],
          })
          .mockResolvedValueOnce({ id: "run-new", runDate: new Date(), status: "completed" });

        const result = await getLatestRecommendations();

        expect(result.run?.id).toBe("run-new");
        expect(mockPrisma.dailyRecommendationRun.findFirst).toHaveBeenCalledTimes(4);
        // Cache re-stamped with the fresh fingerprint + 15-min TTL
        const [key, entry, ttl] = cache.set.mock.calls[0];
        expect(key).toBe("recommendations:latest");
        expect(entry).toMatchObject({ runId: "run-new", newestRunId: "run-new" });
        expect(ttl).toBe(15 * 60);
      });

      test("v3.28.4: heavy latestRun/newestRun reads carry Accelerate cacheStrategy; fingerprint probes stay uncached", async () => {
        cache.get.mockReturnValue({
          runId: "run-old",
          newestRunId: "run-old",
          data: { run: { id: "run-old" }, stocks: [], latestRun: { id: "run-old" } },
        });
        mockPrisma.dailyRecommendationRun.findFirst
          .mockResolvedValueOnce({ id: "run-new" }) // fingerprint: qualifying run
          .mockResolvedValueOnce({ id: "run-new" }) // fingerprint: newest run
          .mockResolvedValueOnce({
            // latestRun (heavy include query — edge-cacheable)
            id: "run-new",
            status: "completed",
            runDate: new Date(),
            stocks: [{ symbol: "RELIANCE", screenerCount: 2, tracker: { id: "t1" } }],
          })
          .mockResolvedValueOnce({ id: "run-new", runDate: new Date(), status: "completed" });

        await getLatestRecommendations();

        const calls = mockPrisma.dailyRecommendationRun.findFirst.mock.calls;
        expect(calls).toHaveLength(4);
        // Fingerprint probes stay uncached — they are the cross-instance
        // staleness guard and must always hit Prisma.
        expect(calls[0][0]).not.toHaveProperty("cacheStrategy");
        expect(calls[1][0]).not.toHaveProperty("cacheStrategy");
        // Heavy stocks-include query + lightweight newest-run row are the two
        // edge-cached reads (v3.28.4).
        expect(calls[2][0]).toHaveProperty("cacheStrategy", { ttl: 60, swr: 30 });
        expect(calls[3][0]).toHaveProperty("cacheStrategy", { ttl: 60, swr: 30 });
      });

      test("refetches when only the newest run changed (AI-unavailable failure on another instance)", async () => {
        cache.get.mockReturnValue({
          runId: "run-good",
          newestRunId: "newest-old",
          data: { run: { id: "run-good" }, stocks: [], latestRun: { id: "newest-old" } },
        });
        mockPrisma.dailyRecommendationRun.findFirst
          .mockResolvedValueOnce({ id: "run-good" }) // qualifying unchanged
          .mockResolvedValueOnce({ id: "newest-new" }) // newest CHANGED → stale
          .mockResolvedValueOnce({
            id: "run-good",
            status: "completed",
            runDate: new Date(),
            stocks: [],
          })
          .mockResolvedValueOnce({ id: "newest-new", runDate: new Date(), status: "failed" });

        const result = await getLatestRecommendations();

        expect(result.latestRun?.id).toBe("newest-new");
        const entry = cache.set.mock.calls[0][1];
        expect(entry).toMatchObject({ runId: "run-good", newestRunId: "newest-new" });
      });
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

  // ── checkRecommendationPerformance (v3.12.0 live-price fallback) ────────

  describe("checkRecommendationPerformance", () => {
    const makePerfTracker = (overrides: Record<string, unknown> = {}) => ({
      id: "t1",
      symbol: "RELIANCE",
      status: "tracking",
      aiRecommendation: "BUY",
      entryPrice: 2400,
      currentPrice: 2400,
      targetPrice: 2750,
      stopLoss: 2280,
      createdAt: new Date(),
      ...overrides,
    });

    beforeEach(() => {
      // Status-change path fires recordAIEvent(...).catch(...) — must resolve.
      mockRecordAIEvent.mockResolvedValue(undefined);
      // Perf completion fires recordSystemEvent(...).catch(...) — must resolve.
      mockRecordSystemEvent.mockResolvedValue(undefined);
      mockGetStockQuote.mockResolvedValue({ lastPrice: 500, closePrice: 500 });
    });

    test("uses DB prices when available — no live fallback", async () => {
      mockPrisma.recommendationTracker.findMany.mockResolvedValue([
        makePerfTracker({ id: "t1", symbol: "RELIANCE" }),
        makePerfTracker({ id: "t2", symbol: "TCS" }),
      ]);
      mockPrisma.$queryRaw.mockResolvedValue([
        { ticker: "RELIANCE", close: 2500 },
        { ticker: "TCS", close: 3400 },
      ]);

      const result = await checkRecommendationPerformance();

      expect(result.checked).toBe(2);
      expect(mockGetStockQuote).not.toHaveBeenCalled();
      expect(mockPrisma.recommendationTracker.update).toHaveBeenCalledTimes(2);
    });

    test("bridges trackers missing daily_prices rows with a live quote", async () => {
      mockPrisma.recommendationTracker.findMany.mockResolvedValue([
        makePerfTracker({ id: "t1", symbol: "RELIANCE" }),
        makePerfTracker({ id: "t2", symbol: "FRESH" }),
      ]);
      mockPrisma.$queryRaw.mockResolvedValue([{ ticker: "RELIANCE", close: 2500 }]);
      mockGetStockQuote.mockResolvedValue({ lastPrice: 555, closePrice: 555 });

      const result = await checkRecommendationPerformance();

      expect(mockGetStockQuote).toHaveBeenCalledWith("FRESH", false);
      expect(result.checked).toBe(2);
      // FRESH updated with the bridged price, RELIANCE with its DB close.
      const updateCalls = mockPrisma.recommendationTracker.update.mock.calls as any[];
      expect(updateCalls.some((c) => c[0]?.where?.id === "t2" && c[0]?.data?.currentPrice === 555)).toBe(true);
      expect(updateCalls.some((c) => c[0]?.where?.id === "t1" && c[0]?.data?.currentPrice === 2500)).toBe(true);
    });

    test("survives live-quote failures — symbol skipped, no throw", async () => {
      mockPrisma.recommendationTracker.findMany.mockResolvedValue([
        makePerfTracker({ id: "t1", symbol: "GONE" }),
      ]);
      mockPrisma.$queryRaw.mockResolvedValue([]);
      mockGetStockQuote.mockRejectedValue(new Error("NSE 403"));

      const result = await checkRecommendationPerformance();

      expect(result.checked).toBe(1);
      expect(mockPrisma.recommendationTracker.update).not.toHaveBeenCalled();
    });

    test("caps live fallback to 50 symbols", async () => {
      const trackers = Array.from({ length: 60 }, (_, i) =>
        makePerfTracker({ id: `t${i}`, symbol: `S${i}` }),
      );
      mockPrisma.recommendationTracker.findMany.mockResolvedValue(trackers);
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await checkRecommendationPerformance();

      expect(mockGetStockQuote).toHaveBeenCalledTimes(50);
    });
  });
});
