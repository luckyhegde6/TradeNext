// lib/__tests__/intelligence.test.ts — Tests for getInvestmentIntelligence orchestrator
import { getInvestmentIntelligence } from "@/lib/services/ai/intelligence";
import { getIntelligenceFromCache, setIntelligenceCache, resetIntelligenceCacheForTests } from "@/lib/services/intelligence/cache";
import { directPrompt, isQuotaExhausted } from "@/lib/services/ai/llm-provider";
import * as adapters from "@/lib/services/intelligence/adapters";
import { createAuditLog } from "@/lib/audit";
import type { IntelligenceReport } from "@/lib/services/intelligenceTypes";

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock("@/lib/services/ai/llm-provider", () => ({
  directPrompt: jest.fn(),
  isQuotaExhausted: jest.fn(),
  QUOTA_EXHAUSTED_MESSAGE: "AI credits exhausted — try after 6 hours or wait for the daily reset.",
}));

jest.mock("@/lib/services/intelligence/adapters", () => ({
  fetchQuoteData: jest.fn(),
  fetchTechnicalsData: jest.fn(),
  fetchValuationData: jest.fn(),
  fetchFundamentalsData: jest.fn(),
  fetchShareholdingData: jest.fn(),
  fetchCorporateData: jest.fn(),
  fetchNewsData: jest.fn(),
  fetchPeersData: jest.fn(),
}));

jest.mock("@/lib/audit", () => ({
  createAuditLog: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/lib/services/ai/config", () => ({
  getDefaultConfig: jest.fn().mockReturnValue({
    model: "test-model",
    apiKey: "test-key",
    temperature: 0.3,
    maxTokens: 8192,
    enabled: true,
  }),
}));

const mockDirectPrompt = jest.mocked(directPrompt);
const mockIsQuotaExhausted = jest.mocked(isQuotaExhausted);
const mockFetchQuote = jest.mocked(adapters.fetchQuoteData);
const mockFetchTechnicals = jest.mocked(adapters.fetchTechnicalsData);
const mockFetchValuation = jest.mocked(adapters.fetchValuationData);
const mockFetchFundamentals = jest.mocked(adapters.fetchFundamentalsData);
const mockFetchShareholding = jest.mocked(adapters.fetchShareholdingData);
const mockFetchCorporate = jest.mocked(adapters.fetchCorporateData);
const mockFetchNews = jest.mocked(adapters.fetchNewsData);
const mockFetchPeers = jest.mocked(adapters.fetchPeersData);
const mockAuditLog = jest.mocked(createAuditLog);

// ─── Test Data ───────────────────────────────────────────────────────────────

const validAiResponse = JSON.stringify({
  verdict: "BUY",
  confidence: 75,
  fairValue: { low: 2700, mid: 2900, high: 3100 },
  technicalAnalysis: { trend: "Uptrend", support: 2750, resistance: 2900, indicators: "RSI 62" },
  fundamentalAnalysis: { strengths: ["Strong cash flow"], weaknesses: [] },
  valuationAssessment: { assessment: "Fairly valued", relativeValue: "In line" },
  newsCatalysts: { positive: [], negative: [], neutral: [] },
  shareholdingTrend: { summary: "" },
  riskFactors: [],
  catalysts: [],
  scenarioAnalysis: { bull: "", base: "", bear: "" },
  summary: "Reliance is well-positioned.",
});

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(async () => {
  resetIntelligenceCacheForTests();
  // Also clear DB entries from prior tests
  try {
    const { default: prisma } = await import("@/lib/prisma");
    await prisma.intelligenceCache.deleteMany({});
  } catch { /* ignore */ }
  jest.clearAllMocks();

  // Default: adapters return data
  mockFetchQuote.mockResolvedValue({
    symbol: "RELIANCE", price: 2850, change: 45.5, percentChange: 1.62,
    pe: 25.3, pb: null, marketCap: 1930000000000, fiftyTwoWeekHigh: 3024,
    fiftyTwoWeekLow: 2220, volume: 15000000, vwAP: null, sector: "Oil & Gas",
    industry: "Refineries", faceValue: null, bookValue: null, eps: null, dividendYield: null,
  });
  mockFetchTechnicals.mockResolvedValue(null);
  mockFetchValuation.mockResolvedValue(null);
  mockFetchFundamentals.mockResolvedValue(null);
  mockFetchShareholding.mockResolvedValue(null);
  mockFetchCorporate.mockResolvedValue(null);
  mockFetchNews.mockResolvedValue(null);
  mockFetchPeers.mockResolvedValue(null);

  mockIsQuotaExhausted.mockReturnValue(false);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("getInvestmentIntelligence", () => {
  it("returns cached result on cache hit", async () => {
    // Pre-populate cache
    await setIntelligenceCache("RELIANCE", {
      symbol: "RELIANCE",
      analysis: { verdict: "BUY", confidence: 75, fairValue: { low: 0, mid: 0, high: 0 }, technicalAnalysis: { trend: "", support: null, resistance: null, indicators: "" }, fundamentalAnalysis: { strengths: [], weaknesses: [] }, valuationAssessment: { assessment: "", relativeValue: "" }, newsCatalysts: { positive: [], negative: [], neutral: [] }, shareholdingTrend: { summary: "" }, riskFactors: [], catalysts: [], scenarioAnalysis: { bull: "", base: "", bear: "" }, summary: "" },
      dataUsed: { symbol: "RELIANCE", quote: null, technicals: null, valuation: null, fundamentals: null, shareholding: null, corporate: null, news: null, peers: null },
      modelUsed: "test-model",
      generatedAt: new Date().toISOString(),
      version: 1,
      isCacheHit: false,
    }, "test-model");

    const result = await getInvestmentIntelligence("RELIANCE");
    expect(result.status).toBe("cached");
    expect(result.report).not.toBeNull();
    expect(result.report!.isCacheHit).toBe(true);

    // Should NOT call adapters or AI
    expect(mockFetchQuote).not.toHaveBeenCalled();
    expect(mockDirectPrompt).not.toHaveBeenCalled();
  });

  it("force=1 bypasses cache", async () => {
    // Pre-populate cache
    await setIntelligenceCache("RELIANCE", {
      symbol: "RELIANCE",
      analysis: { verdict: "BUY", confidence: 75, fairValue: { low: 0, mid: 0, high: 0 }, technicalAnalysis: { trend: "", support: null, resistance: null, indicators: "" }, fundamentalAnalysis: { strengths: [], weaknesses: [] }, valuationAssessment: { assessment: "", relativeValue: "" }, newsCatalysts: { positive: [], negative: [], neutral: [] }, shareholdingTrend: { summary: "" }, riskFactors: [], catalysts: [], scenarioAnalysis: { bull: "", base: "", bear: "" }, summary: "" },
      dataUsed: { symbol: "RELIANCE", quote: null, technicals: null, valuation: null, fundamentals: null, shareholding: null, corporate: null, news: null, peers: null },
      modelUsed: "test-model",
      generatedAt: new Date().toISOString(),
      version: 1,
      isCacheHit: false,
    }, "test-model");

    mockDirectPrompt.mockResolvedValue(validAiResponse);

    const result = await getInvestmentIntelligence("RELIANCE", { force: true });
    expect(result.status).toBe("generated");
    expect(result.report!.isCacheHit).toBe(false);
    expect(mockDirectPrompt).toHaveBeenCalled();
  });

  it("returns failed when all adapters return null", async () => {
    mockFetchQuote.mockResolvedValue(null);

    const result = await getInvestmentIntelligence("NONEXISTENT");
    expect(result.status).toBe("failed");
    expect(result.error).toContain("No data");
  });

  it("handles quota exhaustion gracefully", async () => {
    mockDirectPrompt.mockResolvedValue("AI credits exhausted");
    mockIsQuotaExhausted.mockReturnValue(true);

    const result = await getInvestmentIntelligence("RELIANCE");
    expect(result.status).toBe("quota_exhausted");
    expect(result.error).toContain("credits");
  });

  it("returns generated result on successful AI call", async () => {
    mockDirectPrompt.mockResolvedValue(validAiResponse);

    const result = await getInvestmentIntelligence("RELIANCE");
    expect(result.status).toBe("generated");
    expect(result.report).not.toBeNull();
    expect(result.report!.analysis.verdict).toBe("BUY");
    expect(result.report!.analysis.confidence).toBe(75);
  });

  it("caches result after generation", async () => {
    mockDirectPrompt.mockResolvedValue(validAiResponse);

    await getInvestmentIntelligence("RELIANCE");

    // Verify cache was populated
    const cached = await getIntelligenceFromCache("RELIANCE");
    expect(cached).not.toBeNull();
  });

  it("logs audit on generation", async () => {
    mockDirectPrompt.mockResolvedValue(validAiResponse);

    await getInvestmentIntelligence("RELIANCE", { userId: 1 });

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "INTELLIGENCE_GENERATED",
        userId: 1,
      })
    );
  });

  it("logs audit on cache hit", async () => {
    await setIntelligenceCache("RELIANCE", {
      symbol: "RELIANCE",
      analysis: { verdict: "BUY", confidence: 75, fairValue: { low: 0, mid: 0, high: 0 }, technicalAnalysis: { trend: "", support: null, resistance: null, indicators: "" }, fundamentalAnalysis: { strengths: [], weaknesses: [] }, valuationAssessment: { assessment: "", relativeValue: "" }, newsCatalysts: { positive: [], negative: [], neutral: [] }, shareholdingTrend: { summary: "" }, riskFactors: [], catalysts: [], scenarioAnalysis: { bull: "", base: "", bear: "" }, summary: "" },
      dataUsed: { symbol: "RELIANCE", quote: null, technicals: null, valuation: null, fundamentals: null, shareholding: null, corporate: null, news: null, peers: null },
      modelUsed: "test-model",
      generatedAt: new Date().toISOString(),
      version: 1,
      isCacheHit: false,
    }, "test-model");

    await getInvestmentIntelligence("RELIANCE", { userId: 2 });

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "INTELLIGENCE_CACHE_HIT",
        userId: 2,
      })
    );
  });

  it("logs audit on failure", async () => {
    mockFetchQuote.mockResolvedValue(null);

    await getInvestmentIntelligence("FAIL", { userId: 3 });

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "INTELLIGENCE_FAILED",
        userId: 3,
      })
    );
  });

  it("handles partial adapter failures gracefully", async () => {
    mockFetchTechnicals.mockRejectedValue(new Error("Network error"));
    mockDirectPrompt.mockResolvedValue(validAiResponse);

    const result = await getInvestmentIntelligence("RELIANCE");
    expect(result.status).toBe("generated");
    expect(result.report).not.toBeNull();
  });

  it("passes supplied documents into the AI prompt", async () => {
    mockDirectPrompt.mockResolvedValue(validAiResponse);

    await getInvestmentIntelligence("RELIANCE", {
      documents: { annualReport: "FY26 annual report…", concall: "Q1 earnings call…" },
    });

    // The full prompt built by buildStockAnalysisPrompt should include the doc text
    const promptArg = mockDirectPrompt.mock.calls[0][0] as string;
    expect(promptArg).toContain("FY26 annual report");
    expect(promptArg).toContain("Q1 earnings call");
  });

  it("audits hasDocuments=true when documents supplied", async () => {
    mockDirectPrompt.mockResolvedValue(validAiResponse);

    await getInvestmentIntelligence("RELIANCE", {
      userId: 5,
      documents: { concall: "concall transcript text" },
    });

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "INTELLIGENCE_GENERATED",
        userId: 5,
        metadata: expect.objectContaining({ hasDocuments: true }),
      })
    );
  });

  it("treats whitespace-only documents as not provided", async () => {
    mockDirectPrompt.mockResolvedValue(validAiResponse);

    await getInvestmentIntelligence("RELIANCE", {
      userId: 6,
      documents: { annualReport: "   ", concall: "" },
    });

    const auditCall = mockAuditLog.mock.calls.find(
      (c) => c[0].action === "INTELLIGENCE_GENERATED" && c[0].userId === 6
    );
    expect(auditCall).toBeDefined();
    expect((auditCall![0].metadata as Record<string, unknown>).hasDocuments).toBe(false);
  });
});
