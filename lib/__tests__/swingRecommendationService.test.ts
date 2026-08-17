/**
 * Tests for swingRecommendationService — pure pipeline pieces:
 * template → signal-family segregation, symbol dedupe, ranking/capping,
 * momentum indicators, family counting, tracker persistence, and the
 * DB-backed analysis job orchestration (v3.13.0).
 *
 * The DB fetch (fetchRecentCloses) and AI orchestration (getSwingRecommendations)
 * are exercised with a stateful in-memory swingAnalysisJob store that mirrors
 * the service's actual queries (claim, stale recovery, supersede).
 */

// ─── Mocks (before imports — SWC hoists jest.mock) ──────────────────────
// Only needed by the getSwingRecommendations audit-logging tests at the end;
// the pure-function tests never touch these modules.

jest.mock("@/lib/services/chartinkUnifiedScreenerService", () => ({
  runChartinkUnifiedScreeners: jest.fn(),
}));

jest.mock("@/lib/services/ai/swing-agent", () => ({
  analyzeSwingStocks: jest.fn(),
}));

jest.mock("@/lib/services/ai/config", () => ({
  loadConfig: jest.fn(),
}));

/**
 * Stateful in-memory SwingAnalysisJob store mirroring the service's queries:
 * findFirst (orderBy), findUnique, create, update, updateMany with
 * status-in / lt / gte / increment conditions (claim, stale recovery,
 * supersede, force-refresh). Exposed on the mock as `__swingJobs` for tests.
 */
jest.mock("@/lib/prisma", () => {
  const jobs: Array<Record<string, any>> = [];

  const compare = (cond: unknown, val: unknown): boolean => {
    if (cond === undefined) return true;
    if (cond && typeof cond === "object") {
      const c = cond as Record<string, unknown>;
      if ("in" in c) return Array.isArray(c.in) ? c.in.includes(val) : false;
      if ("lt" in c) return val !== null && val !== undefined && val < (c.lt as Date | number);
      if ("lte" in c) return val !== null && val !== undefined && val <= (c.lte as Date | number);
      if ("gt" in c) return val !== null && val !== undefined && val > (c.gt as Date | number);
      if ("gte" in c) return val !== null && val !== undefined && val >= (c.gte as Date | number);
      return true;
    }
    return val === cond;
  };

  const whereMatches = (row: Record<string, any>, where: Record<string, any> | undefined): boolean => {
    if (!where) return true;
    return Object.entries(where).every(([key, cond]) => compare(cond, row[key]));
  };

  const applyData = (row: Record<string, any>, data: Record<string, any>): void => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object" && "increment" in value) {
        row[key] = (row[key] ?? 0) + (value as { increment: number }).increment;
      } else {
        row[key] = value;
      }
    }
  };

  const swingAnalysisJob = {
    findFirst: jest.fn(async (args?: { where?: Record<string, any>; orderBy?: { createdAt?: "asc" | "desc" } }) => {
      const matched = jobs.filter((j) => whereMatches(j, args?.where));
      matched.sort((a, b) =>
        args?.orderBy?.createdAt === "asc"
          ? a.createdAt.getTime() - b.createdAt.getTime()
          : b.createdAt.getTime() - a.createdAt.getTime(),
      );
      return matched[0] ?? null;
    }),
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) => jobs.find((j) => j.id === where.id) ?? null),
    create: jest.fn(async ({ data }: { data: Record<string, any> }) => {
      const row: Record<string, any> = {
        id: `job-${jobs.length + 1}`,
        status: "pending",
        payload: null,
        generatedAt: new Date(),
        startedAt: null,
        completedAt: null,
        error: null,
        stockCount: 0,
        analyzedCount: 0,
        attemptCount: 0,
        templateCount: 0,
        totalRaw: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      jobs.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
      const row = jobs.find((j) => j.id === where.id);
      if (!row) throw new Error("swingAnalysisJob not found");
      applyData(row, data);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
      const matched = jobs.filter((j) => whereMatches(j, where));
      for (const row of matched) applyData(row, data);
      return { count: matched.length };
    }),
  };

  // v3.14.0: stateful in-memory SwingSignal store mirroring the persistence
  // queries — createMany with skipDuplicates (jobId+symbol unique) and
  // updateMany scoped to { jobId, symbol } (AI-level patch). Exposed as
  // `__swingSignals` for the orchestration assertions.
  const signals: Array<Record<string, any>> = [];

  const swingSignal = {
    createMany: jest.fn(
      async ({
        data,
        skipDuplicates,
      }: {
        data: Array<Record<string, any>>;
        skipDuplicates?: boolean;
      }) => {
        let created = 0;
        for (const d of data) {
          if (skipDuplicates && signals.some((s) => s.jobId === d.jobId && s.symbol === d.symbol)) {
            continue;
          }
          signals.push({
            id: `signal-${signals.length + 1}`,
            status: "active",
            currentPrice: null,
            returnPercent: null,
            lastCheckedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...d,
          });
          created++;
        }
        return { count: created };
      },
    ),
    updateMany: jest.fn(
      async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
        const matched = signals.filter((s) => whereMatches(s, where));
        for (const row of matched) applyData(row, data);
        return { count: matched.length };
      },
    ),
  };

  return {
    __esModule: true,
    default: { $queryRaw: jest.fn(), swingAnalysisJob, swingSignal },
    __swingJobs: jobs,
    __swingSignals: signals,
  };
});

jest.mock("@/lib/audit", () => ({
  __esModule: true,
  createAuditLog: jest.fn().mockResolvedValue(undefined),
}));

import {
  templateFamilies,
  swingFamiliesForTemplates,
  segregateAndDedupe,
  marketCapScoreOf,
  swingCompositeScore,
  momentumScoreOf,
  rankSwingStocks,
  computeIndicatorsFromSeries,
  countSegregation,
  analysisStatusAfterBatch,
  swingTrackerDraft,
  persistSwingTrackers,
  type SwingTrackerDb,
  swingSignalDraft,
  swingSignalAnalysisPatch,
  persistSwingSignals,
  patchSwingSignalAnalysis,
  type SwingSignalDb,
  SWING_TOP_N,
  SWING_JOB_MAX_ATTEMPTS,
  jobToResponse,
} from "@/lib/services/swingRecommendationService";
import type { UnifiedScreenerResult } from "@/lib/services/chartinkUnifiedScreenerService";
import type { SwingResponse, SwingStock, SignalFamily } from "@/lib/services/swing-types";
import { staticCache } from "@/lib/cache";

// ─── templateFamilies ────────────────────────────────────────────────────

describe("templateFamilies", () => {
  it("maps supertrend/renko/SMA names to the trend family", () => {
    expect(templateFamilies("swing.x", "SUPERTREND (7,1) TREND FINDER (RENKO 2 or 3 %) (SWING)")).toContain("trend");
    expect(templateFamilies("swing.y", "Swing Trade Scanner 100 200 SMA 80 EMA CCI 100")).toContain("trend");
  });

  it("maps breakout names to the breakout family", () => {
    expect(templateFamilies("swing.z", "Swing Breakout")).toContain("breakout");
  });

  it("maps RSI/dip/reversal names to the reversal family", () => {
    expect(templateFamilies("swing.a", "Swing Trading Buy on Dip")).toContain("reversal");
    expect(templateFamilies("swing.b", "RSI Reversal Swing")).toContain("reversal");
  });

  it("maps CCI/momentum names to the momentum family", () => {
    expect(templateFamilies("swing.c", "Swing Trade Scanner 100 200 SMA 80 EMA CCI 100")).toContain("momentum");
  });

  it("maps volume names to the volume family", () => {
    expect(templateFamilies("swing.d", "Volume Breakout Swing vol > 5Lac")).toContain("volume");
  });

  it("maps range/consolidation names to the range family", () => {
    expect(templateFamilies("swing.e", "Good Swing Trading between EMA 10 and 20")).toContain("range");
  });

  it("defaults to trend when no keyword matches (swing scans are trend-oriented)", () => {
    expect(templateFamilies("swing.f", "Nifty, BankNifty LONG using Swing Trading")).toEqual(["trend"]);
  });

  it("can return multiple families for a composite screener", () => {
    const families = templateFamilies(
      "swing.g",
      "Swing Trade Scanner 100 200 SMA 80 EMA CCI 100 vol 5Lac",
    );
    expect(families).toContain("trend");
    expect(families).toContain("momentum");
    expect(families).toContain("volume");
  });
});

// ─── swingFamiliesForTemplates ───────────────────────────────────────────

describe("swingFamiliesForTemplates", () => {
  const nameById = new Map([
    ["swing.breakout", "Swing Breakout"],
    ["swing.buyondip", "Swing Trading Buy on Dip"],
  ]);

  it("unions families across the flagging templates", () => {
    const families = swingFamiliesForTemplates(["swing.breakout", "swing.buyondip"], nameById);
    expect(families).toContain("breakout");
    expect(families).toContain("reversal");
  });

  it("treats an unknown template id as trend (fallback)", () => {
    expect(swingFamiliesForTemplates(["swing.unknown"], nameById)).toContain("trend");
  });
});

// ─── segregateAndDedupe ──────────────────────────────────────────────────

function makeResult(symbol: string, overrides: Partial<UnifiedScreenerResult> = {}): UnifiedScreenerResult {
  return {
    symbol,
    name: symbol,
    price: 100,
    change: 2,
    changePercent: 2,
    volume: 10000,
    screenerNames: ["Scanner A"],
    screenerCount: 1,
    source: "chartink_live",
    templateIds: ["swing.a"],
    ...overrides,
  };
}

function makeSwingStock(symbol: string, overrides: Partial<SwingStock> = {}): SwingStock {
  return {
    symbol,
    name: symbol,
    price: 100,
    change: 2,
    changePercent: 2,
    volume: 10000,
    screenerNames: ["Scanner A"],
    screenerCount: 1,
    families: ["trend"],
    templateIds: ["swing.a"],
    source: "chartink_live",
    momentumScore: 50,
    indicators: { momentum10: null, momentum20: null, volatility20: null, distanceFrom20dHigh: null },
    analysis: null,
    analysisError: null,
    ...overrides,
  };
}

describe("segregateAndDedupe", () => {
  const nameById = new Map([
    ["swing.breakout", "Swing Breakout"],
    ["swing.buyondip", "Swing Trading Buy on Dip"],
  ]);

  it("adds families from the flagging templates", () => {
    const [stock] = segregateAndDedupe(
      [makeResult("RELIANCE", { templateIds: ["swing.breakout"] })],
      nameById,
    );
    expect(stock.families).toContain("breakout");
  });

  it("merges duplicate symbols — unions families + screener tags, bumps screenerCount", () => {
    const [stock] = segregateAndDedupe(
      [
        makeResult("TATAMOTORS", {
          templateIds: ["swing.breakout"],
          screenerNames: ["Swing Breakout"],
        }),
        makeResult("TATAMOTORS", {
          templateIds: ["swing.buyondip"],
          screenerNames: ["Swing Trading Buy on Dip"],
          price: 120,
          volume: 50000,
        }),
      ],
      nameById,
    );

    expect(stock.families).toEqual(expect.arrayContaining(["breakout", "reversal"]));
    expect(stock.screenerNames).toHaveLength(2);
    expect(stock.screenerCount).toBe(2);
    expect(stock.price).toBe(120); // latest non-zero price wins
    expect(stock.volume).toBe(50000);
  });

  it("uppercases symbols", () => {
    const [stock] = segregateAndDedupe([makeResult("reliance")], nameById);
    expect(stock.symbol).toBe("RELIANCE");
  });
});

// ─── Ranking ─────────────────────────────────────────────────────────────

describe("ranking", () => {
  it("scores market-cap bands: 10kCr+ → 3, 1kCr+ → 2, 100Cr+ → 1, else 0", () => {
    expect(marketCapScoreOf(1e12)).toBe(3);
    expect(marketCapScoreOf(1e11)).toBe(3);
    expect(marketCapScoreOf(2e10)).toBe(2);
    expect(marketCapScoreOf(5e9)).toBe(1);
    expect(marketCapScoreOf(1e8)).toBe(0);
    expect(marketCapScoreOf(undefined)).toBe(0);
  });

  it("composite score favors screener agreement, then market cap, then momentum", () => {
    const a = { screenerCount: 3, changePercent: 2, marketCap: 1e9 };
    const b = { screenerCount: 2, changePercent: 2, marketCap: 1e12 };
    expect(swingCompositeScore(a)).toBeGreaterThan(swingCompositeScore(b));
  });

  it("momentumScore is a 0–100 display score", () => {
    expect(momentumScoreOf({ changePercent: 5 })).toBe(100);
    expect(momentumScoreOf({ changePercent: 0 })).toBe(50);
    expect(momentumScoreOf({ changePercent: -10 })).toBe(0);
  });

  it("caps at SWING_TOP_N and sorts by composite score (tie-break screenerCount)", () => {
    const stocks = Array.from({ length: 25 }).map((_, i) =>
      makeSwingStock(`SYM${String(i).padStart(2, "0")}`, {
        screenerCount: i % 5,
        screenerNames: Array.from({ length: (i % 5) + 1 }, (_, j) => `Scanner ${j}`),
      }),
    );
    const ranked = rankSwingStocks(stocks);
    expect(ranked).toHaveLength(SWING_TOP_N);
    // Composite score desc across the ranked list
    for (let i = 1; i < ranked.length; i++) {
      expect(swingCompositeScore(ranked[i - 1])).toBeGreaterThanOrEqual(swingCompositeScore(ranked[i]));
    }
  });

  it("keeps all stocks when fewer than the cap", () => {
    const stocks = [makeSwingStock("A"), makeSwingStock("B")];
    expect(rankSwingStocks(stocks)).toHaveLength(2);
  });
});

// ─── Indicators ──────────────────────────────────────────────────────────

describe("computeIndicatorsFromSeries", () => {
  it("computes momentum10/momentum20 from a close series", () => {
    const closes = Array.from({ length: 25 }, (_, i) => 100 + i);
    const ind = computeIndicatorsFromSeries(closes);
    // 25th value 124 vs 10 back (115) → ~7.8%; vs 20 back (105) → ~18.1%
    expect(ind.momentum10).toBeCloseTo(((124 - 115) / 115) * 100, 1);
    expect(ind.momentum20).toBeCloseTo(((124 - 105) / 105) * 100, 1);
  });

  it("computes distanceFrom20dHigh (0 at the high, positive on pullback)", () => {
    const closes = [100, 102, 104, 106, 108, 110, 108, 106, 104];
    const ind = computeIndicatorsFromSeries(closes);
    expect(ind.distanceFrom20dHigh).toBeCloseTo(((110 - 104) / 110) * 100, 1);
  });

  it("computes a finite volatility20 for a volatile series", () => {
    const ind = computeIndicatorsFromSeries([100, 95, 110, 92, 115, 88, 120]);
    expect(ind.volatility20).not.toBeNull();
    expect(Number.isFinite(ind.volatility20)).toBe(true);
    expect(ind.volatility20!).toBeGreaterThan(0);
  });

  it("returns nulls for a series shorter than 2 points", () => {
    expect(computeIndicatorsFromSeries([100])).toEqual({
      momentum10: null,
      momentum20: null,
      volatility20: null,
      distanceFrom20dHigh: null,
    });
  });

  it("returns null momentum when the window is shorter than needed", () => {
    const ind = computeIndicatorsFromSeries([100, 101, 102]);
    expect(ind.momentum10).toBeNull();
    expect(ind.momentum20).toBeNull();
    expect(ind.momentum10 ?? ind.momentum20 ?? null).toBeNull();
  });
});

// ─── countSegregation ────────────────────────────────────────────────────

describe("countSegregation", () => {
  it("counts stocks per family (a stock can count in several)", () => {
    const stocks = [
      makeSwingStock("A", { families: ["trend"] }),
      makeSwingStock("B", { families: ["trend", "breakout"] }),
      makeSwingStock("C", { families: ["reversal"] }),
    ];
    const counts = countSegregation(stocks);
    expect(counts.trend).toBe(2);
    expect(counts.breakout).toBe(1);
    expect(counts.reversal).toBe(1);
    expect(counts.momentum).toBe(0);
  });
});

// ─── analysisStatusAfterBatch ────────────────────────────────────────────

describe("analysisStatusAfterBatch", () => {
  it("reports 'done' when at least one stock carries AI targets", () => {
    const stocks = [
      makeSwingStock("A", { analysis: null, analysisError: "Unusable AI response (p)" }),
      makeSwingStock("B", {
        analysis: {
          action: "LONG",
          confidence: 85,
          entryPrice: 100,
          targetPrice: 110,
          stopLoss: 95,
          timeHorizon: "short",
          logic: "trend continuation",
          momentumScore: 80,
          riskFactors: ["volatility"],
        },
        analysisError: null,
      }),
    ];
    expect(analysisStatusAfterBatch(stocks)).toBe("done");
  });

  it("reports 'failed' when every analysis failed (regression: live prod header lied)", () => {
    const stocks = [
      makeSwingStock("A", { analysis: null, analysisError: "Unusable AI response (p)" }),
      makeSwingStock("B", { analysis: null, analysisError: "Unusable AI response (p)" }),
    ];
    expect(analysisStatusAfterBatch(stocks)).toBe("failed");
  });

  it("reports 'failed' on an empty batch (no analyses attempted)", () => {
    expect(analysisStatusAfterBatch([])).toBe("failed");
  });
});

// ─── swingTrackerDraft (v3.10.1 persistence) ─────────────────────────────

const analyzedStock = (symbol: string, action: "LONG" | "SHORT" | "OBSERVE") =>
  makeSwingStock(symbol, {
    price: 500,
    screenerNames: ["Scanner A", "Scanner B"],
    families: ["trend", "breakout"],
    source: "chartink_live",
    analysis: {
      action,
      confidence: 80,
      entryPrice: 500,
      targetPrice: 560,
      stopLoss: 460,
      timeHorizon: "short",
      logic: "trend continuation with volume",
      momentumScore: 75,
      riskFactors: ["volatility"],
    },
    analysisError: null,
  });

describe("swingTrackerDraft", () => {
  it("maps LONG → BUY with the AI target/stop/confidence and screener attribution", () => {
    const draft = swingTrackerDraft(analyzedStock("RELIANCE", "LONG"));
    expect(draft).not.toBeNull();
    expect(draft!.symbol).toBe("RELIANCE");
    expect(draft!.aiRecommendation).toBe("BUY");
    expect(draft!.timeHorizon).toBe("swing");
    expect(draft!.status).toBe("active");
    expect(draft!.entryPrice).toBe(500);
    expect(draft!.currentPrice).toBe(500);
    expect(draft!.targetPrice).toBe(560);
    expect(draft!.stopLoss).toBe(460);
    expect(draft!.confidence).toBe(80);
    expect(draft!.reasoning).toBe("trend continuation with volume");
    expect(draft!.riskFactors).toEqual(["volatility"]);
    expect(draft!.screenerAttribution).toEqual({
      screenerNames: ["Scanner A", "Scanner B"],
      families: ["trend", "breakout"],
      source: "chartink_live",
    });
  });

  it("maps SHORT → SELL and OBSERVE → HOLD", () => {
    expect(swingTrackerDraft(analyzedStock("TCS", "SHORT"))!.aiRecommendation).toBe("SELL");
    expect(swingTrackerDraft(analyzedStock("INFY", "OBSERVE"))!.aiRecommendation).toBe("HOLD");
  });

  it("returns null when the stock has no analysis", () => {
    expect(swingTrackerDraft(makeSwingStock("A"))).toBeNull();
  });
});

describe("persistSwingTrackers", () => {
  const makeDb = () => {
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const db: SwingTrackerDb & { calls: string[] } = {
      calls: [],
      recommendationTracker: {
        findMany: jest.fn().mockImplementation(async ({ where }) => {
          return where.symbol.in.includes("EXISTING") ? [{ symbol: "EXISTING" }] : [];
        }),
        createMany,
        updateMany,
      },
    };
    return db;
  };

  it("creates new swing trackers and refreshes existing ones", async () => {
    const db = makeDb();
    const res = await persistSwingTrackers(
      [analyzedStock("NEW", "LONG"), analyzedStock("EXISTING", "SHORT")],
      db,
    );

    expect(db.recommendationTracker.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ timeHorizon: "swing", status: "active" }),
      }),
    );
    // Only NEW is created
    expect(db.recommendationTracker.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ symbol: "NEW", aiRecommendation: "BUY", timeHorizon: "swing" })],
      skipDuplicates: true,
    });
    // EXISTING gets a price/lastCheckedAt refresh (targets untouched)
    expect(db.recommendationTracker.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ symbol: "EXISTING", timeHorizon: "swing", status: "active" }),
        data: expect.objectContaining({ currentPrice: 500, lastCheckedAt: expect.any(Date) }),
      }),
    );
    expect(res).toEqual({ created: 1, updated: 1 });
  });

  it("does nothing when no stock carries AI analysis", async () => {
    const db = makeDb();
    const res = await persistSwingTrackers([makeSwingStock("A")], db);
    expect(res).toEqual({ created: 0, updated: 0 });
    expect(db.recommendationTracker.findMany).not.toHaveBeenCalled();
  });
});

// ─── Orchestration (v3.13.0 DB-backed analysis job) ──────────────────────
// getSwingRecommendations is a thin orchestrator. Since v3.13.0 the AI
// analysis runs as a durable SwingAnalysisJob row: the request returns a fast
// "pending" feed, the processor (daemon tick + request kick) settles the job
// in the background, and the DB row survives cache LRU eviction + instance
// recycle. These tests pin: audit contract, job lifecycle (create → claim →
// done/failed), stale-running recovery (retry once → fail), supersede on
// force refresh, and the no-double-run guard.

describe("getSwingRecommendations audit logging", () => {
  const { createAuditLog } = jest.requireMock("@/lib/audit") as {
    createAuditLog: jest.Mock;
  };
  const { runChartinkUnifiedScreeners } = jest.requireMock(
    "@/lib/services/chartinkUnifiedScreenerService",
  ) as { runChartinkUnifiedScreeners: jest.Mock };
  const { analyzeSwingStocks } = jest.requireMock("@/lib/services/ai/swing-agent") as {
    analyzeSwingStocks: jest.Mock;
  };
  const prisma = jest.requireMock("@/lib/prisma").default as {
    $queryRaw: jest.Mock;
    swingAnalysisJob: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  const swingJobs = jest.requireMock("@/lib/prisma").__swingJobs as Array<Record<string, any>>;
  const swingSignals = jest.requireMock("@/lib/prisma").__swingSignals as Array<Record<string, any>>;

  const fakeUnified = {
    symbol: "RELIANCE",
    name: "Reliance Industries",
    price: 2500,
    change: 12.5,
    changePercent: 0.5,
    volume: 1_000_000,
    screenerNames: ["Swing Breakout"],
    screenerCount: 1,
    marketCap: 1e12,
    templateIds: ["swing.breakout"],
    source: "chartink_db",
  } as unknown as UnifiedScreenerResult;

  const makeJobInput = (overrides: Record<string, any> = {}) => ({
    status: "pending",
    payload: {
      stocks: [
        {
          symbol: "RELIANCE",
          name: "Reliance Industries",
          price: 2500,
          change: 12.5,
          changePercent: 0.5,
          volume: 1_000_000,
          screenerNames: ["Swing Breakout"],
          screenerCount: 1,
          families: ["breakout"],
          templateIds: ["swing.breakout"],
          source: "chartink_db",
          momentumScore: 60,
          indicators: { momentum10: 5, momentum20: 12, volatility20: 3, distanceFrom20dHigh: 2 },
          analysis: null,
          analysisError: null,
        },
      ],
    },
    stockCount: 1,
    templateCount: 1,
    totalRaw: 1,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    swingJobs.length = 0;
    swingSignals.length = 0;
    prisma.$queryRaw.mockResolvedValue([]);
    runChartinkUnifiedScreeners.mockResolvedValue([fakeUnified]);
    staticCache.flushAll();
  });

  it("audits run start + complete when analysis is skipped", async () => {
    const { getSwingRecommendations } = await import(
      "@/lib/services/swingRecommendationService"
    );
    const response = await getSwingRecommendations({ analyze: false, forceRefresh: true });

    expect(response.analysisStatus).toBe("skipped");
    const actions = createAuditLog.mock.calls.map((c) => c[0].action);
    expect(actions).toContain("SWING_RUN_START");
    expect(actions).toContain("SWING_RUN_COMPLETE");
    expect(actions).not.toContain("SWING_ANALYSIS_START");
    expect(swingJobs).toHaveLength(0); // no job for analyze=false
  });

  it("creates a durable pending job and settles it to failed with a readable error", async () => {
    analyzeSwingStocks.mockResolvedValue([
      {
        symbol: "RELIANCE",
        price: 2500,
        changePercent: 0.5,
        volume: 1_000_000,
        screenerNames: ["Swing Breakout"],
        families: ["breakout"],
        success: false,
        error:
          "Swing AI analysis failed — the model's response was not valid JSON (2 attempt(s) across 2 model(s))",
      },
    ]);
    const { getSwingRecommendations, flushSwingAnalysis } = await import(
      "@/lib/services/swingRecommendationService"
    );

    // Request returns immediately with the screener feed + pending status —
    // the whole point of the request-time split (no 30s wall).
    const response = await getSwingRecommendations({ analyze: true, forceRefresh: true });
    expect(response.analysisStatus).toBe("pending");
    expect(response.stocks).toHaveLength(1);
    expect(response.stocks[0].analysis).toBeNull();

    // The job row is the durable source of truth.
    expect(swingJobs).toHaveLength(1);
    expect(swingJobs[0].status).toBe("pending");
    expect(swingJobs[0].stockCount).toBe(1);

    // v3.14.0: the posted feed is snapshotted into SwingSignal at posting —
    // date-of-posting price baseline with NO AI levels yet.
    expect(swingSignals).toHaveLength(1);
    expect(swingSignals[0].jobId).toBe(swingJobs[0].id);
    expect(swingSignals[0].symbol).toBe("RELIANCE");
    expect(swingSignals[0].status).toBe("active");
    expect(swingSignals[0].analysis).toBeNull();
    expect(swingSignals[0].aiRecommendation).toBeNull();
    expect(swingSignals[0].targetPrice).toBeNull();

    // Background settles: failed status + readable error land in cache + DB.
    await flushSwingAnalysis();
    const cached = staticCache.get("swing:recommendations:ai") as SwingResponse;
    expect(cached.analysisStatus).toBe("failed");
    expect(cached.analysisError).toContain("not valid JSON");
    expect(swingJobs[0].status).toBe("failed");
    expect(swingJobs[0].analyzedCount).toBe(0);
    expect(swingJobs[0].error).toContain("not valid JSON");
    expect(swingJobs[0].completedAt).toBeInstanceOf(Date);

    const actions = createAuditLog.mock.calls.map((c) => c[0].action);
    expect(actions).toContain("SWING_ANALYSIS_START");
    expect(actions).toContain("SWING_ANALYSIS_FAILED");
    expect(actions).toContain("SWING_RUN_COMPLETE");
  });

  it("publishes done status + AI targets after a successful background analysis", async () => {
    analyzeSwingStocks.mockResolvedValue([
      {
        symbol: "RELIANCE",
        price: 2500,
        changePercent: 0.5,
        volume: 1_000_000,
        screenerNames: ["Swing Breakout"],
        families: ["breakout"],
        success: true,
        analysis: {
          action: "LONG",
          confidence: 82,
          entryPrice: 2500,
          targetPrice: 2750,
          stopLoss: 2375,
          timeHorizon: "short",
          logic: "Breakout above the swing high with volume expansion.",
          momentumScore: 71,
          riskFactors: ["Broader market weakness"],
        },
      },
    ]);
    const { getSwingRecommendations, flushSwingAnalysis } = await import(
      "@/lib/services/swingRecommendationService"
    );

    const response = await getSwingRecommendations({ analyze: true, forceRefresh: true });
    expect(response.analysisStatus).toBe("pending");

    await flushSwingAnalysis();
    const cached = staticCache.get("swing:recommendations:ai") as SwingResponse;
    expect(cached.analysisStatus).toBe("done");
    expect(cached.stocks[0].analysis?.action).toBe("LONG");
    expect(cached.stocks[0].analysis?.confidence).toBe(82);
    expect(swingJobs[0].status).toBe("done");
    expect(swingJobs[0].analyzedCount).toBe(1);

    // v3.14.0: the posted signal is patched with the AI levels the swing
    // performance check evaluates (BUY vocabulary, targets as-of posting).
    expect(swingSignals).toHaveLength(1);
    expect(swingSignals[0].aiRecommendation).toBe("BUY");
    expect(swingSignals[0].confidence).toBe(82);
    expect(swingSignals[0].targetPrice).toBe(2750);
    expect(swingSignals[0].stopLoss).toBe(2375);
    expect(swingSignals[0].analysis).toEqual(expect.objectContaining({ action: "LONG", targetPrice: 2750 }));
    expect(swingSignals[0].updatedAt).toBeInstanceOf(Date);

    const actions = createAuditLog.mock.calls.map((c) => c[0].action);
    expect(actions).toContain("SWING_ANALYSIS_COMPLETE");
  });

  it("serves a completed job from the DB without re-scanning", async () => {
    const { getSwingRecommendations } = await import(
      "@/lib/services/swingRecommendationService"
    );
    await prisma.swingAnalysisJob.create({
      data: {
        ...makeJobInput(),
        status: "done",
        analyzedCount: 1,
        payload: {
          stocks: (makeJobInput().payload as { stocks: unknown[] }).stocks,
          analysisStatus: "done",
          analysisError: null,
        },
      },
    });
    runChartinkUnifiedScreeners.mockRejectedValue(new Error("must not scan"));

    const response = await getSwingRecommendations({ analyze: true }); // no force
    expect(response.analysisStatus).toBe("done");
    expect(response.stocks).toHaveLength(1);
    expect(runChartinkUnifiedScreeners).not.toHaveBeenCalled();
    // Cache warmed for steady-state polls.
    expect(staticCache.get("swing:recommendations:ai")).toBeDefined();
  });

  it("serves a frozen pending feed from a pending job without re-scanning", async () => {
    const { getSwingRecommendations } = await import(
      "@/lib/services/swingRecommendationService"
    );
    await prisma.swingAnalysisJob.create({ data: makeJobInput() });
    runChartinkUnifiedScreeners.mockRejectedValue(new Error("must not scan"));

    const response = await getSwingRecommendations({ analyze: true }); // no force
    expect(response.analysisStatus).toBe("pending");
    expect(response.stocks).toHaveLength(1);
    expect(runChartinkUnifiedScreeners).not.toHaveBeenCalled();
    expect(swingJobs).toHaveLength(1); // no second job created
  });

  it("force refresh supersedes pending jobs so the UI refresh always wins", async () => {
    const { getSwingRecommendations } = await import(
      "@/lib/services/swingRecommendationService"
    );
    await prisma.swingAnalysisJob.create({
      data: { ...makeJobInput(), id: "job-old" },
    });
    // Force refresh triggers a fresh scan + job, failing the stale pending one.
    const response = await getSwingRecommendations({ analyze: true, forceRefresh: true });

    expect(response.analysisStatus).toBe("pending");
    expect(swingJobs).toHaveLength(2);
    const old = swingJobs.find((j) => j.id === "job-old")!;
    expect(old.status).toBe("failed");
    expect(old.error).toBe("Superseded by a newer force refresh");
    const fresh = swingJobs.find((j) => j.id !== "job-old")!;
    expect(fresh.status).toBe("pending");
    expect(runChartinkUnifiedScreeners).toHaveBeenCalledTimes(1);
  });

  it("does not double-run the analysis on concurrent processor kicks", async () => {
    const { maybeProcessSwingAnalysis, flushSwingAnalysis } = await import(
      "@/lib/services/swingRecommendationService"
    );
    analyzeSwingStocks.mockResolvedValue([
      {
        symbol: "RELIANCE",
        price: 2500,
        changePercent: 0.5,
        volume: 1_000_000,
        screenerNames: ["Swing Breakout"],
        families: ["breakout"],
        success: false,
        error: "boom",
      },
    ]);
    await prisma.swingAnalysisJob.create({ data: makeJobInput() });

    await Promise.all([
      maybeProcessSwingAnalysis(),
      maybeProcessSwingAnalysis(),
      maybeProcessSwingAnalysis(),
    ]);
    await flushSwingAnalysis();

    expect(analyzeSwingStocks).toHaveBeenCalledTimes(1);
    expect(swingJobs[0].status).toBe("failed"); // empty/boom batch → failed
  });

  it("recovers a stale running job: retries once, then fails (attempts exhausted)", async () => {
    const { maybeProcessSwingAnalysis } = await import(
      "@/lib/services/swingRecommendationService"
    );
    analyzeSwingStocks.mockResolvedValue([
      {
        symbol: "RELIANCE",
        price: 2500,
        changePercent: 0.5,
        volume: 1_000_000,
        screenerNames: ["Swing Breakout"],
        families: ["breakout"],
        success: false,
        error: "boom",
      },
    ]);

    // Attempt 1 died mid-run (instance recycle) — stale >45min, claim-count 1.
    const stale = await prisma.swingAnalysisJob.create({
      data: {
        ...makeJobInput(),
        status: "running",
        startedAt: new Date(Date.now() - 60 * 60 * 1000),
        attemptCount: 1,
      },
    });
    await maybeProcessSwingAnalysis();
    // Retried (recovery → pending) then claimed again → attemptCount 2 → failed.
    expect(swingJobs[0].status).toBe("failed");
    expect(swingJobs[0].attemptCount).toBe(2);
    expect(analyzeSwingStocks).toHaveBeenCalledTimes(1);

    // Attempt 2 also died — attempts exhausted → failed WITHOUT running AI.
    await prisma.swingAnalysisJob.create({
      data: {
        ...makeJobInput(),
        status: "running",
        startedAt: new Date(Date.now() - 60 * 60 * 1000),
        attemptCount: SWING_JOB_MAX_ATTEMPTS,
      },
    });
    await maybeProcessSwingAnalysis();
    const exhausted = swingJobs.find((j) => j.id !== stale.id)!;
    expect(exhausted.status).toBe("failed");
    expect(exhausted.error).toContain("timed out");
    expect(exhausted.attemptCount).toBe(SWING_JOB_MAX_ATTEMPTS);
    expect(analyzeSwingStocks).toHaveBeenCalledTimes(1); // unchanged
  });

  it("discards the result when the job is superseded mid-analysis", async () => {
    const { processSwingAnalysisJob } = await import(
      "@/lib/services/swingRecommendationService"
    );
    let resolveAnalysis!: () => void;
    analyzeSwingStocks.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAnalysis = () => resolve([]);
        }),
    );
    const job = await prisma.swingAnalysisJob.create({ data: makeJobInput() });

    const processing = processSwingAnalysisJob(job);
    await new Promise((r) => setTimeout(r, 0)); // let the claim land

    // Force refresh supersedes while the analysis is in flight.
    await prisma.swingAnalysisJob.update({
      where: { id: job.id },
      data: { status: "failed", error: "Superseded by a newer force refresh", completedAt: new Date() },
    });
    resolveAnalysis();
    await processing;

    const fresh = await prisma.swingAnalysisJob.findUnique({ where: { id: job.id } });
    expect(fresh!.status).toBe("failed");
    expect(fresh!.error).toBe("Superseded by a newer force refresh");
    expect(staticCache.get("swing:recommendations:ai")).toBeUndefined();
  });
});

// ─── swingSignalDraft (v3.14.0 — posting snapshot) ─────────────────────────

describe("swingSignalDraft", () => {
  it("snapshots the screener fields with a null analysis at posting", () => {
    const stock = makeSwingStock("RELIANCE", {
      name: "Reliance Industries",
      price: 2500,
      change: 12.5,
      changePercent: 0.5,
      volume: 1_000_000,
      marketCap: 1e12,
      screenerNames: ["Swing Breakout"],
      screenerCount: 1,
      families: ["breakout"],
      templateIds: ["swing.breakout"],
      source: "chartink_db",
      momentumScore: 60,
    });
    expect(swingSignalDraft(stock, "job-1")).toEqual({
      jobId: "job-1",
      symbol: "RELIANCE",
      name: "Reliance Industries",
      price: 2500,
      change: 12.5,
      changePercent: 0.5,
      volume: 1_000_000,
      marketCap: 1e12,
      screenerNames: ["Swing Breakout"],
      screenerCount: 1,
      families: ["breakout"],
      templateIds: ["swing.breakout"],
      source: "chartink_db",
      indicators: expect.objectContaining({ momentum10: null }),
      momentumScore: 60,
      analysis: null,
      aiRecommendation: null,
      confidence: null,
      targetPrice: null,
      stopLoss: null,
    });
  });

  it("nulls/defaults optional fields and ignores a pre-existing analysis (levels patched later)", () => {
    const stock = makeSwingStock("TATASTEEL", {
      change: null as unknown as number,
      volume: null as unknown as number,
      marketCap: undefined,
      screenerNames: undefined as unknown as string[],
      screenerCount: undefined as unknown as number,
      families: undefined as unknown as SignalFamily[],
      templateIds: undefined as unknown as string[],
      source: undefined as unknown as string,
      momentumScore: undefined as unknown as number,
      analysis: {
        action: "LONG",
        confidence: 80,
        entryPrice: 100,
        targetPrice: 110,
        stopLoss: 95,
        timeHorizon: "short",
        logic: "x",
        momentumScore: 60,
        riskFactors: [],
      },
    });
    const draft = swingSignalDraft(stock, "job-2");
    expect(draft.name).toBe("TATASTEEL");
    expect(draft.change).toBeNull();
    expect(draft.volume).toBeNull();
    expect(draft.marketCap).toBeNull();
    expect(draft.screenerNames).toEqual([]);
    expect(draft.screenerCount).toBe(0);
    expect(draft.families).toEqual([]);
    expect(draft.templateIds).toEqual([]);
    expect(draft.source).toBe("chartink");
    expect(draft.momentumScore).toBe(0);
    expect(draft.analysis).toBeNull(); // posting snapshot — never carries levels
    expect(draft.targetPrice).toBeNull();
  });
});

// ─── swingSignalAnalysisPatch (v3.14.0 — AI levels) ────────────────────────

describe("swingSignalAnalysisPatch", () => {
  it("returns null when the stock carries no analysis", () => {
    expect(swingSignalAnalysisPatch(makeSwingStock("RELIANCE"))).toBeNull();
  });

  it("maps LONG→BUY with confidence/target/stop and the raw analysis", () => {
    const patch = swingSignalAnalysisPatch(
      makeSwingStock("RELIANCE", {
        analysis: {
          action: "LONG",
          confidence: 82,
          entryPrice: 2500,
          targetPrice: 2750,
          stopLoss: 2375,
          timeHorizon: "short",
          logic: "Breakout above the swing high with volume expansion.",
          momentumScore: 71,
          riskFactors: ["Broader market weakness"],
        },
      }),
    );
    expect(patch).not.toBeNull();
    expect(patch!.aiRecommendation).toBe("BUY");
    expect(patch!.confidence).toBe(82);
    expect(patch!.targetPrice).toBe(2750);
    expect(patch!.stopLoss).toBe(2375);
    expect(patch!.analysis).toEqual(expect.objectContaining({ action: "LONG" }));
  });

  it("maps SHORT→SELL and OBSERVE→HOLD (direction-aware vocabulary)", () => {
    const short = swingSignalAnalysisPatch(
      makeSwingStock("HDFCBANK", {
        analysis: {
          action: "SHORT",
          confidence: 70,
          entryPrice: 1700,
          targetPrice: 1600,
          stopLoss: 1780,
          timeHorizon: "short",
          logic: "x",
          momentumScore: 40,
          riskFactors: [],
        },
      }),
    );
    expect(short!.aiRecommendation).toBe("SELL");

    const observe = swingSignalAnalysisPatch(
      makeSwingStock("LMW", {
        analysis: {
          action: "OBSERVE",
          confidence: 40,
          entryPrice: 300,
          targetPrice: 0,
          stopLoss: 0,
          timeHorizon: "medium",
          logic: "x",
          momentumScore: 30,
          riskFactors: [],
        },
      }),
    );
    expect(observe!.aiRecommendation).toBe("HOLD");
  });
});

// ─── persistSwingSignals / patchSwingSignalAnalysis (inline db override) ────

describe("swing signal persistence (db override)", () => {
  const store: Array<Record<string, any>> = [];

  const makeDb = (): SwingSignalDb => {
    const swingSignal = {
      createMany: jest.fn(async ({ data }: { data: Array<Record<string, any>> }) => {
        let created = 0;
        for (const d of data) {
          if (store.some((s) => s.jobId === d.jobId && s.symbol === d.symbol)) continue;
          store.push({ id: `s-${store.length + 1}`, status: "active", ...d });
          created++;
        }
        return { count: created };
      }),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { jobId: string; symbol: string };
          data: Record<string, any>;
        }) => {
          const matched = store.filter((s) => s.jobId === where.jobId && s.symbol === where.symbol);
          for (const row of matched) Object.assign(row, data);
          return { count: matched.length };
        },
      ),
    };
    return { swingSignal };
  };

  beforeEach(() => {
    store.length = 0;
  });

  it("persists one draft per stock at job creation and skips duplicate jobId+symbol rows", async () => {
    const db = makeDb();
    const res1 = await persistSwingSignals(
      "job-1",
      [makeSwingStock("RELIANCE"), makeSwingStock("TATASTEEL")],
      db,
    );
    expect(res1.created).toBe(2);

    // Idempotent re-persist of the same job+symbol (mirrors @@unique +
    // skipDuplicates) — creates nothing new.
    const res2 = await persistSwingSignals("job-1", [makeSwingStock("RELIANCE")], db);
    expect(res2.created).toBe(0);
    expect(store).toHaveLength(2);
    expect(store[0]).toMatchObject({ jobId: "job-1", symbol: "RELIANCE", status: "active" });
    expect(store[0].analysis).toBeNull();
    expect(store[0].aiRecommendation).toBeNull();
  });

  it("persists nothing for an empty feed", async () => {
    const db = makeDb();
    const res = await persistSwingSignals("job-1", [], db);
    expect(res.created).toBe(0);
    expect(store).toHaveLength(0);
  });

  it("patches only stocks that carry analysis, scoped to jobId+symbol", async () => {
    const db = makeDb();
    await persistSwingSignals(
      "job-1",
      [makeSwingStock("RELIANCE"), makeSwingStock("TATASTEEL")],
      db,
    );

    const patched = await patchSwingSignalAnalysis(
      "job-1",
      [
        makeSwingStock("RELIANCE", {
          analysis: {
            action: "LONG",
            confidence: 82,
            entryPrice: 2500,
            targetPrice: 2750,
            stopLoss: 2375,
            timeHorizon: "short",
            logic: "x",
            momentumScore: 71,
            riskFactors: [],
          },
        }),
        makeSwingStock("TATASTEEL"), // no analysis → skipped
      ],
      db,
    );

    expect(patched.patched).toBe(1);
    const rel = store.find((s) => s.symbol === "RELIANCE")!;
    expect(rel.aiRecommendation).toBe("BUY");
    expect(rel.confidence).toBe(82);
    expect(rel.targetPrice).toBe(2750);
    expect(rel.stopLoss).toBe(2375);
    expect(rel.updatedAt).toBeInstanceOf(Date);

    // Unpatched symbols keep the posting snapshot (level-less → can only expire).
    const tata = store.find((s) => s.symbol === "TATASTEEL")!;
    expect(tata.aiRecommendation).toBeNull();
    expect(tata.targetPrice).toBeNull();
    expect(tata.stopLoss).toBeNull();
  });
});

// ─── jobToResponse (pure normalization) ───────────────────────────────────

describe("jobToResponse", () => {
  const baseJob = {
    status: "pending",
    payload: {
      stocks: [],
      segregation: { momentum: 0, breakout: 0, trend: 0, meanReversion: 0, crossover: 0, bearish: 0, volume: 0, range: 0, reversal: 0 },
      generatedAt: "2026-08-16T04:00:00.000Z",
    },
    error: null,
    templateCount: 34,
    totalRaw: 120,
  };

  it("maps done jobs to analysisStatus done with stock payloads", () => {
    const res = jobToResponse({ ...baseJob, status: "done" });
    expect(res.analysisStatus).toBe("done");
    expect(res.templateCount).toBe(34);
    expect(res.totalRaw).toBe(120);
    expect(res.stocks).toEqual([]);
  });

  it("maps failed jobs to analysisStatus failed with a readable error", () => {
    const res = jobToResponse({ ...baseJob, status: "failed", error: "AI analysis failed" });
    expect(res.analysisStatus).toBe("failed");
    expect(res.analysisError).toBe("AI analysis failed");
  });

  it("maps pending/running jobs to a frozen pending feed (never claims done)", () => {
    expect(jobToResponse(baseJob).analysisStatus).toBe("pending");
    expect(jobToResponse({ ...baseJob, status: "running" }).analysisStatus).toBe("pending");
  });
});
