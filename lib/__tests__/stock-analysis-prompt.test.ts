// lib/__tests__/stock-analysis-prompt.test.ts — Tests for the new equity-research
// decision engine: buildStockAnalysisPrompt + parseStockAnalysisResponse.
import {
  buildStockAnalysisPrompt,
  parseStockAnalysisResponse,
} from "@/lib/services/ai/intelligence-prompt";
import type { IntelligenceInput } from "@/lib/services/intelligenceTypes";

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
    sma200: 2600,
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
  shareholding: {
    promoters: 50.2,
    fiis: 21.4,
    diis: 14.3,
    public: 14.1,
    others: 0,
    qoqChanges: { promoters: -0.2, fiis: 0.5, diis: 0.4, public: -0.7 },
    fiiTrend: "Increasing",
    diiTrend: "Increasing",
    promoterPledge: 0,
  },
  corporate: {
    recentActions: [{ type: "dividend", date: "15-07-2026", details: "Final Dividend ₹10" }],
    upcomingEvents: [],
    keyAnnouncements: [{ title: "Q4 Results", date: "20-07-2026", category: "results" }],
    governanceSignals: [],
  },
  news: null,
  peers: null,
};

// ─── buildStockAnalysisPrompt Tests ──────────────────────────────────────────

describe("buildStockAnalysisPrompt", () => {
  it("includes the stock symbol and role framing", () => {
    const prompt = buildStockAnalysisPrompt(sampleInput);
    expect(prompt).toContain("RELIANCE");
    expect(prompt).toContain("equity research analyst");
  });

  it("asks for the full 8-level verdict set", () => {
    const prompt = buildStockAnalysisPrompt(sampleInput);
    expect(prompt).toContain("STRONG_BUY");
    expect(prompt).toContain("ACCUMULATE");
    expect(prompt).toContain("REDUCE");
    expect(prompt).toContain("AVOID");
  });

  it("asks for conviction /10 and confidence /100", () => {
    const prompt = buildStockAnalysisPrompt(sampleInput);
    expect(prompt).toContain("conviction");
    expect(prompt).toContain("0-10");
    expect(prompt).toContain("confidence");
    expect(prompt).toContain("0-100");
  });

  it("includes shareholding data when present", () => {
    const prompt = buildStockAnalysisPrompt(sampleInput);
    expect(prompt).toContain("Shareholding Pattern");
    expect(prompt).toContain("Promoters: 50.2%");
  });

  it("includes documents when provided (annual report + concall)", () => {
    const prompt = buildStockAnalysisPrompt(sampleInput, {
      annualReport: "FY26 annual report narrative…",
      concall: "Q1 FY27 earnings call transcript…",
    });
    expect(prompt).toContain("User-Supplied Documents");
    expect(prompt).toContain("FY26 annual report narrative");
    expect(prompt).toContain("Q1 FY27 earnings call transcript");
  });

  it("includes only the provided document type", () => {
    const prompt = buildStockAnalysisPrompt(sampleInput, { concall: "concall text only" });
    expect(prompt).toContain("concall text only");
    expect(prompt).not.toContain("Annual Report (paste)");
  });

  it("omits the documents section when none provided", () => {
    const prompt = buildStockAnalysisPrompt(sampleInput);
    expect(prompt).not.toContain("User-Supplied Documents");
  });

  it("handles minimal null input without crashing", () => {
    const minimal: IntelligenceInput = {
      symbol: "TEST", quote: null, technicals: null, valuation: null,
      fundamentals: null, shareholding: null, corporate: null, news: null, peers: null,
    };
    const prompt = buildStockAnalysisPrompt(minimal);
    expect(prompt).toContain("TEST");
    expect(prompt).toContain("dataGaps");
  });
});

// ─── parseStockAnalysisResponse Tests ────────────────────────────────────────

const fullResponse = {
  verdict: "STRONG_BUY",
  conviction: 9,
  confidence: 90,
  fairValue: { low: 2700, mid: 2900, high: 3100 },
  valuationZones: {
    attractiveLow: 2400, attractiveHigh: 2550,
    fairLow: 2550, fairHigh: 2950,
    overLow: 2950, overHigh: 3200,
    assumptions: ["12% DCF growth", "margin recovery"],
  },
  executiveSummary: { oneSentenceThesis: "Leading refiner with optionality", threeBiggestReasons: ["Dominance", "FCF", "Moat"] },
  fundamentalScore: {
    score: 8, revenue: "growing", profit: "growing", margins: "stable",
    cashFlow: "positive", balanceSheet: "healthy", roe: "12%", accountingQuality: "good",
    verdict: "Strong fundamentals",
    evidence: [{ label: "CALCULATED_METRIC", text: "ROE 12%", period: "FY26", source: "NSE" }],
  },
  managementDna: {
    score: 7, positives: ["Proven execution"], concerns: ["Succession"],
    guidanceCredibility: "reliable", capitalAllocation: "disciplined",
    promoterBehavior: "low pledge", verdict: "Competent management",
  },
  valuationReality: { current: "expensive", historical: "at premium", peer: "above peers", growthAdjusted: "fair", conclusion: "FAIRLY VALUED" },
  technicalStructure: { trend: "uptrend", priceVs50: "above", priceVs200: "above", rsi: "62", volume: "rising", support: 2750, resistance: 2900, marketPhase: "MARKUP", verdict: "Healthy structure" },
  shareholdingAnalysis: { promoter: "50%", promoterPledge: "none", fii: "rising", dii: "steady", interpretation: "Smart money accumulating" },
  riskFactors: [{
    risk: "Oil price volatility", category: "MACRO", probability: "medium",
    impact: "high", earlyWarning: "Crude rally", pricedIn: true,
  }],
  catalysts: ["Jio IPO", "Retail demerger"],
  scenarioAnalysis: { bull: "3200", base: "2900", bear: "2500" },
  contrarian: { marketBelief: "Market sees slower growth", whatIfWrong: "Growth surprises up", supporting: ["FCF"], contradicting: ["Capex"] },
  whatWouldChangeMyMind: ["Margin compression below 8%"],
  portfolioAction: { existingHolder: "hold", newInvestor: "add gradually", positionSizing: "CORE" },
  invalidation: { thesisInvalidation: "demand collapse", entryZone: "2400-2550", fairZone: "2550-2950", overZone: ">2950", holdingHorizon: "3-5 years" },
  dataGaps: ["p/b ratio", "segment margin breakdown"],
  summary: "Full thesis summary",
};

describe("parseStockAnalysisResponse (new engine)", () => {
  it("parses the full 8-level verdict with conviction", () => {
    const result = parseStockAnalysisResponse(JSON.stringify(fullResponse));
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe("STRONG_BUY");
    expect(result!.conviction).toBe(9);
    expect(result!.confidence).toBe(90);
  });

  it("parses all new framework fields", () => {
    const r = parseStockAnalysisResponse(JSON.stringify(fullResponse))!;
    expect(r.valuationZones!.attractiveLow).toBe(2400);
    expect(r.executiveSummary!.oneSentenceThesis).toContain("refiner");
    expect(r.fundamentalScore!.score).toBe(8);
    expect(r.managementDna!.score).toBe(7);
    expect(r.technicalStructure!.marketPhase).toBe("MARKUP");
    expect(r.riskFactors[0].category).toBe("MACRO");
    expect(r.riskFactors[0].pricedIn).toBe(true);
    expect(r.contrarian!.marketBelief).toContain("slower growth");
    expect(r.portfolioAction!.positionSizing).toBe("CORE");
    expect(r.dataGaps!.length).toBe(2);
  });

  it("derives confidence from conviction when confidence missing", () => {
    const r = parseStockAnalysisResponse(JSON.stringify({ ...fullResponse, confidence: undefined }))!;
    expect(r.confidence).toBe(90); // conviction 9 * 10
  });

  it("maps legacy 3-verdict input onto the 8-level enum (BUY)", () => {
    const legacy = { verdict: "BUY", confidence: 80, fairValue: { low: 1, mid: 2, high: 3 }, scenarioAnalysis: { bull: "b", base: "a", bear: "c" } };
    const r = parseStockAnalysisResponse(JSON.stringify(legacy))!;
    expect(r.verdict).toBe("BUY");
    expect(r.conviction).toBe(7); // default from verdict
    expect(r.confidence).toBe(80);
  });

  it("keeps HOLD as HOLD and SELL as SELL for legacy input", () => {
    expect(parseStockAnalysisResponse(JSON.stringify({ verdict: "HOLD" }))!.verdict).toBe("HOLD");
    expect(parseStockAnalysisResponse(JSON.stringify({ verdict: "SELL" }))!.verdict).toBe("SELL");
  });

  it("keeps neutral verdict default for garbage", () => {
    const r = parseStockAnalysisResponse(JSON.stringify({ verdict: "not-a-verdict", confidence: 40 }));
    expect(r!.verdict).toBe("HOLD");
  });

  it("extracts JSON from markdown fences", () => {
    const raw = "```json\n" + JSON.stringify(fullResponse) + "\n```";
    const r = parseStockAnalysisResponse(raw)!;
    expect(r.verdict).toBe("STRONG_BUY");
  });

  it("extracts JSON from mixed text", () => {
    const raw = "Memo:\n" + JSON.stringify(fullResponse) + "\n— end";
    expect(parseStockAnalysisResponse(raw)!.verdict).toBe("STRONG_BUY");
  });

  it("returns null on empty/garbage/invalid JSON", () => {
    expect(parseStockAnalysisResponse("")).toBeNull();
    expect(parseStockAnalysisResponse("not json")).toBeNull();
    expect(parseStockAnalysisResponse("{bad")).toBeNull();
  });

  it("handles riskFactors given as legacy string array", () => {
    const r = parseStockAnalysisResponse(JSON.stringify({ ...fullResponse, riskFactors: ["Oil vol"] }))!;
    expect(r.riskFactors.length).toBe(1);
    expect(r.riskFactors[0].risk).toBe("Oil vol");
    expect(r.riskFactors[0].category).toBe("COMPANY");
    expect(r.riskFactors[0].pricedIn).toBe(false);
  });

  it("clamps conviction and confidence into range", () => {
    const r = parseStockAnalysisResponse(JSON.stringify({ ...fullResponse, conviction: 99, confidence: -5 }))!;
    expect(r.conviction).toBe(10);
    expect(r.confidence).toBe(0);
  });
});
