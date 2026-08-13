/**
 * Tests for swingRecommendationService — pure pipeline pieces:
 * template → signal-family segregation, symbol dedupe, ranking/capping,
 * momentum indicators, and family counting.
 *
 * NOTE: only PURE functions are tested here (no DB / network). The DB fetch
 * (fetchRecentCloses) and AI orchestration (getSwingRecommendations) are thin
 * wrappers over tested pieces + established services.
 */
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
  SWING_TOP_N,
} from "@/lib/services/swingRecommendationService";
import type { UnifiedScreenerResult } from "@/lib/services/chartinkUnifiedScreenerService";
import type { SwingStock } from "@/lib/services/swing-types";

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
