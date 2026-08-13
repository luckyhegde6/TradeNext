/**
 * Tests for swing-agent — AI swing analysis with parsing, direction-aware
 * level correction, batch processing, retry, and graceful fallback.
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

jest.mock("@/lib/services/ai/llm-provider", () => ({
  __esModule: true,
  directPrompt: jest.fn(),
  getClient: jest.fn(),
  resetClient: jest.fn(),
  getPromptTimeoutMs: jest.fn(() => 120_000),
}));

jest.mock("@/lib/services/ai/ai-monitoring", () => ({
  __esModule: true,
  trackAiCall: jest.fn(),
}));

jest.mock("@/lib/services/ai/config", () => ({
  __esModule: true,
  hasValidConfig: jest.fn((config?: { apiKey?: string }) => {
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

import { directPrompt } from "@/lib/services/ai/llm-provider";
import {
  analyzeSwingStocks,
  buildSwingAnalysisPrompt,
  parseSwingResponse,
  normalizeSwingAnalysis,
  type SwingAnalysisInput,
} from "@/lib/services/ai/swing-agent";

const mockedDirectPrompt = directPrompt as jest.MockedFunction<typeof directPrompt>;

const VALID_AI_CONFIG = { model: "test-model", apiKey: "test-key", temperature: 0.3, maxTokens: 2048, enabled: true };

function makeStock(overrides: Partial<SwingAnalysisInput> = {}): SwingAnalysisInput {
  return {
    symbol: "RELIANCE",
    price: 2500,
    changePercent: 2.04,
    volume: 1_000_000,
    screenerNames: ["Swing Breakout", "Supertrend Trend Finder"],
    families: ["trend", "breakout"],
    momentum10: 5.2,
    momentum20: 12.4,
    volatility20: 1.8,
    distanceFrom20dHigh: 0,
    ...overrides,
  };
}

function makeAIResponse(
  stocks: SwingAnalysisInput[],
  overrides: Record<string, unknown> = {},
  perStock: (s: SwingAnalysisInput, i: number) => Record<string, unknown> = () => ({}),
) {
  return JSON.stringify(
    stocks.map((s, i) => ({
      symbol: s.symbol,
      action: "LONG",
      confidence: 75,
      entryPrice: s.price,
      targetPrice: Math.round(s.price * 1.12),
      stopLoss: Math.round(s.price * 0.94),
      timeHorizon: "medium",
      logic: `Flagged by ${s.screenerNames.join(", ")} — trend + breakout agree with momentum20 ${s.momentum20}%.`,
      momentumScore: 80,
      riskFactors: ["Market volatility"],
      ...perStock(s, i),
      ...overrides,
    })),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Prompt construction ─────────────────────────────────────────────────

describe("buildSwingAnalysisPrompt", () => {
  it("includes screeners, signal families, and indicator context", () => {
    const prompt = buildSwingAnalysisPrompt([makeStock()]);
    expect(prompt).toContain("Swing Breakout");
    expect(prompt).toContain("Signal families: trend, breakout");
    expect(prompt).toContain("momentum20: 12.4%");
    expect(prompt).toContain("distanceFrom20dHigh: 0.0%");
    expect(prompt).toContain("LONG");
    expect(prompt).toContain("JSON array");
  });
});

// ─── Parsing / normalization ─────────────────────────────────────────────

describe("parseSwingResponse + normalizeSwingAnalysis", () => {
  it("parses direct JSON, matching by symbol order-independently", () => {
    const stocks = [makeStock({ symbol: "RELIANCE" }), makeStock({ symbol: "TCS" })];
    const response = JSON.stringify([
      { symbol: "TCS", action: "SHORT", confidence: 60, entryPrice: 100, targetPrice: 92, stopLoss: 105, timeHorizon: "short", logic: "Bearish reversal.", momentumScore: 40, riskFactors: [] },
      { symbol: "RELIANCE", action: "LONG", confidence: 80, entryPrice: 2500, targetPrice: 2800, stopLoss: 2350, timeHorizon: "medium", logic: "Trend continuation.", momentumScore: 85, riskFactors: ["R1"] },
    ]);
    const analyses = parseSwingResponse(response, stocks);
    expect(analyses).not.toBeNull();
    expect(analyses![0].action).toBe("LONG"); // RELIANCE first (matched by symbol)
    expect(analyses![1].action).toBe("SHORT");
    expect(analyses![0].targetPrice).toBe(2800);
    expect(analyses![0].stopLoss).toBe(2350);
  });

  it("extracts JSON from a markdown code block", () => {
    const stock = makeStock();
    const response = "```json\n" + makeAIResponse([stock]) + "\n```";
    const analyses = parseSwingResponse(response, [stock]);
    expect(analyses).not.toBeNull();
    expect(analyses![0].action).toBe("LONG");
  });

  it("returns null when a stock is missing from the response (truncated JSON)", () => {
    const stocks = [makeStock({ symbol: "RELIANCE" }), makeStock({ symbol: "TCS" })];
    const response = JSON.stringify([
      { symbol: "RELIANCE", action: "LONG", confidence: 75, entryPrice: 2500, targetPrice: 2800, stopLoss: 2350, timeHorizon: "medium", logic: "x", momentumScore: 80, riskFactors: [] },
    ]);
    expect(parseSwingResponse(response, stocks)).toBeNull();
  });

  it("returns null on unparseable garbage", () => {
    expect(parseSwingResponse("AI request failed: 503", [makeStock()])).toBeNull();
  });

  it("corrects direction-contradictory SELL levels (target above price → inverted)", () => {
    const stock = makeStock({ price: 279 });
    const analysis = normalizeSwingAnalysis(
      {
        symbol: "ITC",
        action: "SHORT",
        confidence: 70,
        entryPrice: 279,
        targetPrice: 306.9, // BUY-style target on a SHORT — must be corrected
        stopLoss: 265.05,   // BUY-style stop on a SHORT — must be corrected
        timeHorizon: "medium",
        logic: "Bearish setup.",
        momentumScore: 60,
        riskFactors: [],
      },
      stock,
    );
    expect(analysis.action).toBe("SHORT");
    expect(analysis.targetPrice).toBeLessThan(analysis.entryPrice);
    expect(analysis.stopLoss).toBeGreaterThan(analysis.entryPrice);
  });

  it("validates LONG levels (target > entry > stop) and keeps sane ones", () => {
    const stock = makeStock({ price: 2500 });
    const analysis = normalizeSwingAnalysis(
      {
        symbol: "RELIANCE",
        action: "LONG",
        confidence: 80,
        entryPrice: 2500,
        targetPrice: 2800,
        stopLoss: 2350,
        timeHorizon: "long",
        logic: "Trend continuation with volume.",
        momentumScore: 90,
        riskFactors: ["Crude sensitivity"],
      },
      stock,
    );
    expect(analysis.targetPrice).toBe(2800);
    expect(analysis.stopLoss).toBe(2350);
    expect(analysis.timeHorizon).toBe("long");
  });

  it("clamps confidence/momentumScore to 0–100 and defaults garbage fields", () => {
    const stock = makeStock();
    const analysis = normalizeSwingAnalysis(
      {
        symbol: "RELIANCE",
        action: "bogus", // → OBSERVE
        confidence: 150,
        entryPrice: 0,
        targetPrice: 0,
        stopLoss: 0,
        timeHorizon: "whenever",
        logic: "",
        momentumScore: -5,
        riskFactors: "nope",
      },
      stock,
    );
    expect(analysis.action).toBe("OBSERVE");
    expect(analysis.confidence).toBe(100);
    expect(analysis.momentumScore).toBe(0);
    expect(analysis.timeHorizon).toBe("medium");
    expect(analysis.entryPrice).toBe(stock.price);
    expect(analysis.logic).toContain("monitor for confirmation");
  });
});

// ─── analyzeSwingStocks (black box) ──────────────────────────────────────

describe("analyzeSwingStocks", () => {
  it("returns OBSERVE fallbacks when AI is not configured", async () => {
    const results = await analyzeSwingStocks([makeStock()]);
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe("AI is not configured");
    expect(results[0].analysis!.action).toBe("OBSERVE");
    expect(results[0].analysis!.entryPrice).toBe(2500);
    expect(mockedDirectPrompt).not.toHaveBeenCalled();
  });

  it("parses a valid batch into successful results", async () => {
    const stocks = [
      makeStock({ symbol: "RELIANCE" }),
      makeStock({ symbol: "TCS" }),
      makeStock({ symbol: "INFY" }),
    ];
    mockedDirectPrompt.mockResolvedValue(makeAIResponse(stocks));

    const results = await analyzeSwingStocks(stocks, VALID_AI_CONFIG);

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
    expect(results[0].analysis!.action).toBe("LONG");
    expect(results[0].analysis!.targetPrice).toBe(Math.round(2500 * 1.12));
    expect(results[0].analysis!.stopLoss).toBe(Math.round(2500 * 0.94));
    expect(mockedDirectPrompt).toHaveBeenCalledTimes(1);
  });

  it("falls back per-stock when a batch fails after retries", async () => {
    mockedDirectPrompt.mockResolvedValue("AI request failed: 503 Service Unavailable");
    const stocks = [makeStock({ symbol: "RELIANCE" }), makeStock({ symbol: "TCS" })];

    const results = await analyzeSwingStocks(stocks, VALID_AI_CONFIG);

    expect(mockedDirectPrompt).toHaveBeenCalledTimes(2); // RETRY_MAX
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(false);
    expect(results.every((r) => r.analysis!.action === "OBSERVE")).toBe(true);
    expect(results[0].analysis!.entryPrice).toBe(2500);
  });

  it("treats a partial (missing-stock) response as unusable → fallback", async () => {
    const stocks = [makeStock({ symbol: "RELIANCE" }), makeStock({ symbol: "TCS" })];
    mockedDirectPrompt.mockResolvedValue(
      JSON.stringify([
        { symbol: "RELIANCE", action: "LONG", confidence: 70, entryPrice: 2500, targetPrice: 2800, stopLoss: 2350, timeHorizon: "medium", logic: "x", momentumScore: 70, riskFactors: [] },
      ]),
    );

    const results = await analyzeSwingStocks(stocks, VALID_AI_CONFIG);

    expect(results.every((r) => r.success)).toBe(false);
    expect(results[0].analysis!.action).toBe("OBSERVE");
  });

  it("preserves input order with bounded concurrency across many stocks", async () => {
    const stocks = Array.from({ length: 7 }, (_, i) =>
      makeStock({ symbol: `SYM${i}` }),
    );
    mockedDirectPrompt.mockResolvedValue(makeAIResponse(stocks));

    const results = await analyzeSwingStocks(stocks, VALID_AI_CONFIG);

    expect(results.map((r) => r.symbol)).toEqual(stocks.map((s) => s.symbol));
    expect(results.every((r) => r.success)).toBe(true);
    expect(mockedDirectPrompt).toHaveBeenCalledTimes(2); // 7 stocks / batch of 5
  });
});
