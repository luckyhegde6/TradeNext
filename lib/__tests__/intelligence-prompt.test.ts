// lib/__tests__/intelligence-prompt.test.ts — Tests for buildIntelligencePrompt + parseIntelligenceResponse
import {
  buildIntelligencePrompt,
  parseIntelligenceResponse,
} from "@/lib/services/ai/intelligence-prompt";
import type { IntelligenceInput, IntelligenceAnalysis } from "@/lib/services/intelligenceTypes";

// ─── Test Data ───────────────────────────────────────────────────────────────

const sampleInput: IntelligenceInput = {
  symbol: "RELIANCE",
  quote: {
    symbol: "RELIANCE",
    price: 2850,
    change: 45.5,
    percentChange: 1.62,
    pe: 25.3,
    pb: 2.1,
    marketCap: 1930000000000,
    fiftyTwoWeekHigh: 3024,
    fiftyTwoWeekLow: 2220,
    volume: 15000000,
    vwAP: null,
    sector: "Oil & Gas",
    industry: "Refineries",
    faceValue: 10,
    bookValue: null,
    eps: null,
    dividendYield: null,
  },
  technicals: {
    currentTrend: "UPTREND",
    sma20: 2800,
    sma50: 2750,
    sma200: null,
    ema12: 2810,
    ema26: 2780,
    rsi14: 62.5,
    macdLine: 15.3,
    macdSignal: 12.1,
    macdHistogram: 3.2,
    bollingerUpper: 2900,
    bollingerMiddle: 2800,
    bollingerLower: 2700,
    atr14: 45.2,
    support: 2750,
    resistance: 2900,
    trendStrength: "Bullish",
    indicatorSummary: "RSI 62.5 | SMA20 ₹2800 | SMA50 ₹2750",
  },
  valuation: {
    pe: 25.3,
    pb: 2.1,
    evEbitda: 17.7,
    peg: null,
    dividendYield: null,
    sectorMedianPe: 20,
    relativeValue: "Overvalued",
    valuationAssessment: "Premium to sector average",
  },
  fundamentals: {
    creditRating: null,
    interestCoverage: null,
    debtToEquity: 0.35,
    roce: 9.8,
    roe: 8.2,
    netWorth: null,
    totalDebt: null,
    quarterlyResults: [
      { period: "Q4 FY26", revenue: 240000, profit: 18000, eps: 26.5 },
      { period: "Q3 FY26", revenue: 225000, profit: 16500, eps: 24.3 },
    ],
    profitTrend: "Growing",
    revenueTrend: "Growing",
    workingCapitalTrend: "Stable",
  },
  shareholding: null,
  corporate: {
    recentActions: [
      { type: "dividend", date: "15-07-2026", details: "Final Dividend ₹10" },
    ],
    upcomingEvents: [],
    keyAnnouncements: [{ title: "Q4 Results", date: "20-07-2026", category: "results" }],
    governanceSignals: [],
  },
  news: null,
  peers: null,
};

// ─── buildIntelligencePrompt Tests ───────────────────────────────────────────

describe("buildIntelligencePrompt", () => {
  it("includes the stock symbol", () => {
    const prompt = buildIntelligencePrompt(sampleInput);
    expect(prompt).toContain("RELIANCE");
  });

  it("includes market data when quote is present", () => {
    const prompt = buildIntelligencePrompt(sampleInput);
    expect(prompt).toContain("₹2850");
    expect(prompt).toContain("P/E: 25.3");
    expect(prompt).toContain("Market Cap");
  });

  it("includes technical analysis when present", () => {
    const prompt = buildIntelligencePrompt(sampleInput);
    expect(prompt).toContain("UPTREND");
    expect(prompt).toContain("RSI(14): 62.5");
    expect(prompt).toContain("Support");
  });

  it("includes valuation when present", () => {
    const prompt = buildIntelligencePrompt(sampleInput);
    expect(prompt).toContain("Valuation");
    expect(prompt).toContain("Overvalued");
  });

  it("includes fundamentals when present", () => {
    const prompt = buildIntelligencePrompt(sampleInput);
    expect(prompt).toContain("Fundamentals");
    expect(prompt).toContain("ROCE: 9.8");
    expect(prompt).toContain("Q4 FY26");
  });

  it("includes corporate actions when present", () => {
    const prompt = buildIntelligencePrompt(sampleInput);
    expect(prompt).toContain("Corporate Actions");
    expect(prompt).toContain("Final Dividend ₹10");
  });

  it("handles null data gracefully", () => {
    const minimalInput: IntelligenceInput = {
      symbol: "TEST",
      quote: null,
      technicals: null,
      valuation: null,
      fundamentals: null,
      shareholding: null,
      corporate: null,
      news: null,
      peers: null,
    };
    const prompt = buildIntelligencePrompt(minimalInput);
    expect(prompt).toContain("TEST");
    expect(prompt).toContain("JSON");
    // Should not crash
  });

  it("requests JSON output format", () => {
    const prompt = buildIntelligencePrompt(sampleInput);
    expect(prompt).toContain("JSON");
    expect(prompt).toContain("verdict");
    expect(prompt).toContain("BUY");
    expect(prompt).toContain("HOLD");
    expect(prompt).toContain("SELL");
  });
});

// ─── parseIntelligenceResponse Tests ─────────────────────────────────────────

describe("parseIntelligenceResponse", () => {
  const validAnalysis: IntelligenceAnalysis = {
    verdict: "BUY",
    confidence: 75,
    fairValue: { low: 2700, mid: 2900, high: 3100 },
    technicalAnalysis: { trend: "Uptrend", support: 2750, resistance: 2900, indicators: "RSI 62" },
    fundamentalAnalysis: { strengths: ["Strong cash flow"], weaknesses: ["High debt"] },
    valuationAssessment: { assessment: "Fairly valued", relativeValue: "In line with peers" },
    newsCatalysts: { positive: ["New refinery"], negative: [], neutral: [] },
    shareholdingTrend: { summary: "FII increasing" },
    riskFactors: ["Oil price volatility"],
    catalysts: ["Jio IPO"],
    scenarioAnalysis: { bull: "3200", base: "2900", bear: "2500" },
    summary: "Reliance is well-positioned for growth.",
  };

  it("parses valid JSON response", () => {
    const raw = JSON.stringify(validAnalysis);
    const result = parseIntelligenceResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe("BUY");
    expect(result!.confidence).toBe(75);
  });

  it("extracts JSON from markdown fences", () => {
    const raw = "```json\n" + JSON.stringify(validAnalysis) + "\n```";
    const result = parseIntelligenceResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe("BUY");
  });

  it("extracts JSON from mixed text", () => {
    const raw = "Here is the analysis:\n" + JSON.stringify(validAnalysis) + "\nLet me know if you need more.";
    const result = parseIntelligenceResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe("BUY");
  });

  it("returns null on empty input", () => {
    expect(parseIntelligenceResponse("")).toBeNull();
    expect(parseIntelligenceResponse("   ")).toBeNull();
  });

  it("returns null on garbage input", () => {
    expect(parseIntelligenceResponse("This is not JSON at all")).toBeNull();
  });

  it("returns null on invalid JSON", () => {
    expect(parseIntelligenceResponse("{invalid json}")).toBeNull();
  });

  it("normalizes verdict variants", () => {
    const buy = { ...validAnalysis, verdict: "STRONG_BUY" };
    const result = parseIntelligenceResponse(JSON.stringify(buy));
    expect(result!.verdict).toBe("BUY");

    const sell = { ...validAnalysis, verdict: "STRONG_SELL" };
    const result2 = parseIntelligenceResponse(JSON.stringify(sell));
    expect(result2!.verdict).toBe("SELL");
  });

  it("clamps confidence to 0-100", () => {
    const high = { ...validAnalysis, confidence: 150 };
    const result = parseIntelligenceResponse(JSON.stringify(high));
    expect(result!.confidence).toBe(100);

    const low = { ...validAnalysis, confidence: -10 };
    const result2 = parseIntelligenceResponse(JSON.stringify(low));
    expect(result2!.confidence).toBe(0);
  });

  it("fills missing fields with defaults", () => {
    const partial = { verdict: "HOLD", confidence: 50 };
    const result = parseIntelligenceResponse(JSON.stringify(partial));
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe("HOLD");
    expect(result!.fairValue).toEqual({ low: 0, mid: 0, high: 0 });
    expect(result!.riskFactors).toEqual([]);
    expect(result!.summary).toBe("");
  });

  it("handles null values in response", () => {
    const withNulls = { ...validAnalysis, technicalAnalysis: { ...validAnalysis.technicalAnalysis, support: null, resistance: null } };
    const result = parseIntelligenceResponse(JSON.stringify(withNulls));
    expect(result).not.toBeNull();
    expect(result!.technicalAnalysis.support).toBeNull();
  });
});
