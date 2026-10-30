/**
 * Tests for recommendation-agent — AI stock analysis with parsing, normalization,
 * batch processing, retry logic, and error handling.
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

jest.mock("@openrouter/agent", () => ({
  __esModule: true,
  OpenRouter: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: jest.fn() } },
  })),
  SDKHooks: {},
}));

jest.mock("@/lib/services/ai/llm-provider", () => ({
  __esModule: true,
  directPrompt: jest.fn(),
  getClient: jest.fn(),
  resetClient: jest.fn(),
  getPromptTimeoutMs: jest.fn(() => 120_000),
  isQuotaExhausted: jest.fn(() => false),
  QUOTA_EXHAUSTED_MESSAGE: "AI credits exhausted — try after 6 hours or wait for the daily reset.",
}));

jest.mock("@/lib/services/ai/ai-monitoring", () => ({
  __esModule: true,
  trackAiCall: jest.fn(),
}));

jest.mock("@/lib/services/ai/config", () => ({
  __esModule: true,
  hasValidConfig: jest.fn((config?: any) => {
    // Only valid if config.apiKey is a non-empty string — no env fallback
    return !!(config && config.apiKey);
  }),
  getDefaultConfig: jest.fn(() => ({
    model: "test-model",
    apiKey: "test-key",
    temperature: 0.3,
    maxTokens: 2048,
    enabled: true,
  })),
}));

// v3.51.0 — the per-UTC-day AI quota latch. Mocked so the agent's wiring can be
// asserted deterministically; the latch's own logic is covered by quotaLatch.test.ts.
jest.mock("@/lib/services/ai/quotaLatch", () => ({
  __esModule: true,
  isAiQuotaExhausted: jest.fn(() => false),
  markAiQuotaExhausted: jest.fn(),
  isDailyFreeQuotaMessage: jest.fn(() => false),
}));

// ─── Imports ──────────────────────────────────────────────────────────────

import {
  analyzeStocks,
  analyzeSingleStock,
  rankStockAnalysisResults,
  type StockAnalysisInput,
  type StockAnalysisResult,
} from "@/lib/services/ai/recommendation-agent";

// ─── Helpers ──────────────────────────────────────────────────────────────

const VALID_AI_CONFIG = { model: "test-model", apiKey: "test-key", temperature: 0.3, maxTokens: 2048, enabled: true };

function makeStock(overrides: Partial<StockAnalysisInput> = {}): StockAnalysisInput {
  return {
    symbol: "RELIANCE",
    price: 2500,
    change: 50,
    changePercent: 2.04,
    volume: 1000000,
    screenerNames: ["Short Term Breakouts", "Bullish Momentum"],
    ...overrides,
  };
}

function makeAIResponse(stocks: StockAnalysisInput[], overrides: Record<string, unknown> = {}) {
  return JSON.stringify(
    stocks.map((s) => ({
      symbol: s.symbol,
      recommendation: "BUY",
      confidence: 75,
      targetPrice: Math.round(s.price * 1.1),
      stopLoss: Math.round(s.price * 0.95),
      timeHorizon: "medium",
      reasoning: `Strong momentum for ${s.symbol} with bullish screener signals.`,
      riskFactors: ["Market volatility", "Sector rotation"],
      ...overrides,
    })),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("recommendation-agent", () => {
  // Get mock references AFTER jest.mock() has been applied
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { directPrompt: mockDirectPrompt } = require("@/lib/services/ai/llm-provider") as { directPrompt: jest.Mock };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { trackAiCall: mockTrackAiCall } = require("@/lib/services/ai/ai-monitoring") as { trackAiCall: jest.Mock };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const llmMock = require("@/lib/services/ai/llm-provider") as { isQuotaExhausted: jest.Mock };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const quotaMock = require("@/lib/services/ai/quotaLatch") as {
    isAiQuotaExhausted: jest.Mock;
    markAiQuotaExhausted: jest.Mock;
    isDailyFreeQuotaMessage: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDirectPrompt.mockReset();
    mockTrackAiCall.mockReset();
    // `clearAllMocks` clears calls, not implementations — reset the ones tests override.
    llmMock.isQuotaExhausted.mockReturnValue(false);
    quotaMock.isAiQuotaExhausted.mockReturnValue(false);
    quotaMock.markAiQuotaExhausted.mockReset();
    quotaMock.isDailyFreeQuotaMessage.mockReturnValue(false);
  });

  // ── daily free-quota latch wiring (v3.51.0) ──────────────────────────

  describe("daily free-quota latch", () => {
    test("makes ZERO AI calls and returns all-failed when the latch is already set", async () => {
      quotaMock.isAiQuotaExhausted.mockReturnValue(true);
      const stocks = [makeStock({ symbol: "AAA" }), makeStock({ symbol: "BBB" })];

      const results = await analyzeStocks(stocks, VALID_AI_CONFIG);

      expect(mockDirectPrompt).not.toHaveBeenCalled();
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success === false)).toBe(true);
      expect(results[0].error).toMatch(/quota/i);
    });

    test("latches the UTC day when a batch returns the free-models-per-day 429", async () => {
      llmMock.isQuotaExhausted.mockReturnValue(true);
      quotaMock.isDailyFreeQuotaMessage.mockReturnValue(true);
      mockDirectPrompt.mockResolvedValue(
        'AI request failed (HTTP 429). Please check your OpenRouter API key. [{"error":{"message":"free-models-per-day"}}]',
      );

      const results = await analyzeStocks([makeStock()], VALID_AI_CONFIG);

      expect(results[0].success).toBe(false);
      expect(quotaMock.markAiQuotaExhausted).toHaveBeenCalledTimes(1);
      expect(quotaMock.markAiQuotaExhausted.mock.calls[0][0]).toMatchObject({ model: "test-model" });
    });

    test("does NOT latch a generic 429 (transient per-minute rate limit)", async () => {
      llmMock.isQuotaExhausted.mockReturnValue(true);
      quotaMock.isDailyFreeQuotaMessage.mockReturnValue(false);
      mockDirectPrompt.mockResolvedValue("AI request failed (HTTP 429). Please check your OpenRouter API key.");

      await analyzeStocks([makeStock()], VALID_AI_CONFIG);

      expect(quotaMock.markAiQuotaExhausted).not.toHaveBeenCalled();
    });
  });

  // ── analyzeStocks — basic flow ───────────────────────────────────────

  describe("analyzeStocks", () => {
    test("returns failed results when AI is not configured", async () => {
      const results = await analyzeStocks([makeStock()], { model: "", apiKey: "", temperature: 0.3, maxTokens: 2048, enabled: false });
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].aiRecommendation.recommendation).toBe("HOLD");
      expect(results[0].aiRecommendation.confidence).toBe(50);
      expect(results[0].error).toContain("not configured");
    });

    test("failed results get price-based target/SL defaults (never ₹0.00)", async () => {
      const stock = makeStock({ price: 2500 });
      const results = await analyzeStocks([stock], { model: "", apiKey: "", temperature: 0.3, maxTokens: 2048, enabled: false });
      expect(results[0].success).toBe(false);
      // Target = 2500 * 1.1 = 2750, Stop Loss = 2500 * 0.95 = 2375
      expect(results[0].aiRecommendation.targetPrice).toBe(2750);
      expect(results[0].aiRecommendation.stopLoss).toBe(2375);
      expect(results[0].aiRecommendation.reasoning).toBe("AI analysis unavailable — defaulting to HOLD");
    });

    test("analyzes a single stock successfully", async () => {
      const stock = makeStock();
      mockDirectPrompt.mockResolvedValue(makeAIResponse([stock]));

      const results = await analyzeStocks([stock], VALID_AI_CONFIG);
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].aiRecommendation.recommendation).toBe("BUY");
      expect(results[0].aiRecommendation.confidence).toBe(75);
      expect(results[0].aiRecommendation.targetPrice).toBe(2750);
      expect(results[0].aiRecommendation.stopLoss).toBe(2375);
      expect(results[0].tokensUsed).toBeGreaterThan(0);
      expect(results[0].executionMs).toBeGreaterThanOrEqual(0);
    });

    test("analyzes multiple stocks in batches of 20", async () => {
      const stocks = Array.from({ length: 25 }, (_, i) =>
        makeStock({ symbol: `STOCK${i + 1}`, price: 100 * (i + 1) }),
      );
      mockDirectPrompt.mockResolvedValue(makeAIResponse(stocks.slice(0, 20)));

      const results = await analyzeStocks(stocks, VALID_AI_CONFIG);
      // v3.52.0: BATCH_SIZE=20 → 25 stocks = 2 batches (20 + 5)
      expect(mockDirectPrompt).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(25);
    });

    test("tracks successful AI call via monitoring", async () => {
      const stock = makeStock();
      mockDirectPrompt.mockResolvedValue(makeAIResponse([stock]));

      await analyzeStocks([stock], VALID_AI_CONFIG);
      expect(mockTrackAiCall).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "recommendation_batch",
          status: "success",
          analysisType: "recommendation",
        }),
      );
    });
  });

  // ── AI response parsing ──────────────────────────────────────────────

  describe("AI response parsing", () => {
    test("parses valid JSON array response", async () => {
      const stock = makeStock();
      const response = JSON.stringify([
        { symbol: "RELIANCE", recommendation: "BUY", confidence: 80, targetPrice: 2700, stopLoss: 2400, timeHorizon: "short", reasoning: "Bullish.", riskFactors: ["Risk 1"] },
      ]);
      mockDirectPrompt.mockResolvedValue(response);

      const results = await analyzeStocks([stock], VALID_AI_CONFIG);
      expect(results[0].aiRecommendation.recommendation).toBe("BUY");
      expect(results[0].aiRecommendation.confidence).toBe(80);
      expect(results[0].aiRecommendation.timeHorizon).toBe("short");
    });

    test("parses response wrapped in markdown code block", async () => {
      const stock = makeStock();
      const response = '```json\n' + JSON.stringify([
        { symbol: "RELIANCE", recommendation: "SELL", confidence: 60, targetPrice: 2200, stopLoss: 2600, timeHorizon: "long", reasoning: "Bearish.", riskFactors: ["Risk A"] },
      ]) + '\n```';
      mockDirectPrompt.mockResolvedValue(response);

      const results = await analyzeStocks([stock], VALID_AI_CONFIG);
      expect(results[0].aiRecommendation.recommendation).toBe("SELL");
      expect(results[0].aiRecommendation.timeHorizon).toBe("long");
    });

    test("parses response with text wrapping around JSON array", async () => {
      const stock = makeStock();
      const inner = JSON.stringify([
        { symbol: "RELIANCE", recommendation: "HOLD", confidence: 55, targetPrice: 2500, stopLoss: 2350, timeHorizon: "medium", reasoning: "Neutral.", riskFactors: [] },
      ]);
      const response = `Here is my analysis:\n${inner}\nI hope this helps.`;
      mockDirectPrompt.mockResolvedValue(response);

      const results = await analyzeStocks([stock], VALID_AI_CONFIG);
      expect(results[0].aiRecommendation.recommendation).toBe("HOLD");
    });

    test("fails a batch when the response is unparseable (no silent all-HOLD)", async () => {
      const stock = makeStock();
      mockDirectPrompt.mockResolvedValue("I cannot provide analysis for these stocks.");

      const results = await analyzeStocks([stock], VALID_AI_CONFIG);
      // v3.8.0: unusable responses are retried, NOT silently accepted as
      // HOLD-success. v3.10.1 adds the model fallback chain: primary gets
      // 2 attempts, then each fallback model ("openrouter/free",
      // "openrouter/auto", "nvidia/nemotron-3-ultra-550b-a55b:free") gets
      // one — 5 calls total. The batch is marked failed so monitoring and
      // admins see the truth.
      expect(results[0].success).toBe(false);
      expect(results[0].aiRecommendation.recommendation).toBe("HOLD");
      expect(results[0].aiRecommendation.confidence).toBe(50);
      expect(results[0].error).toContain("Unusable AI response");
      expect(mockDirectPrompt).toHaveBeenCalledTimes(5);
    });

    test("falls back to the shared fallback models when the primary fails", async () => {
      const stock = makeStock();
      mockDirectPrompt.mockImplementation(async (_prompt: string, config?: any) => {
        // Primary ("test-model") keeps failing; the first fallback works.
        if (config?.model === "test-model") return "I cannot analyze this.";
        return JSON.stringify([
          { symbol: "RELIANCE", recommendation: "BUY", confidence: 80, targetPrice: 2700, stopLoss: 2400, timeHorizon: "medium", reasoning: "Fallback model worked.", riskFactors: [] },
        ]);
      });

      const results = await analyzeStocks([stock], VALID_AI_CONFIG);
      expect(results[0].success).toBe(true);
      expect(results[0].aiRecommendation.recommendation).toBe("BUY");
      // 2 primary attempts (both unusable) + 1 "openrouter/free" attempt.
      expect(mockDirectPrompt).toHaveBeenCalledTimes(3);
      const lastCall = mockDirectPrompt.mock.calls[2];
      expect(lastCall[1]?.model).toBe("openrouter/free");
    });

    test("matches recommendations by symbol when order differs", async () => {
      const stocks = [
        makeStock({ symbol: "RELIANCE" }),
        makeStock({ symbol: "TCS", price: 3800 }),
      ];
      // AI returns in reverse order
      const response = JSON.stringify([
        { symbol: "TCS", recommendation: "BUY", confidence: 85, targetPrice: 4200, stopLoss: 3600, timeHorizon: "short", reasoning: "Strong.", riskFactors: [] },
        { symbol: "RELIANCE", recommendation: "SELL", confidence: 65, targetPrice: 2300, stopLoss: 2600, timeHorizon: "medium", reasoning: "Weak.", riskFactors: [] },
      ]);
      mockDirectPrompt.mockResolvedValue(response);

      const results = await analyzeStocks(stocks, VALID_AI_CONFIG);
      const reliance = results.find((r) => r.symbol === "RELIANCE");
      const tcs = results.find((r) => r.symbol === "TCS");
      expect(reliance?.aiRecommendation.recommendation).toBe("SELL");
      expect(tcs?.aiRecommendation.recommendation).toBe("BUY");
      // v3.52.0: batch results are combined AND ranked by confidence desc,
      // so the AI's response order never leaks into the feed.
      expect(results[0].symbol).toBe("TCS");
    });
  });

  // ── Recommendation normalization ─────────────────────────────────────

  describe("Recommendation normalization", () => {
    test("normalizes lowercase recommendation to uppercase", async () => {
      const stock = makeStock();
      mockDirectPrompt.mockResolvedValue(JSON.stringify([
        { symbol: "RELIANCE", recommendation: "buy", confidence: 70, targetPrice: 2700, stopLoss: 2400, timeHorizon: "medium", reasoning: "Good.", riskFactors: [] },
      ]));

      const results = await analyzeStocks([stock], VALID_AI_CONFIG);
      expect(results[0].aiRecommendation.recommendation).toBe("BUY");
    });

    test("defaults invalid recommendation to HOLD", async () => {
      const stock = makeStock();
      mockDirectPrompt.mockResolvedValue(JSON.stringify([
        { symbol: "RELIANCE", recommendation: "ACCUMULATE", confidence: 70, targetPrice: 2700, stopLoss: 2400, timeHorizon: "medium", reasoning: "Good.", riskFactors: [] },
      ]));

      const results = await analyzeStocks([stock], VALID_AI_CONFIG);
      expect(results[0].aiRecommendation.recommendation).toBe("HOLD");
    });

    test("clamps confidence to 0-100", async () => {
      const stock = makeStock();
      mockDirectPrompt.mockResolvedValue(JSON.stringify([
        { symbol: "RELIANCE", recommendation: "BUY", confidence: 150, targetPrice: 2700, stopLoss: 2400, timeHorizon: "medium", reasoning: "Good.", riskFactors: [] },
      ]));

      const results = await analyzeStocks([stock], VALID_AI_CONFIG);
      expect(results[0].aiRecommendation.confidence).toBe(100);
    });

    test("clamps negative confidence to 0", async () => {
      const stock = makeStock();
      mockDirectPrompt.mockResolvedValue(JSON.stringify([
        { symbol: "RELIANCE", recommendation: "BUY", confidence: -10, targetPrice: 2700, stopLoss: 2400, timeHorizon: "medium", reasoning: "Good.", riskFactors: [] },
      ]));

      const results = await analyzeStocks([stock], VALID_AI_CONFIG);
      expect(results[0].aiRecommendation.confidence).toBe(0);
    });

    test("uses price-based defaults for targetPrice and stopLoss when AI returns 0", async () => {
      const stock = makeStock({ price: 2500 });
      mockDirectPrompt.mockResolvedValue(JSON.stringify([
        { symbol: "RELIANCE", recommendation: "BUY", confidence: 70, targetPrice: 0, stopLoss: 0, timeHorizon: "medium", reasoning: "Good.", riskFactors: [] },
      ]));

      const results = await analyzeStocks([stock], VALID_AI_CONFIG);
      // Target = price * 1.1, Stop Loss = price * 0.95 (price-based fallbacks, never ₹0.00)
      expect(results[0].aiRecommendation.targetPrice).toBe(2750);
      expect(results[0].aiRecommendation.stopLoss).toBe(2375);
    });

    test("corrects SELL levels that contradict direction (target below, stop above)", async () => {
      // Real bug: ITC SELL @ ₹279 returned target ₹306.9 / stop ₹265.05 —
      // a BUY-style layout on a SELL rec. The evaluator must invert them.
      const stock = makeStock({ price: 279 });
      mockDirectPrompt.mockResolvedValue(JSON.stringify([
        { symbol: "RELIANCE", recommendation: "SELL", confidence: 65, targetPrice: 306.9, stopLoss: 265.05, timeHorizon: "short", reasoning: "Bearish.", riskFactors: [] },
      ]));

      const results = await analyzeStocks([stock], VALID_AI_CONFIG);
      const { targetPrice, stopLoss } = results[0].aiRecommendation;
      // Corrected: target BELOW price, stop ABOVE price (direction-aware defaults)
      expect(targetPrice).toBeLessThan(279);
      expect(stopLoss).toBeGreaterThan(279);
    });

    test("keeps valid SELL levels unchanged (target below, stop above)", async () => {
      const stock = makeStock({ price: 2500 });
      mockDirectPrompt.mockResolvedValue(JSON.stringify([
        { symbol: "RELIANCE", recommendation: "SELL", confidence: 70, targetPrice: 2300, stopLoss: 2600, timeHorizon: "medium", reasoning: "Bearish.", riskFactors: [] },
      ]));

      const results = await analyzeStocks([stock], VALID_AI_CONFIG);
      expect(results[0].aiRecommendation.targetPrice).toBe(2300);
      expect(results[0].aiRecommendation.stopLoss).toBe(2600);
    });

    test("defaults timeHorizon to medium for invalid values", async () => {
      const stock = makeStock();
      mockDirectPrompt.mockResolvedValue(JSON.stringify([
        { symbol: "RELIANCE", recommendation: "BUY", confidence: 70, targetPrice: 2700, stopLoss: 2400, timeHorizon: "yearly", reasoning: "Good.", riskFactors: [] },
      ]));

      const results = await analyzeStocks([stock], VALID_AI_CONFIG);
      expect(results[0].aiRecommendation.timeHorizon).toBe("medium");
    });

    test("truncates reasoning to 500 chars", async () => {
      const stock = makeStock();
      const longReasoning = "A".repeat(600);
      mockDirectPrompt.mockResolvedValue(JSON.stringify([
        { symbol: "RELIANCE", recommendation: "BUY", confidence: 70, targetPrice: 2700, stopLoss: 2400, timeHorizon: "medium", reasoning: longReasoning, riskFactors: [] },
      ]));

      const results = await analyzeStocks([stock], VALID_AI_CONFIG);
      expect(results[0].aiRecommendation.reasoning.length).toBeLessThanOrEqual(500);
    });

    test("handles missing riskFactors gracefully", async () => {
      const stock = makeStock();
      mockDirectPrompt.mockResolvedValue(JSON.stringify([
        { symbol: "RELIANCE", recommendation: "BUY", confidence: 70, targetPrice: 2700, stopLoss: 2400, timeHorizon: "medium", reasoning: "Good." },
      ]));

      const results = await analyzeStocks([stock], VALID_AI_CONFIG);
      expect(Array.isArray(results[0].aiRecommendation.riskFactors)).toBe(true);
      expect(results[0].aiRecommendation.riskFactors.length).toBeGreaterThan(0);
    });

    test("strips non-string risk factors", async () => {
      const stock = makeStock();
      mockDirectPrompt.mockResolvedValue(JSON.stringify([
        { symbol: "RELIANCE", recommendation: "BUY", confidence: 70, targetPrice: 2700, stopLoss: 2400, timeHorizon: "medium", reasoning: "Good.", riskFactors: ["Valid risk", 123, null, "Another risk"] },
      ]));

      const results = await analyzeStocks([stock], VALID_AI_CONFIG);
      expect(results[0].aiRecommendation.riskFactors).toEqual(["Valid risk", "Another risk"]);
    });

    test("parses confidence from string with special chars", async () => {
      const stock = makeStock();
      mockDirectPrompt.mockResolvedValue(JSON.stringify([
        { symbol: "RELIANCE", recommendation: "BUY", confidence: "75%", targetPrice: "₹2700", stopLoss: "₹2400", timeHorizon: "medium", reasoning: "Good.", riskFactors: [] },
      ]));

      const results = await analyzeStocks([stock], VALID_AI_CONFIG);
      expect(results[0].aiRecommendation.confidence).toBe(75);
      expect(results[0].aiRecommendation.targetPrice).toBe(2700);
    });
  });

  // ── Retry logic ──────────────────────────────────────────────────────

  describe("Retry logic", () => {
    test("retries failed batch and succeeds on second attempt", async () => {
      const stock = makeStock();
      mockDirectPrompt
        .mockRejectedValueOnce(new Error("Rate limit"))
        .mockResolvedValueOnce(makeAIResponse([stock]));

      const results = await analyzeStocks([stock], VALID_AI_CONFIG);
      expect(mockDirectPrompt).toHaveBeenCalledTimes(2);
      expect(results[0].success).toBe(true);
    });

    test("fails after exhausting retries", async () => {
      const stock = makeStock();
      mockDirectPrompt
        .mockRejectedValue(new Error("Persistent error"));

      const results = await analyzeStocks([stock], VALID_AI_CONFIG);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain("Persistent error");
      expect(mockTrackAiCall).toHaveBeenCalledWith(
        expect.objectContaining({ status: "error" }),
      );
    });

    test("tracks AI call failure after retries exhausted", async () => {
      const stock = makeStock();
      mockDirectPrompt.mockRejectedValue(new Error("fail"));

      await analyzeStocks([stock], VALID_AI_CONFIG);
      expect(mockTrackAiCall).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "recommendation_batch",
          status: "error",
        }),
      );
    });
  });

  // ── Response verification & retry (v3.8.0) ────────────────────────────

  describe("Response verification & retry", () => {
    test("retries on an empty response and succeeds on the second attempt", async () => {
      const stock = makeStock();
      mockDirectPrompt
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce(makeAIResponse([stock]));

      const results = await analyzeStocks([stock], VALID_AI_CONFIG);
      expect(mockDirectPrompt).toHaveBeenCalledTimes(2);
      expect(results[0].success).toBe(true);
      expect(results[0].aiRecommendation.recommendation).toBe("BUY");
    });

    test("retries on the provider-error marker string", async () => {
      const stock = makeStock();
      mockDirectPrompt
        .mockResolvedValueOnce("AI request failed. Please try again later.")
        .mockResolvedValueOnce(makeAIResponse([stock]));

      const results = await analyzeStocks([stock], VALID_AI_CONFIG);
      expect(mockDirectPrompt).toHaveBeenCalledTimes(2);
      expect(results[0].success).toBe(true);
    });

    test("retries when JSON is truncated (missing a stock) and succeeds", async () => {
      const stocks = [
        makeStock({ symbol: "RELIANCE" }),
        makeStock({ symbol: "TCS", price: 3800 }),
      ];
      // Truncated like the old 2048-token cut: only RELIANCE made it out.
      const truncated = JSON.stringify([
        { symbol: "RELIANCE", recommendation: "BUY", confidence: 75, targetPrice: 2700, stopLoss: 2400, timeHorizon: "medium", reasoning: "Strong.", riskFactors: [] },
      ]);
      mockDirectPrompt
        .mockResolvedValueOnce(truncated)
        .mockResolvedValueOnce(makeAIResponse(stocks));

      const results = await analyzeStocks(stocks, VALID_AI_CONFIG);
      expect(mockDirectPrompt).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
    });

    test("clamps the per-request timeout to the per-batch 5-minute budget", async () => {
      const stock = makeStock();
      mockDirectPrompt.mockResolvedValue(makeAIResponse([stock]));

      await analyzeStocks([stock], VALID_AI_CONFIG);
      const timeoutMs = mockDirectPrompt.mock.calls[0][2] as number;
      expect(timeoutMs).toBeGreaterThan(0);
      expect(timeoutMs).toBeLessThanOrEqual(120_000); // getPromptTimeoutMs default
    });
  });

  // ── Batch failure isolation ──────────────────────────────────────────

  describe("Batch failure isolation", () => {
    test("continues processing after one batch fails", async () => {
      const stocks = Array.from({ length: 40 }, (_, i) =>
        makeStock({ symbol: `STOCK${i + 1}`, price: 100 * (i + 1) }),
      );

      // Implementation-based mock keeps behavior deterministic under the
      // CONCURRENCY=3 worker pool (a sequential queue would race): batch 1
      // (STOCK1-20) always fails both attempts; batch 2 (STOCK21-40) succeeds.
      // NOTE: `\bSTOCK1\b` — a plain includes("STOCK1") also matches "STOCK10",
      // which would wrongly reject batch 2.
      mockDirectPrompt.mockImplementation((prompt: string) => {
        if (/\bSTOCK1\b/.test(prompt)) {
          return Promise.reject(new Error("Batch 1 failed"));
        }
        return Promise.resolve(makeAIResponse(stocks.slice(20, 40)));
      });

      const results = await analyzeStocks(stocks, VALID_AI_CONFIG);
      expect(results).toHaveLength(40);
      // v3.52.0 BATCH_SIZE=20 → 40 stocks = 2 batches. Failed results are
      // ranked LAST (success before failure), so assert per-symbol.
      const failed = results.filter((r) => !r.success).map((r) => r.symbol);
      const succeeded = results.filter((r) => r.success).map((r) => r.symbol);
      expect(failed).toHaveLength(20);
      expect(succeeded).toHaveLength(20);
      expect(failed).toEqual(expect.arrayContaining(["STOCK1", "STOCK20"]));
      expect(succeeded).toEqual(expect.arrayContaining(["STOCK21", "STOCK40"]));
      // A failed stock never outranks a real verdict.
      expect(results.slice(0, 20).every((r) => r.success)).toBe(true);
    });
  });

  // ── analyzeSingleStock ───────────────────────────────────────────────

  describe("analyzeSingleStock", () => {
    test("returns single result for one stock", async () => {
      const stock = makeStock();
      mockDirectPrompt.mockResolvedValue(makeAIResponse([stock]));

      const result = await analyzeSingleStock(stock, VALID_AI_CONFIG);
      expect(result.symbol).toBe("RELIANCE");
      expect(result.success).toBe(true);
    });
  });

  // ── Combined-batch ranking (v3.52.0) ─────────────────────────────────

  describe("rankStockAnalysisResults", () => {
    const result = (overrides: Partial<StockAnalysisResult> & { symbol: string }): StockAnalysisResult => ({
      price: 100,
      change: 1,
      changePercent: 1,
      volume: 1_000,
      screenerNames: [],
      aiRecommendation: {
        recommendation: "HOLD",
        confidence: 50,
        targetPrice: 0,
        stopLoss: 0,
        timeHorizon: "medium",
        reasoning: "",
        riskFactors: [],
      },
      tokensUsed: 0,
      executionMs: 0,
      success: true,
      ...overrides,
    });

    test("orders by confidence desc first", () => {
      const ranked = rankStockAnalysisResults([
        result({ symbol: "A", aiRecommendation: { ...result({ symbol: "A" }).aiRecommendation, confidence: 60 } }),
        result({ symbol: "B", aiRecommendation: { ...result({ symbol: "B" }).aiRecommendation, confidence: 91 } }),
        result({ symbol: "C", aiRecommendation: { ...result({ symbol: "C" }).aiRecommendation, confidence: 75 } }),
      ]);
      expect(ranked.map((r) => r.symbol)).toEqual(["B", "C", "A"]);
    });

    test("breaks confidence ties by screener agreement, then market cap", () => {
      const ranked = rankStockAnalysisResults([
        result({ symbol: "LOWCAP", screenerNames: ["s1"], marketCap: 1e9 }),
        result({ symbol: "BIGCAP", screenerNames: ["s1"], marketCap: 1e12 }),
        result({ symbol: "MULTI", screenerNames: ["s1", "s2", "s3"], marketCap: 1e8 }),
      ]);
      expect(ranked.map((r) => r.symbol)).toEqual(["MULTI", "BIGCAP", "LOWCAP"]);
    });

    test("always puts failed analyses last, even at higher confidence", () => {
      const ranked = rankStockAnalysisResults([
        result({
          symbol: "FAILED",
          success: false,
          error: "bad response",
          aiRecommendation: { ...result({ symbol: "FAILED" }).aiRecommendation, confidence: 99 },
        }),
        result({ symbol: "OK", aiRecommendation: { ...result({ symbol: "OK" }).aiRecommendation, confidence: 40 } }),
      ]);
      expect(ranked.map((r) => r.symbol)).toEqual(["OK", "FAILED"]);
    });

    test("is deterministic for full ties (symbol asc) and does not mutate the input", () => {
      const input = [result({ symbol: "ZED" }), result({ symbol: "ACME" })];
      const ranked = rankStockAnalysisResults(input);
      expect(ranked.map((r) => r.symbol)).toEqual(["ACME", "ZED"]);
      expect(input.map((r) => r.symbol)).toEqual(["ZED", "ACME"]);
    });

    test("analyzeStocks returns the combined batches in ranked order", async () => {
      const stocks = [
        makeStock({ symbol: "LOW", price: 100 }),
        makeStock({ symbol: "HIGH", price: 200 }),
      ];
      mockDirectPrompt.mockResolvedValue(
        JSON.stringify([
          { symbol: "LOW", recommendation: "BUY", confidence: 55, targetPrice: 110, stopLoss: 95, timeHorizon: "short", reasoning: "ok", riskFactors: [] },
          { symbol: "HIGH", recommendation: "BUY", confidence: 90, targetPrice: 220, stopLoss: 190, timeHorizon: "short", reasoning: "best", riskFactors: [] },
        ]),
      );

      const results = await analyzeStocks(stocks, VALID_AI_CONFIG);
      expect(results.map((r) => r.symbol)).toEqual(["HIGH", "LOW"]);
    });
  });
});
