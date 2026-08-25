// lib/__tests__/ipoAnalysisService.test.ts
//
// IPO AI analysis service tests: 14-step prompt builder (product rule:
// LOT = 1 share + Minimum Investment line), price-band parsing, verdict/
// recommendation extraction, and the 3-layer cache semantics
// (memory → DB fresh → AI generate+persist → stale-DB fallback).

jest.mock("@/lib/cache", () => {
  const store = new Map<string, { value: unknown; ttl: number; expireAt: number }>();
  return {
    __esModule: true,
    default: {
      get: jest.fn((key: string) => {
        const hit = store.get(key);
        if (!hit) return undefined;
        if (Date.now() > hit.expireAt) {
          store.delete(key);
          return undefined;
        }
        return hit.value;
      }),
      set: jest.fn((key: string, value: unknown, ttl: number) => {
        store.set(key, { value, ttl, expireAt: Date.now() + ttl * 1000 });
        return true;
      }),
      del: jest.fn((key: string) => store.delete(key)),
      flushAll: jest.fn(() => store.clear()),
      keys: jest.fn(() => Array.from(store.keys())),
      has: jest.fn((key: string) => store.has(key)),
    },
  };
});

jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    marketCache: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/services/ai/config", () => ({
  __esModule: true,
  loadConfig: jest.fn(),
  hasValidConfig: jest.fn(),
  getDefaultConfig: jest.fn(() => ({
    model: "test-model",
    apiKey: "test-key",
    temperature: 0.3,
    maxTokens: 2048,
    enabled: true,
  })),
  isValidModel: jest.fn(() => true),
}));

jest.mock("@/lib/services/ai/llm-provider", () => ({
  __esModule: true,
  directPrompt: jest.fn(),
  getPromptTimeoutMs: jest.fn(() => 120_000),
  isQuotaExhausted: jest.fn(() => false),
  QUOTA_EXHAUSTED_MESSAGE: "AI credits exhausted — try after 6 hours or wait for the daily reset.",
}));

jest.mock("@/lib/services/ai/ai-monitoring", () => ({
  __esModule: true,
  trackAiCall: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/services/nseIpoService", () => ({
  __esModule: true,
  getUpcomingIpoIssues: jest.fn(),
}));

jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("@/lib/audit", () => ({
  __esModule: true,
  createAuditLog: jest.fn().mockResolvedValue(undefined),
}));

// ─── Imports ──────────────────────────────────────────────────────────────

import cache from "@/lib/cache";
import prisma from "@/lib/prisma";
import {
  parsePriceBand,
  minimumInvestmentLabel,
  buildIpoAnalysisPrompt,
  extractVerdict,
  extractRecommendation,
  getIpoAnalysis,
  cleanStaleIpoAnalysisRows,
  IPO_ANALYSIS_CACHE_TTL_SECONDS,
} from "@/lib/services/ipoAnalysisService";
import {
  loadConfig,
  hasValidConfig,
  type AIConfig,
} from "@/lib/services/ai/config";
import { directPrompt } from "@/lib/services/ai/llm-provider";
import { trackAiCall } from "@/lib/services/ai/ai-monitoring";
import { getUpcomingIpoIssues } from "@/lib/services/nseIpoService";
import { createAuditLog } from "@/lib/audit";

// ─── Helpers ──────────────────────────────────────────────────────────────

const VALID_CONFIG: AIConfig = {
  model: "test-model",
  apiKey: "test-key",
  temperature: 0.3,
  maxTokens: 2048,
  enabled: true,
};

const SHIPROCKET: any = {
  symbol: "SHIPROCKET",
  companyName: "Shiprocket Logistics Ltd",
  series: null,
  status: "Active",
  issueStartDate: "12-Aug-2026",
  issueEndDate: "14-Aug-2026",
  issuePrice: "Rs.92 to Rs.97",
  issueSize: "₹485.00 Cr",
};

const SAMPLE_CONTENT = `# Shiprocket — 14-step analysis

## STEP 2 - Financial Analysis
Revenue growing at 25% CAGR over last 3 years.

Investment Verdict: **SELL 50% AND HOLD 50%** — listing premium looks priced in.
Top 3 reasons: (1) rich valuation, (2) strong growth, (3) positive cash flow.`;

beforeEach(() => {
  jest.clearAllMocks();
  (cache as any).flushAll();
  (loadConfig as jest.Mock).mockResolvedValue(VALID_CONFIG);
  (hasValidConfig as jest.Mock).mockReturnValue(true);
  (getUpcomingIpoIssues as jest.Mock).mockResolvedValue({ data: [SHIPROCKET], source: "cache" });
  (directPrompt as jest.Mock).mockResolvedValue(SAMPLE_CONTENT);
  (prisma.marketCache.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.marketCache.upsert as jest.Mock).mockResolvedValue({ cacheKey: "ipo_analysis_SHIPROCKET" });
});

// ─── Pure helpers ─────────────────────────────────────────────────────────

describe("parsePriceBand", () => {
  test("parses 'Rs.92 to Rs.97' into [92, 97]", () => {
    expect(parsePriceBand("Rs.92 to Rs.97")).toEqual([92, 97]);
  });

  test("parses a single price with commas", () => {
    expect(parsePriceBand("Rs.1,200")).toEqual([1200]);
  });

  test("returns [] for empty / undefined input", () => {
    expect(parsePriceBand("")).toEqual([]);
    expect(parsePriceBand(undefined)).toEqual([]);
    expect(parsePriceBand(null)).toEqual([]);
  });
});

describe("minimumInvestmentLabel", () => {
  test("uses price band lower end × LOT SIZE = 1 share", () => {
    const label = minimumInvestmentLabel(SHIPROCKET);
    expect(label).toBe("₹92 (1 lot × price band low ₹92)");
  });

  test("falls back to priceBand field when issuePrice missing", () => {
    expect(
      minimumInvestmentLabel({ ...SHIPROCKET, issuePrice: undefined, priceBand: "Rs.200 to Rs.210" })
    ).toBe("₹200 (1 lot × price band low ₹200)");
  });

  test("returns 'Not yet announced' when no price", () => {
    expect(minimumInvestmentLabel({ ...SHIPROCKET, issuePrice: undefined, priceBand: undefined })).toBe(
      "Not yet announced"
    );
  });
});

describe("buildIpoAnalysisPrompt", () => {
  test("includes all 14 steps", () => {
    const prompt = buildIpoAnalysisPrompt(SHIPROCKET);
    for (let i = 1; i <= 14; i++) {
      expect(prompt).toContain(`STEP ${i} -`);
    }
  });

  test("fills the INPUT block with name, price, LOT=1 share and Minimum Investment", () => {
    const prompt = buildIpoAnalysisPrompt(SHIPROCKET);
    expect(prompt).toContain("Shiprocket Logistics Ltd");
    expect(prompt).toContain("Rs.92 to Rs.97");
    expect(prompt).toContain("Quantity:");
    expect(prompt).toContain("1 lot (1 share)");
    expect(prompt).toContain("Minimum Investment (for ROI calculations):");
    expect(prompt).toContain("₹92 (1 lot × price band low ₹92)");
    expect(prompt).toContain("14-Aug-2026");
  });

  test("ends with the Investment Verdict rule", () => {
    const prompt = buildIpoAnalysisPrompt(SHIPROCKET);
    expect(prompt.trim().endsWith('concise "Investment Verdict" section that states the recommended action and the top three reasons supporting it.')).toBe(true);
  });
});

describe("extractVerdict", () => {
  test("returns the block after 'Investment Verdict'", () => {
    const verdict = extractVerdict(SAMPLE_CONTENT);
    expect(verdict).toContain("SELL 50% AND HOLD 50%");
    expect(verdict).not.toContain("STEP 2");
  });

  test("falls back to last 600 chars when no verdict header", () => {
    const content = "no verdict marker here";
    const verdict = extractVerdict(content);
    expect(verdict).toBe(content);
  });
});

describe("extractRecommendation", () => {
  test("picks the matching A/B/C/D option regardless of case", () => {
    expect(extractRecommendation(SAMPLE_CONTENT)).toBe("SELL 50% AND HOLD 50%");
    expect(extractRecommendation("**SELL 100% ON LISTING DAY**")).toBe("SELL 100% ON LISTING DAY");
    expect(extractRecommendation("STRONG LONG-TERM HOLD (3-5+ YEARS)")).toBe(
      "STRONG LONG-TERM HOLD (3-5+ YEARS)"
    );
  });

  test("falls back to the last A)/B)/C)/D) fragment when no exact option text", () => {
    expect(extractRecommendation("A) BUY ON DIP\nB) BUY ONLY ON DIP")).toBe("B) BUY ONLY ON DIP");
  });

  test("returns empty when nothing matches", () => {
    expect(extractRecommendation("no recommendation")).toBe("");
  });
});

// ─── Cache semantics ──────────────────────────────────────────────────────

describe("getIpoAnalysis cache semantics", () => {
  test("serves from memory when fresh (no AI call, no DB write)", async () => {
    (cache as any).set(
      "ipo_analysis_SHIPROCKET",
      {
        symbol: "SHIPROCKET",
        companyName: "Shiprocket Logistics Ltd",
        content: SAMPLE_CONTENT,
        verdict: "SELL 50% AND HOLD 50%",
        recommendation: "SELL 50% AND HOLD 50%",
        generatedAt: new Date().toISOString(),
      },
      IPO_ANALYSIS_CACHE_TTL_SECONDS
    );

    const result = await getIpoAnalysis("SHIPROCKET");
    expect(result.source).toBe("cache");
    expect(directPrompt).not.toHaveBeenCalled();
    expect(prisma.marketCache.findUnique).not.toHaveBeenCalled();
    expect(prisma.marketCache.upsert).not.toHaveBeenCalled();
  });

  test("serves from a fresh DB row (populates memory) without AI call", async () => {
    (prisma.marketCache.findUnique as jest.Mock).mockResolvedValue({
      cacheKey: "ipo_analysis_SHIPROCKET",
      dataType: "ipo_analysis",
      data: {
        symbol: "SHIPROCKET",
        companyName: "Shiprocket Logistics Ltd",
        content: SAMPLE_CONTENT,
        verdict: "SELL 50% AND HOLD 50%",
        recommendation: "SELL 50% AND HOLD 50%",
        generatedAt: new Date().toISOString(),
      },
      recordCount: 1,
      lastSyncedAt: new Date(),
      nextSyncAt: new Date(Date.now() + IPO_ANALYSIS_CACHE_TTL_SECONDS * 1000),
    });

    const result = await getIpoAnalysis("SHIPROCKET");
    expect(result.source).toBe("cache");
    expect(result.cachedAt).toBeTruthy();
    expect(directPrompt).not.toHaveBeenCalled();
    expect(prisma.marketCache.upsert).not.toHaveBeenCalled();

    // Second call short-circuits through memory now.
    const second = await getIpoAnalysis("SHIPROCKET");
    expect(second.source).toBe("cache");
  });

  test("generates via AI when nothing cached and persists + returns source 'ai'", async () => {
    const result = await getIpoAnalysis("SHIPROCKET");

    expect(directPrompt).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("ai");
    expect(result.content).toBe(SAMPLE_CONTENT);
    expect(result.verdict).toContain("SELL 50% AND HOLD 50%");
    expect(result.recommendation).toBe("SELL 50% AND HOLD 50%");
    expect(prisma.marketCache.upsert).toHaveBeenCalledTimes(1);
    const upsertArg = (prisma.marketCache.upsert as jest.Mock).mock.calls[0][0];
    expect(upsertArg.where.cacheKey).toBe("ipo_analysis_SHIPROCKET");
    expect(upsertArg.create.dataType).toBe("ipo_analysis");
    expect(upsertArg.create.cacheKey).toBe("ipo_analysis_SHIPROCKET");
    expect(upsertArg.create.marketStatus).toBe("closed");
  });

  test("a second user's analyze click reuses the persisted row (shares the cache)", async () => {
    // First call generates and persists.
    await getIpoAnalysis("SHIPROCKET");
    expect(directPrompt).toHaveBeenCalledTimes(1);

    // Simulate a different process (fresh memory) with the DB row present.
    (cache as any).flushAll();
    (prisma.marketCache.findUnique as jest.Mock).mockResolvedValue({
      cacheKey: "ipo_analysis_SHIPROCKET",
      dataType: "ipo_analysis",
      data: {
        symbol: "SHIPROCKET",
        companyName: "Shiprocket Logistics Ltd",
        content: SAMPLE_CONTENT,
        verdict: "SELL 50% AND HOLD 50%",
        recommendation: "SELL 50% AND HOLD 50%",
        generatedAt: new Date().toISOString(),
      },
      recordCount: 1,
      lastSyncedAt: new Date(),
      nextSyncAt: new Date(Date.now() + IPO_ANALYSIS_CACHE_TTL_SECONDS * 1000),
    });

    const second = await getIpoAnalysis("SHIPROCKET");
    expect(second.source).toBe("cache");
    expect(directPrompt).toHaveBeenCalledTimes(1); // still only one AI call
    expect(prisma.marketCache.upsert).toHaveBeenCalledTimes(1); // only first generation persisted
  });

  test("forceRefresh regenerates even when a fresh row exists", async () => {
    (prisma.marketCache.findUnique as jest.Mock).mockResolvedValue({
      cacheKey: "ipo_analysis_SHIPROCKET",
      dataType: "ipo_analysis",
      data: { symbol: "SHIPROCKET", companyName: "Shiprocket Logistics Ltd", content: SAMPLE_CONTENT, verdict: "", recommendation: "", generatedAt: new Date().toISOString() },
      recordCount: 1,
      lastSyncedAt: new Date(),
      nextSyncAt: new Date(Date.now() + IPO_ANALYSIS_CACHE_TTL_SECONDS * 1000),
    });

    const result = await getIpoAnalysis("SHIPROCKET", { forceRefresh: true });
    expect(result.source).toBe("ai");
    expect(directPrompt).toHaveBeenCalledTimes(1);
  });

  test("throws 'AI is not configured' when config invalid", async () => {
    (hasValidConfig as jest.Mock).mockReturnValue(false);
    await expect(getIpoAnalysis("SHIPROCKET")).rejects.toThrow("AI is not configured");
    expect(directPrompt).not.toHaveBeenCalled();
  });

  test("throws when the IPO symbol is unknown", async () => {
    (getUpcomingIpoIssues as jest.Mock).mockResolvedValue({ data: [SHIPROCKET], source: "cache" });
    await expect(getIpoAnalysis("MISSING")).rejects.toThrow("IPO issue not found for symbol MISSING");
  });

  test("throws when directPrompt returns a not-configured/failure sentinel", async () => {
    (directPrompt as jest.Mock).mockResolvedValue("AI request failed: 404 model not found");
    await expect(getIpoAnalysis("SHIPROCKET")).rejects.toThrow("AI analysis failed");
    // v3.11.0: the failure is audit-logged with the real reason so admin
    // monitoring shows why IPO analysis keeps failing.
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "IPO_ANALYSIS_FAILED",
        resource: "ipo_analysis",
        resourceId: "SHIPROCKET",
      }),
    );
  });

  test("serves stale DB row (source 'db') when generation fails", async () => {
    (prisma.marketCache.findUnique as jest.Mock).mockResolvedValue({
      cacheKey: "ipo_analysis_SHIPROCKET",
      dataType: "ipo_analysis",
      data: {
        symbol: "SHIPROCKET",
        companyName: "Shiprocket Logistics Ltd",
        content: SAMPLE_CONTENT,
        verdict: "SELL 50% AND HOLD 50%",
        recommendation: "SELL 50% AND HOLD 50%",
        generatedAt: "2026-08-01T00:00:00.000Z",
      },
      recordCount: 1,
      lastSyncedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days old
      nextSyncAt: new Date(),
    });
    (directPrompt as jest.Mock).mockRejectedValue(new Error("model down"));

    const result = await getIpoAnalysis("SHIPROCKET");
    expect(result.source).toBe("db");
    expect(result.content).toBe(SAMPLE_CONTENT);
  });

  // ─── v2 JSON report architecture ─────────────────────────────────────────

  const JSON_REPORT = {
    company: { name: "Shiprocket Logistics Ltd", symbol: "SHIPROCKET", sector: "Logistics" },
    summaryScores: [{ label: "Business Quality", value: 82, tone: "green" }],
    verdict: {
      label: "PARTIAL PROFIT BOOKING",
      headline: "Listing premium priced in.",
      reasons: ["Rich valuation", "Strong growth"],
      confidencePct: 78,
    },
    quickSnapshots: [],
    businessOverview: "A logistics tech company.",
    financials: { rating: "Good", summary: "", rows: [] },
    ipoDetails: [],
    gmp: { value: "₹90", estimatedListingPrice: "₹182", expectedGainPct: 12.5, trend: "Increasing", healthNote: "" },
    news: [],
    sentiment: { summary: "", bullish: [], bearish: [], hypeDriven: false },
    peers: { valuation: "Overvalued", summary: "", rows: [] },
    futureGrowth: { summary: "", roadmap: [], oneYear: "", threeYear: "", fiveYear: "" },
    risks: [],
    listingStrategy: { summary: "", scenarios: [] },
    targets: [],
    finalScore: { outOf10: { "Business Quality": 8 }, total: 66 },
    finalRecommendation: "Book partial profits, hold the rest.",
    disclaimer: "Informational only.",
  };

  test("v2: parses the structured JSON report into the result when the model returns JSON", async () => {
    (directPrompt as jest.Mock).mockResolvedValue(
      "```json\n" + JSON.stringify(JSON_REPORT) + "\n```"
    );

    const result = await getIpoAnalysis("SHIPROCKET");
    expect(result.source).toBe("ai");
    expect(result.report).not.toBeNull();
    expect(result.report!.verdict.label).toBe("PARTIAL PROFIT BOOKING");
    expect(result.report!.finalScore.total).toBe(66);
    // verdict/recommendation derived from the report
    expect(result.recommendation).toBe("PARTIAL PROFIT BOOKING");
    expect(result.verdict).toContain("Listing premium priced in.");
    // persisted payload carries report
    const upsertArg = (prisma.marketCache.upsert as jest.Mock).mock.calls[0][0];
    expect((upsertArg.create.data as any).report).toBeDefined();
  });

  test("v2: falls back to legacy markdown extractors when the model returns prose (no JSON)", async () => {
    (directPrompt as jest.Mock).mockResolvedValue(SAMPLE_CONTENT);

    const result = await getIpoAnalysis("SHIPROCKET");
    expect(result.report).toBeNull();
    expect(result.recommendation).toBe("SELL 50% AND HOLD 50%");
    expect(result.verdict).toContain("SELL 50% AND HOLD 50%");
  });

  test("v2: a legacy cached DB row (no report) is served through toAnalysis with report null", async () => {
    (prisma.marketCache.findUnique as jest.Mock).mockResolvedValue({
      cacheKey: "ipo_analysis_SHIPROCKET",
      dataType: "ipo_analysis",
      data: {
        symbol: "SHIPROCKET",
        companyName: "Shiprocket Logistics Ltd",
        content: SAMPLE_CONTENT,
        verdict: "SELL 50% AND HOLD 50%",
        recommendation: "SELL 50% AND HOLD 50%",
        generatedAt: new Date().toISOString(),
      },
      recordCount: 1,
      lastSyncedAt: new Date(),
      nextSyncAt: new Date(Date.now() + IPO_ANALYSIS_CACHE_TTL_SECONDS * 1000),
    });

    const result = await getIpoAnalysis("SHIPROCKET");
    expect(result.source).toBe("cache");
    expect(result.report).toBeNull();
    expect(result.content).toBe(SAMPLE_CONTENT);
    expect(directPrompt).not.toHaveBeenCalled();
  });

  // ─── v3.14.1: cache-hit monitoring visibility ──────────────────────────

  describe("v3.14.1: cache-hit trackAiCall visibility", () => {
    test("memory cache hit calls trackAiCall with action ipo_analysis_served", async () => {
      (cache as any).set(
        "ipo_analysis_SHIPROCKET",
        {
          symbol: "SHIPROCKET",
          companyName: "Shiprocket Logistics Ltd",
          content: SAMPLE_CONTENT,
          verdict: "SELL 50% AND HOLD 50%",
          recommendation: "SELL 50% AND HOLD 50%",
          generatedAt: new Date().toISOString(),
        },
        IPO_ANALYSIS_CACHE_TTL_SECONDS
      );

      await getIpoAnalysis("SHIPROCKET");

      // trackAiCall should be called for the cache hit
      expect(trackAiCall).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "ipo_analysis_served",
          model: "cache",
          status: "success",
          tokensUsed: 0,
          responseTimeMs: 0,
          analysisType: "ipo",
        })
      );
      // No fresh AI call
      expect(directPrompt).not.toHaveBeenCalled();
    });

    test("DB cache hit calls trackAiCall with action ipo_analysis_served", async () => {
      (prisma.marketCache.findUnique as jest.Mock).mockResolvedValue({
        cacheKey: "ipo_analysis_SHIPROCKET",
        dataType: "ipo_analysis",
        data: {
          symbol: "SHIPROCKET",
          companyName: "Shiprocket Logistics Ltd",
          content: SAMPLE_CONTENT,
          verdict: "SELL 50% AND HOLD 50%",
          recommendation: "SELL 50% AND HOLD 50%",
          generatedAt: new Date().toISOString(),
        },
        recordCount: 1,
        lastSyncedAt: new Date(),
        nextSyncAt: new Date(Date.now() + IPO_ANALYSIS_CACHE_TTL_SECONDS * 1000),
      });

      await getIpoAnalysis("SHIPROCKET");

      expect(trackAiCall).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "ipo_analysis_served",
          model: "cache",
          status: "success",
        })
      );
      expect(directPrompt).not.toHaveBeenCalled();
    });

    test("fresh AI generation does NOT call trackAiCall with ipo_analysis_served", async () => {
      await getIpoAnalysis("SHIPROCKET");

      // Fresh generation uses a different action (ipo_analysis_batch)
      const servedCalls = (trackAiCall as jest.Mock).mock.calls.filter(
        (c: any[]) => c[0]?.action === "ipo_analysis_served"
      );
      expect(servedCalls).toHaveLength(0);
      expect(directPrompt).toHaveBeenCalledTimes(1);
    });
  });

  // ─── TTL Cleanup ────────────────────────────────────────────────────────

  describe("cleanStaleIpoAnalysisRows", () => {
    test("deletes rows older than retention period and returns count", async () => {
      (prisma.marketCache.deleteMany as jest.Mock).mockResolvedValue({ count: 5 });

      const deleted = await cleanStaleIpoAnalysisRows(90);

      expect(deleted).toBe(5);
      expect(prisma.marketCache.deleteMany).toHaveBeenCalledWith({
        where: {
          dataType: "ipo_analysis",
          lastSyncedAt: { lt: expect.any(Date) },
        },
      });
      // Verify cutoff is ~90 days ago
      const whereClause = (prisma.marketCache.deleteMany as jest.Mock).mock.calls[0][0];
      const cutoff = whereClause.where.lastSyncedAt.lt;
      const expectedCutoff = new Date();
      expectedCutoff.setDate(expectedCutoff.getDate() - 90);
      expect(Math.abs(cutoff.getTime() - expectedCutoff.getTime())).toBeLessThan(5000);
    });

    test("returns 0 on DB error (non-fatal)", async () => {
      (prisma.marketCache.deleteMany as jest.Mock).mockRejectedValue(new Error("DB down"));

      const deleted = await cleanStaleIpoAnalysisRows();

      expect(deleted).toBe(0);
    });

    test("returns 0 when no stale rows exist", async () => {
      (prisma.marketCache.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

      const deleted = await cleanStaleIpoAnalysisRows();

      expect(deleted).toBe(0);
    });
  });
});