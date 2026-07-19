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

// ─── Imports ──────────────────────────────────────────────────────────────

import {
  analyzeStocks,
  analyzeSingleStock,
  type StockAnalysisInput,
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

  beforeEach(() => {
    jest.clearAllMocks();
    mockDirectPrompt.mockReset();
    mockTrackAiCall.mockReset();
  });

  // ── analyzeStocks — basic flow ───────────────────────────────────────

  describe("analyzeStocks", () => {
    test("returns failed results when AI is not configured", async () => {
      const results = await analyzeStocks([makeStock()], { model: "", apiKey: "", temperature: 0.3, maxTokens: 2048, enabled: false });
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].aiRecommendation.recommendation).toBe("HOLD");
      expect(results[0].error).toContain("not configured");
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

    test("analyzes multiple stocks in batches of 5", async () => {
      const stocks = Array.from({ length: 7 }, (_, i) =>
        makeStock({ symbol: `STOCK${i + 1}`, price: 100 * (i + 1) }),
      );
      mockDirectPrompt.mockResolvedValue(makeAIResponse(stocks.slice(0, 5)));

      const results = await analyzeStocks(stocks, VALID_AI_CONFIG);
      // 7 stocks = 2 batches (5 + 2)
      expect(mockDirectPrompt).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(7);
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

    test("falls back to default when response is unparseable", async () => {
      const stock = makeStock();
      mockDirectPrompt.mockResolvedValue("I cannot provide analysis for these stocks.");

      const results = await analyzeStocks([stock], VALID_AI_CONFIG);
      expect(results[0].success).toBe(true); // parse didn't throw
      expect(results[0].aiRecommendation.recommendation).toBe("HOLD");
      expect(results[0].aiRecommendation.confidence).toBe(50);
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
      expect(results[0].symbol).toBe("RELIANCE");
      expect(results[0].aiRecommendation.recommendation).toBe("SELL");
      expect(results[1].symbol).toBe("TCS");
      expect(results[1].aiRecommendation.recommendation).toBe("BUY");
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

    test("uses stock price as targetPrice when AI returns 0", async () => {
      const stock = makeStock({ price: 2500 });
      mockDirectPrompt.mockResolvedValue(JSON.stringify([
        { symbol: "RELIANCE", recommendation: "BUY", confidence: 70, targetPrice: 0, stopLoss: 0, timeHorizon: "medium", reasoning: "Good.", riskFactors: [] },
      ]));

      const results = await analyzeStocks([stock], VALID_AI_CONFIG);
      expect(results[0].aiRecommendation.targetPrice).toBe(2500);
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

  // ── Batch failure isolation ──────────────────────────────────────────

  describe("Batch failure isolation", () => {
    test("continues processing after one batch fails", async () => {
      const stocks = Array.from({ length: 10 }, (_, i) =>
        makeStock({ symbol: `STOCK${i + 1}`, price: 100 * (i + 1) }),
      );

      // First batch fails (both retry attempts), second succeeds
      mockDirectPrompt
        .mockRejectedValueOnce(new Error("Batch 1 failed"))
        .mockRejectedValueOnce(new Error("Batch 1 failed"))
        .mockResolvedValueOnce(makeAIResponse(stocks.slice(5, 10)));

      const results = await analyzeStocks(stocks, VALID_AI_CONFIG);
      expect(results).toHaveLength(10);
      // First 5 are failed
      expect(results.slice(0, 5).every((r) => r.success === false)).toBe(true);
      // Last 5 are successful
      expect(results.slice(5).every((r) => r.success === true)).toBe(true);
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
});
