// lib/__tests__/decisionEngine.test.ts — pure unit tests for the new
// decision engine (IB + PM + swing perspectives, first principles — no network,
// no mocks). Zero IO: indicators and the verdict fusion are pure math.

import {
  sma,
  rsi,
  atr,
  swingRegime,
  runTechnicalAnalysis,
  riskStats,
  positionSizePct,
  fuseVerdict,
} from "@/lib/services/decision";

describe("decision engine pure math", () => {
  test("sma returns the mean of the last N closes", () => {
    expect(sma([10, 20, 30], 2)).toBe(25);
    expect(sma([1], 5)).toBeNull();
  });

  test("rsi on flat prices is neutral (50)", () => {
    const flat = Array.from({ length: 16 }, () => 100);
    expect(rsi(flat)).toBeCloseTo(50, 5);
  });

  test("atr is positive when highs/lows swing", () => {
    const bars = [
      { high: 10, low: 9, close: 9.5 },
      { high: 12, low: 10, close: 11 },
      { high: 11, low: 9.5, close: 10.5 },
    ];
    expect(atr(bars, 2)).toBeGreaterThan(0);
  });

  test("swingRegime: rising closes = bull", () => {
    expect(swingRegime(Array.from({ length: 55 }, (_, i) => i + 1))).toBe("bull");
  });

  test("runTechnicalAnalysis returns a swing score on a rising series", () => {
    const t = runTechnicalAnalysis(Array.from({ length: 55 }, (_, i) => i + 1));
    expect(t.swingScore).toBeGreaterThanOrEqual(0.5);
  });

  test("riskStats: volatility + max drawdown computed", () => {
    const out = riskStats([100, 90, 80, 95]);
    expect(out.volatilityStd).toBeGreaterThan(0);
    expect(out.maxDrawdownPct).toBeGreaterThan(0);
  });

  test("positionSizePct stays bounded for typical vol", () => {
    expect(positionSizePct(riskStats([100, 101, 102]))).toBeLessThanOrEqual(1.5);
  });

  test("fuseVerdict", () => {
    expect(fuseVerdict(1, 1, 1)).toBe("BUY");
    expect(fuseVerdict(-1, -1, -1)).toBe("SELL");
    expect(fuseVerdict(null, null, 0)).toBe("HOLD");
  });
});
