// lib/__tests__/intelligenceCache.test.ts — Tests for write-through intelligence cache
import {
  getIntelligenceFromCache,
  setIntelligenceCache,
  invalidateIntelligenceCache,
  resetIntelligenceCacheForTests,
} from "@/lib/services/intelligence/cache";
import prisma from "@/lib/prisma";
import type { IntelligenceReport } from "@/lib/services/intelligenceTypes";

// ─── Mock Prisma ─────────────────────────────────────────────────────────────

jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    intelligenceCache: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

const mockPrisma = jest.mocked(prisma);

// ─── Test Data ───────────────────────────────────────────────────────────────

const sampleReport: IntelligenceReport = {
  symbol: "RELIANCE",
  analysis: {
    verdict: "BUY",
    confidence: 75,
    fairValue: { low: 2700, mid: 2900, high: 3100 },
    technicalAnalysis: { trend: "Uptrend", support: 2750, resistance: 2900, indicators: "RSI 62" },
    fundamentalAnalysis: { strengths: [], weaknesses: [] },
    valuationAssessment: { assessment: "Fairly valued", relativeValue: "In line" },
    newsCatalysts: { positive: [], negative: [], neutral: [] },
    shareholdingTrend: { summary: "" },
    riskFactors: [],
    catalysts: [],
    scenarioAnalysis: { bull: "", base: "", bear: "" },
    summary: "Test summary",
  },
  dataUsed: {
    symbol: "RELIANCE",
    quote: null,
    technicals: null,
    valuation: null,
    fundamentals: null,
    shareholding: null,
    corporate: null,
    news: null,
    peers: null,
  },
  modelUsed: "nvidia/nemotron-3-ultra-550b-a55b:free",
  generatedAt: new Date().toISOString(),
  version: 1,
  isCacheHit: false,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetIntelligenceCacheForTests();
  jest.clearAllMocks();
});

describe("getIntelligenceFromCache", () => {
  it("returns null for missing symbol", async () => {
    mockPrisma.intelligenceCache.findUnique.mockResolvedValue(null);
    const result = await getIntelligenceFromCache("NONEXISTENT");
    expect(result).toBeNull();
  });

  it("returns null for expired entry", async () => {
    const expiredRow = {
      symbol: "TEST",
      data: sampleReport.analysis,
      modelUsed: "test-model",
      generatedAt: new Date(),
      expiresAt: new Date(Date.now() - 1000), // expired
    };
    mockPrisma.intelligenceCache.findUnique.mockResolvedValue(expiredRow as never);
    mockPrisma.intelligenceCache.delete.mockResolvedValue({} as never);

    const result = await getIntelligenceFromCache("TEST");
    expect(result).toBeNull();
    expect(mockPrisma.intelligenceCache.delete).toHaveBeenCalledWith({ where: { symbol: "TEST" } });
  });

  it("returns valid entry from DB (memory miss → DB hit)", async () => {
    const futureDate = new Date(Date.now() + 86400000); // 1 day from now
    const dbRow = {
      symbol: "RELIANCE",
      data: sampleReport,
      modelUsed: "test-model",
      generatedAt: new Date(),
      expiresAt: futureDate,
    };
    mockPrisma.intelligenceCache.findUnique.mockResolvedValue(dbRow as never);

    const result = await getIntelligenceFromCache("RELIANCE");
    expect(result).not.toBeNull();
    expect(result!.report.symbol).toBe("RELIANCE");
    expect(result!.modelUsed).toBe("test-model");
  });

  it("returns cached entry from memory on second call", async () => {
    const futureDate = new Date(Date.now() + 86400000);
    const dbRow = {
      symbol: "TEST2",
      data: sampleReport,
      modelUsed: "test-model",
      generatedAt: new Date(),
      expiresAt: futureDate,
    };
    mockPrisma.intelligenceCache.findUnique.mockResolvedValue(dbRow as never);

    // First call — DB hit
    const result1 = await getIntelligenceFromCache("TEST2");
    expect(result1).not.toBeNull();
    expect(mockPrisma.intelligenceCache.findUnique).toHaveBeenCalledTimes(1);

    // Second call — memory hit (no DB call)
    const result2 = await getIntelligenceFromCache("TEST2");
    expect(result2).not.toBeNull();
    expect(mockPrisma.intelligenceCache.findUnique).toHaveBeenCalledTimes(1); // still 1
  });

  it("handles DB errors gracefully", async () => {
    mockPrisma.intelligenceCache.findUnique.mockRejectedValue(new Error("DB error"));
    const result = await getIntelligenceFromCache("ERROR");
    expect(result).toBeNull();
  });
});

describe("setIntelligenceCache", () => {
  it("upserts to DB and memory", async () => {
    mockPrisma.intelligenceCache.upsert.mockResolvedValue({} as never);

    await setIntelligenceCache("RELIANCE", sampleReport, "test-model");

    expect(mockPrisma.intelligenceCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { symbol: "RELIANCE" },
      })
    );

    // Verify memory cache was set (retrieve without DB call)
    mockPrisma.intelligenceCache.findUnique.mockResolvedValue(null);
    const memHit = await getIntelligenceFromCache("RELIANCE");
    expect(memHit).not.toBeNull(); // from memory
  });

  it("uppercases the symbol", async () => {
    mockPrisma.intelligenceCache.upsert.mockResolvedValue({} as never);

    await setIntelligenceCache("reliance", sampleReport, "test-model");

    expect(mockPrisma.intelligenceCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { symbol: "RELIANCE" },
      })
    );
  });

  it("handles DB write failure (non-blocking)", async () => {
    mockPrisma.intelligenceCache.upsert.mockRejectedValue(new Error("DB write failed"));

    // Should not throw
    await expect(
      setIntelligenceCache("FAIL", sampleReport, "test-model")
    ).resolves.toBeUndefined();
  });
});

describe("invalidateIntelligenceCache", () => {
  it("removes from both memory and DB", async () => {
    mockPrisma.intelligenceCache.delete.mockResolvedValue({} as never);

    // Set in memory first
    mockPrisma.intelligenceCache.upsert.mockResolvedValue({} as never);
    await setIntelligenceCache("INVALIDATE", sampleReport, "test");

    // Invalidate
    await invalidateIntelligenceCache("INVALIDATE");
    expect(mockPrisma.intelligenceCache.delete).toHaveBeenCalledWith({ where: { symbol: "INVALIDATE" } });

    // Verify memory was cleared
    mockPrisma.intelligenceCache.findUnique.mockResolvedValue(null);
    const result = await getIntelligenceCache("INVALIDATE");
    expect(result).toBeNull();
  });

  it("handles missing symbol gracefully", async () => {
    mockPrisma.intelligenceCache.delete.mockRejectedValue(new Error("Record not found"));
    await expect(invalidateIntelligenceCache("MISSING")).resolves.toBeUndefined();
  });
});

// Helper to access cache directly for verification
async function getIntelligenceCache(symbol: string) {
  return getIntelligenceFromCache(symbol);
}
