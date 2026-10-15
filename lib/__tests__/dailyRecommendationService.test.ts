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
      updateMany: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    // v3.49.0 (Spec 30): getNextRunAt prefers the system cron row's nextRun.
    cronJob: {
      findFirst: jest.fn(),
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

// SQLite mirror mock — in-memory store with upsert semantics (Plan 09 Phase 6).
// The rewritten service writes EVERY job row to the mirror first (Prisma writes
// are 6h-push-only); assertions below target these mirror helpers instead of
// prisma dailyRecommendationRun/Stock/Tracker create/update/deleteMany calls.
jest.mock("@/lib/sqlite", () => {
  const runs: Array<Record<string, any>> = [];
  const trackers: Array<Record<string, any>> = [];
  const stocks: Array<Record<string, any>> = [];
  const statusHistory: Array<Record<string, any>> = [];

  const upsertBy = (
    arr: Array<Record<string, any>>,
    row: Record<string, any>,
    match: (r: Record<string, any>) => boolean,
  ) => {
    const idx = arr.findIndex(match);
    if (idx >= 0) {
      Object.assign(arr[idx], row);
      return arr[idx];
    }
    arr.push(row);
    return row;
  };

  const fallback = {
    upsertDailyRecommendationRun: jest.fn((row: Record<string, any>) =>
      upsertBy(runs, row, (r) => r.id === row.id),
    ),
    getRecommendationTrackers: jest.fn(
      ({ symbolIn }: { symbolIn?: string[] } = {}) =>
        trackers.filter(
          (t) =>
            symbolIn === undefined ||
            symbolIn.some(
              (s) => String(s).toUpperCase() === String(t.symbol).toUpperCase(),
            ),
        ),
    ),
    upsertRecommendationTracker: jest.fn((row: Record<string, any>) =>
      upsertBy(trackers, row, (t) => t.id === row.id),
    ),
    upsertDailyRecommendationStock: jest.fn((row: Record<string, any>) =>
      upsertBy(stocks, row, (s) => s.id === row.id),
    ),
    getRecommendationStocks: jest.fn((runId: string) =>
      stocks.filter((s) => s.runId === runId),
    ),
    deleteRecommendationStocksByRun: jest.fn(
      (runId: string, symbols?: string[]) => {
        for (let i = stocks.length - 1; i >= 0; i--) {
          const row = stocks[i];
          if (
            row.runId === runId &&
            (symbols === undefined ||
              !symbols.some(
                (sym) =>
                  String(sym).toUpperCase() === String(row.symbol).toUpperCase(),
              ))
          ) {
            stocks.splice(i, 1);
          }
        }
      },
    ),
    appendRecommendationStatusHistory: jest.fn((row: Record<string, any>) => {
      statusHistory.push(row);
      return row;
    }),
  };

  return {
    __esModule: true,
    getSqliteFallback: jest.fn(() => fallback),
    fallback,
    runs,
    trackers,
    stocks,
    statusHistory,
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
  repairFailedRunsWithPicks,
  getRecommendationHistory,
  getStockRecommendationDetail,
  checkRecommendationPerformance,
  // v3.49.0 (Spec 30) — freshness / next-run surfacing helpers
  getNextRunAt,
  computeFreshnessFields,
  computeIsStale,
  hasSuccessfulRunToday,
  RECOMMENDATION_CRON_DISPLAY,
} from "@/lib/services/dailyRecommendationService";

// Get mock references via require (mocks already applied by SWC hoisting)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require("@/lib/prisma").default as Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cache = require("@/lib/cache").recommendationsCache;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockSqlite = require("@/lib/sqlite").fallback as any;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sqliteStore = require("@/lib/sqlite") as Record<string, any[]>;

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

    // Reset the in-memory SQLite mirror store between tests (clearAllMocks only
    // clears jest.fn call data, not the arrays the mock's accessors read/write).
    for (const key of ["runs", "trackers", "stocks", "statusHistory"]) {
      sqliteStore[key].length = 0;
    }

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

      expect(result.runId).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.uniqueStocks).toBe(1);
      expect(result.aiProcessed).toBe(1);

      // Plan 09 Phase 6: the run row is written SQLite-first via the mirror's
      // upsert helper — the SAME object is mutated in place on each service
      // update (running → stats → final), so only never-mutated creation
      // fields (id, triggeredBy) are inspectable on the first call.
      const runUpserts = mockSqlite.upsertDailyRecommendationRun.mock.calls as any[][];
      expect(runUpserts.length).toBeGreaterThanOrEqual(2);
      expect(runUpserts[0][0].id).toBe(result.runId);
      expect(runUpserts[0][0].triggeredBy).toBe("system");

      // Final upsert marks the run completed with the computed stats
      const finalRun = runUpserts[runUpserts.length - 1][0];
      expect(finalRun.status).toBe("completed");
      expect(finalRun.uniqueStocks).toBe(1);
      expect(finalRun.aiProcessed).toBe(1);

      // No direct Prisma writes for the run row anymore
      expect(mockPrisma.dailyRecommendationRun.create).not.toHaveBeenCalled();
      expect(mockPrisma.dailyRecommendationRun.update).not.toHaveBeenCalled();
    });

    test("persists triggeredBy when options provided", async () => {
      mockRunDailyScreeners.mockResolvedValue([makeScreenerResult()]);
      mockAnalyzeStocks.mockResolvedValue([makeAIResult()]);

      await runDailyRecommendations({ triggeredBy: "admin" });

      // Mirror-first: the run row carries the provided triggeredBy on first upsert
      const runUpserts = mockSqlite.upsertDailyRecommendationRun.mock.calls as any[][];
      expect(runUpserts[0][0].triggeredBy).toBe("admin");
      expect(mockPrisma.dailyRecommendationRun.create).not.toHaveBeenCalled();
    });

    /**
     * v3.45.0 (spec 21) — TRANSITIVE Prisma acceptance decision.
     *
     * `degradedExecutor` never references prisma (structural test), but it calls
     * `runDailyRecommendations`, which reaches Prisma through two helpers. Both
     * are fault-tolerant BY DESIGN, and this is the test that says so out loud:
     * during a plan-limit hold the ONE thing that must not happen is the daily
     * run rejecting, because the queue would mark the task `failed` and today's
     * picks would be missing on exactly the instances that need them.
     *
     * The two transitive touchpoints and their guards:
     *   1. tracker backfill findMany → try/catch, warns, proceeds mirror-only
     *   2. recordPrediction (agentPerformanceLog.create) → per-call .catch()
     */
    test("completes the run when EVERY transitive Prisma call fails (plan-limit hold)", async () => {
      mockRunDailyScreeners.mockResolvedValue([makeScreenerResult()]);
      mockAnalyzeStocks.mockResolvedValue([makeAIResult()]);

      // Touchpoint 1 — the cold-mirror backfill read.
      mockPrisma.recommendationTracker.findMany.mockRejectedValue(
        new Error("P6003: plan limit reached"),
      );
      // Touchpoint 2 — prediction tracking.
      mockRecordPrediction.mockRejectedValue(new Error("P6003: plan limit reached"));

      // MUST resolve, not reject: this is the degraded-mode contract.
      const result = await runDailyRecommendations();

      expect(result.uniqueStocks).toBe(1);
      expect(result.aiProcessed).toBe(1);

      // The run row still reaches `completed` in the mirror — a failed Prisma
      // read must not degrade the run to a half-written state.
      const runUpserts = mockSqlite.upsertDailyRecommendationRun.mock.calls as any[][];
      expect(runUpserts[runUpserts.length - 1][0].status).toBe("completed");

      // Fresh trackers are still built from the run itself, so the symbols the
      // backfill could not warm are not silently dropped.
      const created = (mockSqlite.upsertRecommendationTracker.mock.calls as any[][]).find(
        (c) => c[0]?.symbol === "RELIANCE",
      );
      expect(created).toBeDefined();
      expect(created![0].entryPrice).toBe(2500);
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
        // v3.11.1: NO synthetic HOLD rows — mirror entries are DELETED (single
        // run-id arg = discard the whole run), never updated
        expect(mockPrisma.dailyRecommendationStock.update).not.toHaveBeenCalled();
        expect(mockSqlite.deleteRecommendationStocksByRun).toHaveBeenCalledTimes(1);
        expect(mockSqlite.deleteRecommendationStocksByRun.mock.calls[0][0]).toBe(result.runId);
        expect(mockSqlite.deleteRecommendationStocksByRun.mock.calls[0]).toHaveLength(1);
        // Run marked failed with uniqueStocks 0 so getLatestRecommendations
        // (uniqueStocks > 0) falls back to the last good run
        const runUpserts = mockSqlite.upsertDailyRecommendationRun.mock.calls as any[][];
        const failedRun = runUpserts[runUpserts.length - 1][0];
        expect(failedRun.status).toBe("failed");
        expect(failedRun.uniqueStocks).toBe(0);
        expect(failedRun.aiFailed).toBe(1);
        expect(mockPrisma.dailyRecommendationRun.update).not.toHaveBeenCalled();
      } finally {
        delete process.env.OPENROUTERKEY;
      }
    });

    // v3.50.0 (Spec 30 follow-up): a catch-up RETRY must not re-send the
    // "AI unavailable" Telegram heartbeat — one notice per day, not one per
    // 5-min resync (prod 2026-10-14/15: ~70 duplicate notices in a day).
    test("sends the AI-unavailable notice on the default (scheduled) run", async () => {
      process.env.OPENROUTERKEY = "test-key";
      try {
        mockRunDailyScreeners.mockResolvedValue([makeScreenerResult()]);
        mockRunAiConnectionTest.mockResolvedValue({
          testedAt: new Date().toISOString(),
          status: "failed",
          configuredModel: "nvidia/nemotron-3-ultra-550b-a55b:free",
          primary: { model: "nvidia/nemotron-3-ultra-550b-a55b:free", ok: false, responseTimeMs: 120, error: "timeout" },
          fallbacks: [],
        });

        await runDailyRecommendations();

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({ msg: "Telegram broadcast for AI unavailability notice" }),
        );
      } finally {
        delete process.env.OPENROUTERKEY;
      }
    });

    test("suppresses the AI-unavailable notice on a catch-up retry", async () => {
      process.env.OPENROUTERKEY = "test-key";
      try {
        mockRunDailyScreeners.mockResolvedValue([makeScreenerResult()]);
        mockRunAiConnectionTest.mockResolvedValue({
          testedAt: new Date().toISOString(),
          status: "failed",
          configuredModel: "nvidia/nemotron-3-ultra-550b-a55b:free",
          primary: { model: "nvidia/nemotron-3-ultra-550b-a55b:free", ok: false, responseTimeMs: 120, error: "timeout" },
          fallbacks: [],
        });

        const result = await runDailyRecommendations({
          triggeredBy: "system",
          notifyAiUnavailable: false,
        });

        expect(result.aiProcessed).toBe(0);
        expect(mockLogger.info).not.toHaveBeenCalledWith(
          expect.objectContaining({ msg: "Telegram broadcast for AI unavailability notice" }),
        );
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            msg: "AI-unavailable notice suppressed (retry run — already notified today)",
          }),
        );
      } finally {
        delete process.env.OPENROUTERKEY;
      }
    });

    test("marks run as failed when screeners throw", async () => {
      mockRunDailyScreeners.mockRejectedValue(new Error("Screener crash"));

      await expect(runDailyRecommendations()).rejects.toThrow("Screener crash");

      // Mirror-first: the catch path upserts the run row as failed (last call)
      const runUpserts = mockSqlite.upsertDailyRecommendationRun.mock.calls as any[][];
      const failedRun = runUpserts[runUpserts.length - 1][0];
      expect(failedRun.status).toBe("failed");
      expect(String(failedRun.errorMessage)).toContain("Screener crash");
      expect(mockPrisma.dailyRecommendationRun.update).not.toHaveBeenCalled();
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

      // Mirror-first: the missing-symbol backfill queries Prisma (cold mirror
      // → no existing trackers), then every stock entry + tracker is written
      // via the mirror upsert helpers.
      mockPrisma.recommendationTracker.findMany.mockResolvedValue([]);

      await runDailyRecommendations();

      // Mirror write-through: one full-row upsert per stock entry (client-side
      // ids, runId = the created run) — no Prisma createMany anymore.
      const stockUpserts = mockSqlite.upsertDailyRecommendationStock.mock.calls as any[][];
      expect(stockUpserts.length).toBeGreaterThanOrEqual(2);
      expect(stockUpserts[0][0].symbol).toBe("RELIANCE");
      expect(stockUpserts[1][0].symbol).toBe("TCS");
      expect(stockUpserts[0][0].runId).toBeDefined();
      expect(mockPrisma.dailyRecommendationStock.createMany).not.toHaveBeenCalled();
    });

    test("upserts recommendation tracker for each stock", async () => {
      mockRunDailyScreeners.mockResolvedValue([makeScreenerResult()]);
      mockAnalyzeStocks.mockResolvedValue([makeAIResult()]);

      await runDailyRecommendations();

      // Mirror-first: findMany backfills missing symbols from Prisma (cold
      // mirror → []) then every tracker is written via the mirror upsert —
      // the old createMany batch path no longer runs.
      expect(mockPrisma.recommendationTracker.findMany).toHaveBeenCalled();
      expect(mockSqlite.upsertRecommendationTracker).toHaveBeenCalled();
      const trackerUpserts = mockSqlite.upsertRecommendationTracker.mock.calls as any[][];
      const created = trackerUpserts.find((c) => c[0]?.symbol === "RELIANCE");
      expect(created).toBeDefined();
      expect(created![0].entryPrice).toBe(2500);
      expect(created![0].status).toBe("active");
      expect(mockPrisma.recommendationTracker.createMany).not.toHaveBeenCalled();
    });

    test("updates stock entry with AI results", async () => {
      mockRunDailyScreeners.mockResolvedValue([makeScreenerResult()]);
      mockAnalyzeStocks.mockResolvedValue([makeAIResult()]);

      await runDailyRecommendations();

      // Mirror write-through: the AI verdict lands on the stock row via a
      // full-row upsert (no Prisma update).
      const stockUpserts = mockSqlite.upsertDailyRecommendationStock.mock.calls as any[][];
      const aiUpdate = stockUpserts.find(
        (c) => c[0]?.symbol === "RELIANCE" && c[0]?.aiRecommendation === "BUY",
      );
      expect(aiUpdate).toBeDefined();
      expect(aiUpdate![0].confidence).toBe(75);
      expect(aiUpdate![0].targetPrice).toBe(2750);
      expect(mockPrisma.dailyRecommendationStock.update).not.toHaveBeenCalled();
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
      // v3.11.1: no HOLD-default persistence — mirror entries discarded via the
      // single-arg delete (whole run), never updated; run marked failed
      expect(mockPrisma.dailyRecommendationStock.update).not.toHaveBeenCalled();
      expect(mockSqlite.deleteRecommendationStocksByRun).toHaveBeenCalledTimes(1);
      expect(mockSqlite.deleteRecommendationStocksByRun.mock.calls[0][0]).toBe(result.runId);
      expect(mockSqlite.deleteRecommendationStocksByRun.mock.calls[0]).toHaveLength(1);
      const runUpserts = mockSqlite.upsertDailyRecommendationRun.mock.calls as any[][];
      const failedRun = runUpserts[runUpserts.length - 1][0];
      expect(failedRun.status).toBe("failed");
      expect(failedRun.uniqueStocks).toBe(0);
      expect(mockPrisma.dailyRecommendationRun.update).not.toHaveBeenCalled();
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
      const result = await runDailyRecommendations();

      expect(result.aiProcessed).toBe(1);
      expect(result.aiFailed).toBe(1);
      expect(result.uniqueStocks).toBe(1);
      // The mirror delete keeps ONLY the successful symbols for this run —
      // TCS (failed) entry is discarded, RELIANCE (success) kept + updated
      expect(mockSqlite.deleteRecommendationStocksByRun).toHaveBeenCalledTimes(1);
      const deleteCall = mockSqlite.deleteRecommendationStocksByRun.mock.calls[0];
      expect(deleteCall[0]).toBe(result.runId);
      expect(deleteCall[1]).toEqual(["RELIANCE"]);
      const stockUpserts = mockSqlite.upsertDailyRecommendationStock.mock.calls as any[][];
      const tcsAiUpdate = stockUpserts.find(
        (c) => c[0]?.symbol === "TCS" && c[0]?.aiRecommendation !== undefined,
      );
      expect(tcsAiUpdate).toBeUndefined();
      expect(mockPrisma.dailyRecommendationStock.deleteMany).not.toHaveBeenCalled();
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

      // Mock findMany removed — the mirror holds all stock entries, so the AI
      // verdicts are written straight back via upsert.
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
      // v3.49.0 (Spec 29): the legitimate previous predicate
      // `status IN (completed, failed)` is gone — a run qualifies ONLY when it
      // completed AND the AI layer produced verdicts (aiProcessed > 0). A
      // failed run with raw screener picks must NEVER shadow good runs
      // (prod 2026-10-11: 100 forced HOLD rows from run 347d6887…).
      const where = mockPrisma.dailyRecommendationRun.findFirst.mock.calls[0][0]?.where;
      expect(where.status).toEqual("completed");
      expect(where.uniqueStocks).toEqual({ gt: 0 });
      expect(where.aiProcessed).toEqual({ gt: 0 });
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

    // ── v3.49.0 (Spec 29) ─────────────────────────────────────────────
    test("a FAILED run with raw picks but zero AI verdicts is never the latest run (prod bug)", async () => {
      // prod 2026-10-11: run 347d6887-1139-4620-ab47-0940882b4109, runDate
      // 2026-09-04, status failed, uniqueStocks 100, aiProcessed 0. Under the
      // old predicate (`status IN (completed,failed) AND uniqueStocks > 0`)
      // it surfaced as "Today's" with 100 forced HOLD rows. The honest
      // predicate skips it for the payload and reports it only as latestRun.
      const goodRun = {
        id: "run-good",
        status: "completed",
        runDate: new Date("2026-09-02T00:00:00Z"),
        aiProcessed: 98,
        stocks: [
          { symbol: "RELIANCE", screenerCount: 3, aiRecommendation: "BUY", tracker: { id: "t1" } },
        ],
      };
      const failedPicksRun = {
        id: "run-failed-picks",
        status: "failed",
        runDate: new Date("2026-09-04T09:20:52Z"),
        uniqueStocks: 100,
        aiProcessed: 0,
      };
      mockPrisma.dailyRecommendationRun.findFirst
        .mockResolvedValueOnce(goodRun)
        .mockResolvedValueOnce(failedPicksRun);

      const result = await getLatestRecommendations();
      expect(result.run?.id).toBe("run-good");
      expect(result.run?.status).toBe("completed");
      expect(result.latestRun?.id).toBe("run-failed-picks");
      expect(result.latestRun?.status).toBe("failed");
    });

    test("cache fingerprint AND payload query use the SAME honest predicate (parity)", async () => {
      // The cache is validated by re-probing the SAME predicate — otherwise a
      // failed run could be cached under one predicate and served under the
      // other. Both finds must deep-equal LATEST_RUN_WHERE.
      cache.get.mockReturnValue({
        runId: "run-old",
        newestRunId: "run-old",
        data: { run: { id: "run-old" }, stocks: [], latestRun: { id: "run-old" } },
      });
      mockPrisma.dailyRecommendationRun.findFirst
        .mockResolvedValueOnce({ id: "run-new" }) // fingerprint: qualifying run
        .mockResolvedValueOnce({ id: "run-new" }) // fingerprint: newest run
        .mockResolvedValueOnce({
          id: "run-new",
          status: "completed",
          runDate: new Date(),
          stocks: [{ symbol: "RELIANCE", screenerCount: 2, tracker: { id: "t1" } }],
        })
        .mockResolvedValueOnce({ id: "run-new", runDate: new Date(), status: "completed" });

      await getLatestRecommendations();

      const calls = mockPrisma.dailyRecommendationRun.findFirst.mock.calls;
      const expectedWhere = { status: "completed", uniqueStocks: { gt: 0 }, aiProcessed: { gt: 0 } };
      // fingerprint qualifying-run probe (call 0) and heavy payload query (call 2)
      expect(calls[0][0]?.where).toEqual(expectedWhere);
      expect(calls[2][0]?.where).toEqual(expectedWhere);
      // newest-run probes stay predicate-free (they observe ANY run)
      expect(calls[1][0]?.where).toBeUndefined();
      expect(calls[3][0]?.where).toBeUndefined();
    });

    test("lastSuccessfulRunDate is the ISO date of the latest COMPLETED+AI run", async () => {
      const mockRun = {
        id: "run-1",
        status: "completed",
        runDate: new Date("2026-09-02T00:00:00Z"),
        stocks: [{ symbol: "RELIANCE", screenerCount: 3, aiRecommendation: "BUY", tracker: { id: "t1" } }],
      };
      mockPrisma.dailyRecommendationRun.findFirst.mockResolvedValue(mockRun);

      const result = await getLatestRecommendations();
      expect(result.lastSuccessfulRunDate).toBe("2026-09-02T00:00:00.000Z");
    });

    test("lastSuccessfulRunDate is null when no successful run exists", async () => {
      mockPrisma.dailyRecommendationRun.findFirst.mockResolvedValue(null);

      const result = await getLatestRecommendations();
      expect(result.lastSuccessfulRunDate).toBeNull();
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

  // ── v3.49.0 (Spec 29) ─────────────────────────────────────────────
  describe("repairFailedRunsWithPicks", () => {
    test("zeroes the pick pivot on legacy failed/ai-zero runs and invalidates the cache", async () => {
      mockPrisma.dailyRecommendationRun.updateMany.mockResolvedValue({ count: 2 });

      const result = await repairFailedRunsWithPicks();

      expect(mockPrisma.dailyRecommendationRun.updateMany).toHaveBeenCalledWith({
        where: { status: "failed", aiProcessed: 0, uniqueStocks: { gt: 0 } },
        data: { uniqueStocks: 0 },
      });
      expect(result.repaired).toBe(2);
      // cache invalidation (recommendationsCache.flushAll) fires on repair
      expect(cache.flushAll).toHaveBeenCalled();
    });

    test("does NOT touch completed or partial-AI failed runs", async () => {
      mockPrisma.dailyRecommendationRun.updateMany.mockResolvedValue({ count: 0 });

      const result = await repairFailedRunsWithPicks();

      // The where clause guarantees only failed+aiProcessed 0+uniqueStocks>0
      // rows match — completed runs and runs with ANY AI verdicts are excluded.
      const where = mockPrisma.dailyRecommendationRun.updateMany.mock.calls[0][0]?.where;
      expect(where.status).toEqual("failed");
      expect(where.aiProcessed).toEqual(0);
      expect(where.uniqueStocks).toEqual({ gt: 0 });
      expect(result.repaired).toBe(0);
    });

    test("is idempotent — a second sweep is a zero no-op with NO cache invalidation", async () => {
      mockPrisma.dailyRecommendationRun.updateMany.mockResolvedValue({ count: 0 });

      const result = await repairFailedRunsWithPicks();

      expect(result.repaired).toBe(0);
      // cache invalidation only fires when something was actually repaired
      expect(cache.flushAll).not.toHaveBeenCalled();
    });

    test("never throws — returns repaired 0 and logs on DB failure", async () => {
      mockPrisma.dailyRecommendationRun.updateMany.mockRejectedValue(new Error("Accelerate down"));

      const result = await repairFailedRunsWithPicks();

      expect(result).toEqual({ repaired: 0 });
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
      // Every priced tracker is pushed to the SQLite mirror (write-through);
      // the Prisma update path no longer runs.
      expect(mockSqlite.upsertRecommendationTracker).toHaveBeenCalledTimes(2);
      expect(mockPrisma.recommendationTracker.update).not.toHaveBeenCalled();
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
      // FRESH updated with the bridged price, RELIANCE with its DB close —
      // both via the mirror write-through upsert.
      const trackerUpserts = mockSqlite.upsertRecommendationTracker.mock.calls as any[][];
      expect(
        trackerUpserts.some((c) => c[0]?.id === "t2" && c[0]?.currentPrice === 555),
      ).toBe(true);
      expect(
        trackerUpserts.some((c) => c[0]?.id === "t1" && c[0]?.currentPrice === 2500),
      ).toBe(true);
      expect(mockPrisma.recommendationTracker.update).not.toHaveBeenCalled();
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

/**
 * v3.49.0 (Spec 30) — freshness / next-run surfacing.
 *
 * The recommendations cron is weekday-only (`30 4 * * 1-5`), which is correct
 * (NSE closed weekends) but previously left a weekend viewer staring at a stale
 * "Last updated" with no explanation. These helpers make the API honest. The
 * tests pin the three properties the UI depends on: (1) a stale determination
 * that is a NEUTRAL elapsed-time fact, never an error; (2) `nextRunAt` that is
 * always present (cron row → expression fallback, never throws); and (3) the
 * whole payload degrading to non-500 defaults if a freshness read blows up.
 */
const mockLogger = jest.requireMock<{
  warn: jest.Mock;
  info: jest.Mock;
  error: jest.Mock;
  debug: jest.Mock;
}>("@/lib/logger");

describe("Spec 30 — freshness / next-run helpers", () => {
  // A Wednesday, 05:00 UTC (after the 04:30 fire time) — a realistic weekday.
  const NOW = new Date("2026-10-14T05:00:00.000Z");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("computeIsStale (pure)", () => {
    it("treats a null / unparseable date as stale", () => {
      expect(computeIsStale(null, NOW)).toBe(true);
      expect(computeIsStale(undefined, NOW)).toBe(true);
      expect(computeIsStale("not-a-date", NOW)).toBe(true);
    });

    it("is fresh within the 48h window", () => {
      const recent = new Date(NOW.getTime() - 2 * 60 * 60_000).toISOString();
      expect(computeIsStale(recent, NOW)).toBe(false);
    });

    it("is stale past the 48h window", () => {
      const old = new Date(NOW.getTime() - 72 * 60 * 60_000).toISOString();
      expect(computeIsStale(old, NOW)).toBe(true);
    });
  });

  describe("getNextRunAt", () => {
    it("prefers the system cron row's nextRun", async () => {
      const next = new Date("2026-10-15T04:30:00.000Z");
      mockPrisma.cronJob.findFirst.mockResolvedValue({ nextRun: next });

      await expect(getNextRunAt()).resolves.toEqual(next);
      expect(mockPrisma.cronJob.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { name: expect.any(String) } }),
      );
    });

    it("falls back to calculateNextRun when the cron row is missing", async () => {
      mockPrisma.cronJob.findFirst.mockResolvedValue(null);
      const result = await getNextRunAt();
      expect(result).toBeInstanceOf(Date);
    });

    it("falls back (never throws) when the cron row read rejects", async () => {
      mockPrisma.cronJob.findFirst.mockRejectedValue(new Error("DB down"));
      const result = await getNextRunAt();
      expect(result).toBeInstanceOf(Date);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe("hasSuccessfulRunToday", () => {
    it("returns true when a completed + AI run exists today", async () => {
      mockPrisma.dailyRecommendationRun.count.mockResolvedValue(1);
      await expect(hasSuccessfulRunToday(NOW)).resolves.toBe(true);
      expect(mockPrisma.dailyRecommendationRun.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: "completed" }),
        }),
      );
    });

    it("returns false when no run exists today", async () => {
      mockPrisma.dailyRecommendationRun.count.mockResolvedValue(0);
      await expect(hasSuccessfulRunToday(NOW)).resolves.toBe(false);
    });

    it("fails open (false) when the DB read throws — catch-up owns the path", async () => {
      mockPrisma.dailyRecommendationRun.count.mockRejectedValue(new Error("boom"));
      await expect(hasSuccessfulRunToday(NOW)).resolves.toBe(false);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe("computeFreshnessFields", () => {
    it("assembles nextRunAt + lastUpdatedAt + isStale=false for a fresh run", async () => {
      const next = new Date("2026-10-15T04:30:00.000Z");
      const runDate = new Date(NOW.getTime() - 60 * 60_000);
      mockPrisma.cronJob.findFirst.mockResolvedValue({ nextRun: next });
      mockPrisma.dailyRecommendationRun.findFirst.mockResolvedValue({ runDate });

      await expect(computeFreshnessFields(NOW)).resolves.toEqual({
        nextRunAt: next.toISOString(),
        lastUpdatedAt: runDate.toISOString(),
        isStale: false,
        scheduleCron: RECOMMENDATION_CRON_DISPLAY,
      });
    });

    it("marks a >48h-old successful run as stale", async () => {
      const runDate = new Date(NOW.getTime() - 96 * 60 * 60_000);
      mockPrisma.cronJob.findFirst.mockResolvedValue(null);
      mockPrisma.dailyRecommendationRun.findFirst.mockResolvedValue({ runDate });

      const f = await computeFreshnessFields(NOW);
      expect(f.isStale).toBe(true);
      expect(f.lastUpdatedAt).toBe(runDate.toISOString());
    });

    it("treats 'no successful run at all' as stale (null-dated)", async () => {
      mockPrisma.cronJob.findFirst.mockResolvedValue(null);
      mockPrisma.dailyRecommendationRun.findFirst.mockResolvedValue(null);

      const f = await computeFreshnessFields(NOW);
      expect(f.lastUpdatedAt).toBeNull();
      expect(f.isStale).toBe(true);
    });

    it("never throws — a hard read failure yields defaults with isStale=false", async () => {
      mockPrisma.cronJob.findFirst.mockResolvedValue(null);
      mockPrisma.dailyRecommendationRun.findFirst.mockRejectedValue(new Error("boom"));

      const f = await computeFreshnessFields(NOW);
      expect(f).toEqual({
        nextRunAt: null,
        lastUpdatedAt: null,
        isStale: false,
        scheduleCron: RECOMMENDATION_CRON_DISPLAY,
      });
    });
  });
});
