// lib/__tests__/decisionFusion.test.ts
// ph22 Decision engine — weighted composite scoring (spec §4.F). Pure unit
// tests: no providers, no DB, no network.
import {
  scoreCandidate,
  scoreScreenerResult,
  SCREENER_POC_RUBRIC,
  type Rubric,
} from "@/lib/services/decision/fusion";

describe("scoreCandidate", () => {
  const rubric: Rubric = {
    name: "test",
    factors: [
      {
        criterion: "alpha",
        weight: 0.25,
        extract: (s) => (typeof s["alpha"] === "number" ? (s["alpha"] as number) : undefined),
      },
      {
        criterion: "beta",
        weight: 0.75,
        extract: (s) => (typeof s["beta"] === "number" ? (s["beta"] as number) : undefined),
      },
    ],
  };

  it("computes a weighted mean composite", () => {
    const out = scoreCandidate({ alpha: 0, beta: 1 }, rubric);
    expect(out.composite).toBeCloseTo(0.75, 5);
    expect(out.provider).toBe("local");
    expect(out.factors).toHaveLength(2);
    expect(out.factors[0].criterion).toBe("alpha");
    expect(out.factors[0].score).toBe(0);
    expect(out.factors[1].score).toBe(1);
  });

  it("clamps factor scores into 0..1", () => {
    const out = scoreCandidate({ alpha: -2, beta: 3 }, rubric);
    expect(out.factors[0].score).toBe(0);
    expect(out.factors[1].score).toBe(1);
    expect(out.composite).toBeCloseTo(0.75, 5);
  });

  it("treats missing factor data as absent evidence (score 0, escalate)", () => {
    const out = scoreCandidate({ alpha: 1 }, rubric);
    const beta = out.factors[1];
    expect(beta.present).toBe(false);
    expect(beta.score).toBe(0);
    expect(beta.confidence).toBe(0);
    expect(beta.gate).toBe("escalate");
    // Weighted mean: alpha=1 (0.25) + beta=0 (0.75) → 0.25
    expect(out.composite).toBeCloseTo(0.25, 5);
  });

  it("never produces an act gate when a factor is missing", () => {
    const out = scoreCandidate({ alpha: 1 }, rubric);
    expect(out.gate).not.toBe("act");
  });

  it("is conservative: worst factor gate wins", () => {
    // alpha weak (escapes act) → overall must not be act even though beta = 1.
    const weakAlpha = scoreCandidate({ alpha: 0.5, beta: 1 }, rubric);
    expect(weakAlpha.gate).not.toBe("act");
    // Both strong → act.
    const strong = scoreCandidate({ alpha: 1, beta: 1 }, rubric);
    expect(strong.gate).toBe("act");
    expect(strong.confidence).toBeGreaterThan(0.5);
  });

  it("handles an empty rubric (0 composite, escalate)", () => {
    const out = scoreCandidate({}, { name: "empty", factors: [] });
    expect(out.composite).toBe(0);
    expect(out.gate).toBe("escalate");
    expect(out.factors).toEqual([]);
    expect(out.confidence).toBe(0);
  });

  it("handles zero/negative total weight without NaN", () => {
    const zeroW = scoreCandidate(
      { alpha: 1 },
      { name: "zero", factors: [{ criterion: "alpha", weight: 0, extract: rubric.factors[0].extract }] },
    );
    expect(Number.isFinite(zeroW.composite)).toBe(true);
    expect(zeroW.composite).toBe(0);
    expect(zeroW.gate).toBe("escalate");
  });

  it("local confidence follows peakedness (strong factor → high confidence)", () => {
    const strong = scoreCandidate({ alpha: 1, beta: 1 }, rubric);
    const flat = scoreCandidate({ alpha: 0.5, beta: 0.5 }, rubric);
    expect(strong.confidence).toBeGreaterThan(flat.confidence);
    expect(flat.confidence).toBeLessThan(0.2);
  });
});

describe("scoreScreenerResult / SCREENER_POC_RUBRIC", () => {
  it("scores a strong screener row highly (5% change, 4+ screeners)", () => {
    const out = scoreScreenerResult({ changePercent: 5, screenerCount: 4 });
    expect(out.composite).toBeCloseTo(1, 5);
    expect(out.gate).toBe("act");
  });

  it("scores a flat row low (0% change, 1 screener)", () => {
    const out = scoreScreenerResult({ changePercent: 0, screenerCount: 1 });
    // momentum 0.5·0.6 + signal 0.25·0.4 = 0.4
    expect(out.composite).toBeCloseTo(0.4, 5);
    expect(out.gate).toBe("escalate");
  });

  it("is symmetric on negative momentum (no data gain from losses)", () => {
    const down = scoreScreenerResult({ changePercent: -5, screenerCount: 2 });
    const up = scoreScreenerResult({ changePercent: +5, screenerCount: 2 });
    expect(down.composite).toBeCloseTo(0.2, 5); // 0·0.6 + 0.5·0.4
    expect(up.composite).toBeGreaterThan(down.composite);
  });

  it("treats non-numeric row fields as absent evidence", () => {
    const out = scoreScreenerResult({ changePercent: "n/a", screenerCount: null });
    expect(out.composite).toBe(0);
    expect(out.gate).toBe("escalate");
    expect(out.factors.every((f) => !f.present)).toBe(true);
  });

  it("rubric is exported with the documented weights", () => {
    expect(SCREENER_POC_RUBRIC.name).toBe("unified-screener-poc-a");
    expect(SCREENER_POC_RUBRIC.factors.map((f) => f.criterion)).toEqual([
      "momentum",
      "signalSupport",
    ]);
  });
});