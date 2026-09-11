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
 * SQLite-first swing service tests: a stateful in-memory mirror of the
 * lib/sqlite fallback (swingJobs / swingSignals / trackers) replaces the
 * former in-memory Prisma mocks — the service reads/writes these tables
 * through getSqliteFallback(). Mirror upserts mutate rows IN PLACE
 * (Object.assign) so references captured before a claim/update stay live,
 * matching the old mock's applyData semantics. The arrays are exposed on the
 * @/lib/sqlite mock as `swingJobs`, `swingSignals`, `trackers` and are
 * re-imported at module scope below.
 *
 * The service's only remaining Prisma call is fetchRecentCloses
 * (prisma.$queryRaw) — mocked to resolve [] in the orchestration describe.
 */
jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    $queryRaw: jest.fn(),
    // swing's lazy Prisma fallback (mirror empty) reads the latest job
    // directly; the default `undefined` return keeps the plain first-run
    // (mirror + Prisma empty) orchestration path unchanged.
    swingAnalysisJob: { findFirst: jest.fn() },
  },
}));

jest.mock("@/lib/services/swingPerformanceService", () => ({
  checkSwingPerformance: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/sqlite", () => {
  const swingJobs: Array<Record<string, any>> = [];
  const swingSignals: Array<Record<string, any>> = [];
  const trackers: Array<Record<string, any>> = [];

  const statusMatch = (rowStatus: unknown, status?: string | string[]): boolean => {
    if (status === undefined) return true;
    const wants = Array.isArray(status) ? status : [status];
    return wants.includes(rowStatus as string);
  };

  const fallback = {
    getSwingAnalysisJobs: jest.fn(
      ({ status, limit }: { status?: string | string[]; limit?: number } = {}) => {
        const rows = swingJobs
          .filter((j) => statusMatch(j.status, status))
          .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
        return limit !== undefined ? rows.slice(0, limit) : rows;
      },
    ),
    getSwingAnalysisJob: jest.fn((id: string) => swingJobs.find((j) => j.id === id) ?? null),
    upsertSwingAnalysisJob: jest.fn((row: Record<string, any>) => {
      const idx = swingJobs.findIndex((j) => j.id === row.id);
      if (idx >= 0) {
        Object.assign(swingJobs[idx], row);
        return swingJobs[idx];
      }
      swingJobs.push(row);
      return row;
    }),
    getSwingSignals: jest.fn((jobId: string) => swingSignals.filter((s) => s.jobId === jobId)),
    upsertSwingSignal: jest.fn((row: Record<string, any>) => {
      const idx = swingSignals.findIndex(
        (s) =>
          s.jobId === row.jobId &&
          String(s.symbol).toUpperCase() === String(row.symbol).toUpperCase(),
      );
      if (idx >= 0) {
        Object.assign(swingSignals[idx], row);
        return swingSignals[idx];
      }
      swingSignals.push(row);
      return row;
    }),
    getRecommendationTrackers: jest.fn(
      ({
        symbolIn,
        status,
        limit,
      }: {
        symbolIn?: string[];
        status?: string[];
        limit?: number;
      } = {}) => {
        const rows = trackers.filter(
          (t) =>
            (symbolIn === undefined ||
              symbolIn.some(
                (sym) => String(sym).toUpperCase() === String(t.symbol).toUpperCase(),
              )) &&
            (status === undefined || status.includes(t.status)),
        );
        return limit !== undefined ? rows.slice(0, limit) : rows;
      },
    ),
    upsertRecommendationTracker: jest.fn((row: Record<string, any>) => {
      const idx = trackers.findIndex((t) => t.id === row.id);
      if (idx >= 0) {
        Object.assign(trackers[idx], row);
        return trackers[idx];
      }
      trackers.push(row);
      return row;
    }),
  };

  return {
    __esModule: true,
    getSqliteFallback: jest.fn(() => fallback),
    swingJobs,
    swingSignals,
    trackers,
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
  swingSignalDraft,
  swingSignalAnalysisPatch,
  persistSwingSignals,
  patchSwingSignalAnalysis,
  SWING_TOP_N,
  SWING_JOB_MAX_ATTEMPTS,
  jobToResponse,
} from "@/lib/services/swingRecommendationService";
import type { UnifiedScreenerResult } from "@/lib/services/chartinkUnifiedScreenerService";
import type { SwingResponse, SwingStock, SignalFamily } from "@/lib/services/swing-types";
import { staticCache } from "@/lib/cache";

// Re-import the SQLite mirror arrays + accessor so every describe mutates the
// SAME store the @/lib/sqlite mock returns (clearAllMocks resets call
// history but NOT the arrays — explicit `.length = 0` in each beforeEach).
const { getSqliteFallback, swingJobs, swingSignals, trackers } = jest.requireMock("@/lib/sqlite") as {
  getSqliteFallback: jest.Mock;
  swingJobs: Array<Record<string, any>>;
  swingSignals: Array<Record<string, any>>;
  trackers: Array<Record<string, any>>;
};

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
  beforeEach(() => {
    jest.clearAllMocks();
    trackers.length = 0;
  });

  it("creates new swing trackers and refreshes existing ones", async () => {
    // Seed an existing active swing tracker in the mirror.
    trackers.push({
      id: "tracker-existing",
      symbol: "EXISTING",
      status: "active",
      timeHorizon: "swing",
      currentPrice: 480,
      updatedAt: new Date(2026, 0, 1),
    });

    const res = await persistSwingTrackers([
      analyzedStock("NEW", "LONG"),
      analyzedStock("EXISTING", "SHORT"),
    ]);

    expect(getSqliteFallback().getRecommendationTrackers).toHaveBeenCalledWith({
      symbolIn: ["NEW", "EXISTING"],
      status: ["active"],
      limit: 500,
    });
    // Only NEW is created
    const created = trackers.filter((t) => t.symbol === "NEW");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      symbol: "NEW",
      aiRecommendation: "BUY",
      timeHorizon: "swing",
      status: "active",
      id: expect.any(String),
    });
    // EXISTING gets an in-place price refresh (targets untouched)
    const existing = trackers.find((t) => t.id === "tracker-existing")!;
    expect(existing.currentPrice).toBe(500);
    expect(existing.updatedAt).toBeInstanceOf(Date);
    expect(trackers).toHaveLength(2);
    expect(res).toEqual({ created: 1, updated: 1 });
  });

  it("does nothing when no stock carries AI analysis", async () => {
    const res = await persistSwingTrackers([makeSwingStock("A")]);
    expect(res).toEqual({ created: 0, updated: 0 });
    expect(getSqliteFallback().getRecommendationTrackers).not.toHaveBeenCalled();
    expect(trackers).toHaveLength(0);
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
    swingAnalysisJob: { findFirst: jest.Mock };
  };
  const { checkSwingPerformance } = jest.requireMock(
    "@/lib/services/swingPerformanceService",
  ) as { checkSwingPerformance: jest.Mock };

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
    prisma.swingAnalysisJob.findFirst.mockResolvedValue(null);
    checkSwingPerformance.mockResolvedValue(undefined);
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
    expect(swingJobs[0].status).toBe("running");
    expect(swingJobs[0].stockCount).toBe(1);

    // v3.14.0: the posted feed is snapshotted into SwingSignal at posting —
    // date-of-posting price baseline with NO AI levels yet.
    expect(swingSignals).toHaveLength(1);
    expect(swingSignals[0].jobId).toBe(swingJobs[0].id);
    expect(swingSignals[0].symbol).toBe("RELIANCE");
    expect(swingSignals[0].status).toBe("tracking");
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
    // Seed a completed job directly in the mirror.
    swingJobs.push({
      ...makeJobInput(),
      id: "job-done",
      createdAt: new Date(Date.now() - 60_000),
      status: "done",
      analyzedCount: 1,
      payload: {
        stocks: (makeJobInput().payload as { stocks: unknown[] }).stocks,
        analysisStatus: "done",
        analysisError: null,
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
    swingJobs.push({ ...makeJobInput(), id: "job-pending", createdAt: new Date(Date.now() - 60_000) });
    runChartinkUnifiedScreeners.mockRejectedValue(new Error("must not scan"));

    const response = await getSwingRecommendations({ analyze: true }); // no force
    expect(response.analysisStatus).toBe("pending");
    expect(response.stocks).toHaveLength(1);
    expect(runChartinkUnifiedScreeners).not.toHaveBeenCalled();
    expect(swingJobs).toHaveLength(1); // no second job created
  });

  it("serves an old done job indefinitely — no regeneration on plain loads", async () => {
    swingJobs.push(
      makeJobInput({
        id: "job-old-done",
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        status: "done",
        payload: {
          stocks: [fakeUnified],
          analysisStatus: "done",
          analysisError: null,
        },
      }),
    );
    const { getSwingRecommendations } = await import(
      "@/lib/services/swingRecommendationService"
    );
    runChartinkUnifiedScreeners.mockRejectedValue(new Error("scan should not run"));
    const res = await getSwingRecommendations({ analyze: true, forceRefresh: false });
    expect(res.analysisStatus).toBe("done");
    expect(res.stocks).toHaveLength(1);
    expect(runChartinkUnifiedScreeners).not.toHaveBeenCalled();
    expect(swingJobs).toHaveLength(1); // no new job created
  });

  it("serves the newest done job when a stale pending job hides behind it — no auto-regen", async () => {
    swingJobs.push(
      makeJobInput({
        id: "job-done-2h",
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        status: "done",
        payload: {
          stocks: [fakeUnified],
          analysisStatus: "done",
          analysisError: null,
        },
      }),
      makeJobInput({
        id: "job-stale-pending",
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
        status: "pending",
        payload: { stocks: [fakeUnified] },
      }),
    );
    const { getSwingRecommendations } = await import(
      "@/lib/services/swingRecommendationService"
    );
    const res = await getSwingRecommendations({ analyze: true, forceRefresh: false });
    expect(res.analysisStatus).toBe("done");
    expect(res.stocks).toHaveLength(1);
    expect(runChartinkUnifiedScreeners).not.toHaveBeenCalled();
    expect(swingJobs).toHaveLength(2); // no new job created
    expect(checkSwingPerformance).not.toHaveBeenCalled();
    // (The stale pending job's recovery to failed is covered by the
    // "recovers a stale running job" test below — asserting it here would be
    // timing-fragile because the kick is fire-and-forget.)
  });

  it("falls back to Prisma when the mirror is empty and serves a done job without re-scanning", async () => {
    prisma.swingAnalysisJob.findFirst.mockResolvedValue(
      makeJobInput({
        id: "job-prisma-done",
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
        status: "done",
        payload: {
          stocks: [fakeUnified],
          analysisStatus: "done",
          analysisError: null,
        },
      }) as unknown as Record<string, unknown>,
    );
    const { getSwingRecommendations } = await import(
      "@/lib/services/swingRecommendationService"
    );
    const res = await getSwingRecommendations({ analyze: true, forceRefresh: false });
    expect(prisma.swingAnalysisJob.findFirst).toHaveBeenCalledTimes(1);
    expect(res.analysisStatus).toBe("done");
    expect(res.stocks).toHaveLength(1);
    expect(runChartinkUnifiedScreeners).not.toHaveBeenCalled();
    expect(swingJobs).toHaveLength(0);
    expect(staticCache.get("swing:recommendations:ai")).toBeDefined();
  });

  it("creates a durable pending job on a plain first load (mirror + Prisma empty), no in-memory-only run", async () => {
    const { getSwingRecommendations } = await import(
      "@/lib/services/swingRecommendationService"
    );
    const res = await getSwingRecommendations({ analyze: true, forceRefresh: false });
    expect(runChartinkUnifiedScreeners).toHaveBeenCalledTimes(1);
    expect(prisma.swingAnalysisJob.findFirst).toHaveBeenCalledTimes(1);
    expect(swingJobs).toHaveLength(1);
    expect(swingJobs[0].status).toBe("running"); // claimed by the processor
    expect(res.analysisStatus).toBe("pending");
  });

  it("kicks a performance check when force-refreshing with a prior done job", async () => {
    swingJobs.push(
      makeJobInput({
        id: "job-prior-done",
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        status: "done",
        payload: {
          stocks: [fakeUnified],
          analysisStatus: "done",
          analysisError: null,
        },
      }),
    );
    const { getSwingRecommendations } = await import(
      "@/lib/services/swingRecommendationService"
    );
    const res = await getSwingRecommendations({ analyze: true, forceRefresh: true });
    expect(checkSwingPerformance).toHaveBeenCalledTimes(1);
    expect(res.analysisStatus).toBe("pending");
    expect(swingJobs).toHaveLength(2);
    expect(swingJobs.find((j) => j.id === "job-prior-done")?.status).toBe("done"); // not superseded
    expect(swingJobs.find((j) => j.id !== "job-prior-done")?.status).toBe("running");
    expect(runChartinkUnifiedScreeners).toHaveBeenCalledTimes(1);
  });

  it("force refresh supersedes pending jobs so the UI refresh always wins", async () => {
    const { getSwingRecommendations } = await import(
      "@/lib/services/swingRecommendationService"
    );
    swingJobs.push({
      ...makeJobInput(),
      id: "job-old",
      createdAt: new Date(Date.now() - 60_000),
    });
    // Force refresh triggers a fresh scan + job, failing the stale pending one.
    const response = await getSwingRecommendations({ analyze: true, forceRefresh: true });

    expect(response.analysisStatus).toBe("pending");
    expect(swingJobs).toHaveLength(2);
    const old = swingJobs.find((j) => j.id === "job-old")!;
    expect(old.status).toBe("failed");
    expect(old.error).toBe("Superseded by a newer force refresh");
    const fresh = swingJobs.find((j) => j.id !== "job-old")!;
    expect(fresh.status).toBe("running");
    expect(runChartinkUnifiedScreeners).toHaveBeenCalledTimes(1);
    // No prior done/failed job existed (only pending) — the perf-check kick must not fire.
    expect(checkSwingPerformance).not.toHaveBeenCalled();
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
    swingJobs.push({ ...makeJobInput(), id: "job-once", createdAt: new Date(Date.now() - 60_000) });

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
    swingJobs.push({
      ...makeJobInput(),
      id: "job-stale",
      createdAt: new Date(Date.now() - 60_000),
      status: "running",
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
      attemptCount: 1,
    });
    const stale = swingJobs.find((j) => j.id === "job-stale")!;
    await maybeProcessSwingAnalysis();
    // Retried (recovery → pending) then claimed again → attemptCount 2 → failed.
    expect(swingJobs[0].status).toBe("failed");
    expect(swingJobs[0].attemptCount).toBe(2);
    expect(analyzeSwingStocks).toHaveBeenCalledTimes(1);

    // Attempt 2 also died — attempts exhausted → failed WITHOUT running AI.
    swingJobs.push({
      ...makeJobInput(),
      id: "job-exhausted",
      createdAt: new Date(Date.now() - 120_000),
      status: "running",
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
      attemptCount: SWING_JOB_MAX_ATTEMPTS,
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
    swingJobs.push({ ...makeJobInput(), id: "job-mid", createdAt: new Date(Date.now() - 60_000) });
    const job = swingJobs.find((j) => j.id === "job-mid")!;

    const processing = processSwingAnalysisJob(job);
    await new Promise((r) => setTimeout(r, 0)); // let the claim land

    // Force refresh supersedes while the analysis is in flight.
    const sqlite = getSqliteFallback();
    sqlite.upsertSwingAnalysisJob({
      ...job,
      status: "failed",
      error: "Superseded by a newer force refresh",
      completedAt: new Date(),
    });
    resolveAnalysis();
    await processing;

    const fresh = sqlite.getSwingAnalysisJob(job.id);
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

// ─── persistSwingSignals / patchSwingSignalAnalysis (SQLite mirror) ─────────

describe("swing signal persistence (SQLite mirror)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    swingSignals.length = 0;
  });

  it("persists one draft per stock at job creation and skips duplicate jobId+symbol rows", async () => {
    const res1 = await persistSwingSignals("job-1", [
      makeSwingStock("RELIANCE"),
      makeSwingStock("TATASTEEL"),
    ]);
    expect(res1.created).toBe(2);

    // Idempotent re-persist of the same job+symbol (mirrors @@unique +
    // skipDuplicates) — creates nothing new.
    const res2 = await persistSwingSignals("job-1", [makeSwingStock("RELIANCE")]);
    expect(res2.created).toBe(0);
    expect(swingSignals).toHaveLength(2);
    expect(swingSignals[0]).toMatchObject({ jobId: "job-1", symbol: "RELIANCE", status: "tracking" });
    expect(swingSignals[0].analysis).toBeNull();
    expect(swingSignals[0].aiRecommendation).toBeNull();
  });

  it("persists nothing for an empty feed", async () => {
    const res = await persistSwingSignals("job-1", []);
    expect(res.created).toBe(0);
    expect(swingSignals).toHaveLength(0);
  });

  it("patches only stocks that carry analysis, scoped to jobId+symbol", async () => {
    await persistSwingSignals("job-1", [
      makeSwingStock("RELIANCE"),
      makeSwingStock("TATASTEEL"),
    ]);

    const patched = await patchSwingSignalAnalysis("job-1", [
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
    ]);

    expect(patched.patched).toBe(1);
    const rel = swingSignals.find((s) => s.symbol === "RELIANCE")!;
    expect(rel.aiRecommendation).toBe("BUY");
    expect(rel.confidence).toBe(82);
    expect(rel.targetPrice).toBe(2750);
    expect(rel.stopLoss).toBe(2375);
    expect(rel.updatedAt).toBeInstanceOf(Date);

    // Unpatched symbols keep the posting snapshot (level-less → can only expire).
    const tata = swingSignals.find((s) => s.symbol === "TATASTEEL")!;
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
