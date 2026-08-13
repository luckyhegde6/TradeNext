/**
 * Tests for lib/services/recommendationLevelEvaluator.ts (v3.6.3).
 *
 * Direction-aware validation/correction of AI target/stop-loss levels:
 *   - BUY : target > price > stop
 *   - SELL: target < price < stop   (inverted vs legacy BUY-style fallback)
 *   - HOLD: target slightly above price, stop slightly below
 * Missing/zero/contradictory/out-of-bounds levels are replaced with
 * direction-aware price defaults and reported in `corrections`.
 */

import {
  evaluateRecommendationLevels,
  DIRECTION_DEFAULTS,
  type LevelEvaluation,
} from "@/lib/services/recommendationLevelEvaluator";

describe("evaluateRecommendationLevels", () => {
  // ─── Valid levels pass through unchanged ────────────────────────────

  it("accepts valid BUY levels (target > price > stop)", () => {
    const res = evaluateRecommendationLevels({
      direction: "BUY",
      price: 2500,
      targetPrice: 2750,
      stopLoss: 2375,
    });
    expect(res).toMatchObject({
      direction: "BUY",
      targetPrice: 2750,
      stopLoss: 2375,
      valid: true,
    });
    expect(res.corrections).toHaveLength(0);
  });

  it("accepts valid SELL levels (target < price < stop)", () => {
    const res = evaluateRecommendationLevels({
      direction: "SELL",
      price: 279,
      targetPrice: 250,
      stopLoss: 295,
    });
    expect(res).toMatchObject({
      direction: "SELL",
      targetPrice: 250,
      stopLoss: 295,
      valid: true,
    });
    expect(res.corrections).toHaveLength(0);
  });

  it("accepts valid HOLD levels (tight band around price)", () => {
    const res = evaluateRecommendationLevels({
      direction: "HOLD",
      price: 1000,
      targetPrice: 1050,
      stopLoss: 950,
    });
    expect(res).toMatchObject({ targetPrice: 1050, stopLoss: 950, valid: true });
    expect(res.corrections).toHaveLength(0);
  });

  // ─── Missing / zero levels get direction-aware defaults ─────────────

  it("BUY with 0/0 falls back to 1.10x target / 0.95x stop", () => {
    const res = evaluateRecommendationLevels({
      direction: "BUY",
      price: 2500,
      targetPrice: 0,
      stopLoss: 0,
    });
    expect(res).toMatchObject({ targetPrice: 2750, stopLoss: 2375, valid: false });
    expect(res.corrections.length).toBe(2);
  });

  it("SELL with 0/0 falls back to 0.90x target / 1.05x stop (inverted — regression)", () => {
    const res = evaluateRecommendationLevels({
      direction: "SELL",
      price: 279,
      targetPrice: 0,
      stopLoss: 0,
    });
    // ITC-like SELL: target BELOW price (251.10), stop ABOVE price (292.95)
    expect(res).toMatchObject({
      targetPrice: 279 * 0.9,
      stopLoss: 279 * 1.05,
      valid: false,
    });
    expect(res.targetPrice).toBeLessThan(279);
    expect(res.stopLoss).toBeGreaterThan(279);
  });

  it("HOLD with missing levels falls back to the tight HOLD band", () => {
    const res = evaluateRecommendationLevels({ direction: "HOLD", price: 1000 });
    const { targetPct, stopLossPct } = DIRECTION_DEFAULTS.HOLD;
    expect(res).toMatchObject({
      targetPrice: 1000 * (1 + targetPct),
      stopLoss: 1000 * (1 - stopLossPct),
      valid: false,
    });
  });

  // ─── Contradictory (wrong-direction) levels are corrected ───────────

  it("SELL with BUY-style levels (target above, stop below) is corrected — ITC bug", () => {
    // Real observed bug: ITC SELL @ ₹279 returned target ₹306.9 (above) /
    // stop ₹265.05 (below) — a BUY layout on a SELL rec.
    const res = evaluateRecommendationLevels({
      direction: "SELL",
      price: 279,
      targetPrice: 306.9,
      stopLoss: 265.05,
    });
    expect(res.valid).toBe(false);
    expect(res.targetPrice).toBeLessThan(279); // corrected target BELOW price
    expect(res.stopLoss).toBeGreaterThan(279); // corrected stop ABOVE price
    expect(res.corrections[0]).toContain("contradict");
  });

  it("BUY with inverted levels (target below, stop above) is corrected", () => {
    const res = evaluateRecommendationLevels({
      direction: "BUY",
      price: 100,
      targetPrice: 90,
      stopLoss: 110,
    });
    expect(res.valid).toBe(false);
    expect(res.targetPrice).toBeGreaterThan(100);
    expect(res.stopLoss).toBeLessThan(100);
  });

  it("SELL with equal levels is corrected", () => {
    const res = evaluateRecommendationLevels({
      direction: "SELL",
      price: 100,
      targetPrice: 100,
      stopLoss: 100,
    });
    expect(res.valid).toBe(false);
    expect(res.targetPrice).toBeLessThan(100);
    expect(res.stopLoss).toBeGreaterThan(100);
  });

  // ─── Out-of-bounds / absurd levels are replaced ─────────────────────

  it("absurd target (10x price) is replaced with the default", () => {
    const res = evaluateRecommendationLevels({
      direction: "BUY",
      price: 100,
      targetPrice: 1000,
      stopLoss: 95,
    });
    expect(res.valid).toBe(false);
    expect(res.targetPrice).toBe(110); // replaced with 1.10x default
    expect(res.corrections[0]).toContain("out of bounds");
  });

  // ─── Edge cases ─────────────────────────────────────────────────────

  it("returns raw values unvalidated when price anchor is missing/0", () => {
    const res = evaluateRecommendationLevels({
      direction: "SELL",
      price: 0,
      targetPrice: 306.9,
      stopLoss: 265.05,
    });
    expect(res).toMatchObject({ targetPrice: 306.9, stopLoss: 265.05, valid: false });
    expect(res.corrections[0]).toContain("price anchor");
  });

  it("rounds corrected levels to 2 decimals", () => {
    const res = evaluateRecommendationLevels({
      direction: "SELL",
      price: 279.123,
      targetPrice: 0,
      stopLoss: 0,
    });
    expect(Number.isInteger(res.targetPrice * 100)).toBe(true);
    expect(Number.isInteger(res.stopLoss * 100)).toBe(true);
  });

  it("rejects NaN/negative/null inputs as unusable", () => {
    const res = evaluateRecommendationLevels({
      direction: "BUY",
      price: 100,
      targetPrice: Number.NaN,
      stopLoss: null,
    });
    expect(res).toMatchObject({ targetPrice: 110, stopLoss: 95, valid: false });
  });
});