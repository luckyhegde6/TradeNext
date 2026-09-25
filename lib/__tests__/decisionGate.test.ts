// lib/__tests__/decisionGate.test.ts
// ph22 Decision engine — gate + confidence shaping unit tests (plan §test table).
import { decide, shapeConfidence, GATE_THRESHOLDS } from "@/lib/services/decision/gate";

describe("shapeConfidence", () => {
  test("uniform distribution → 0 (flat = uncertain)", () => {
    expect(shapeConfidence([0.5, 0.5])).toBeCloseTo(0, 6);
    expect(shapeConfidence([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(0, 6);
  });

  test("one-hot distribution → 1 (peaked = confident)", () => {
    expect(shapeConfidence([1, 0])).toBeCloseTo(1, 6);
    expect(shapeConfidence([0, 0, 1, 0])).toBeCloseTo(1, 6);
  });

  test("peaked but soft distribution lands in between", () => {
    const p = shapeConfidence([0.8, 0.2]);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });

  test("skewed three-way reflects peakedness order", () => {
    expect(shapeConfidence([0.9, 0.05, 0.05])).toBeGreaterThan(
      shapeConfidence([0.6, 0.3, 0.1])
    );
  });

  test("degenerate inputs return 0 without throwing", () => {
    expect(shapeConfidence([])).toBe(0);
    expect(shapeConfidence([1])).toBe(0);
    expect(shapeConfidence([0, 0])).toBe(0);
    expect(shapeConfidence([-1, 2])).toBeGreaterThanOrEqual(0);
    expect(shapeConfidence([NaN, 1])).toBeGreaterThanOrEqual(0);
  });
});

describe("decide", () => {
  test("high confidence routes to ACT at every risk band", () => {
    expect(decide(1, "read-only")).toBe("act");
    expect(decide(1, "moderate")).toBe("act");
    expect(decide(1, "destructive")).toBe("act");
  });

  test("low confidence escalates at every risk band", () => {
    expect(decide(0, "read-only")).toBe("escalate");
    expect(decide(0.1, "moderate")).toBe("escalate");
    expect(decide(0.2, "destructive")).toBe("escalate");
  });

  test("confidence exactly at ACT threshold is ACT (boundary-exact)", () => {
    expect(decide(GATE_THRESHOLDS["read-only"].act, "read-only")).toBe("act");
    expect(decide(GATE_THRESHOLDS.moderate.act, "moderate")).toBe("act");
    expect(decide(GATE_THRESHOLDS.destructive.act, "destructive")).toBe("act");
  });

  test("confidence exactly at REVIEW threshold is REVIEW (boundary-exact)", () => {
    expect(decide(GATE_THRESHOLDS["read-only"].review, "read-only")).toBe("review");
    expect(decide(GATE_THRESHOLDS.moderate.review, "moderate")).toBe("review");
    expect(decide(GATE_THRESHOLDS.destructive.review, "destructive")).toBe("review");
  });

  test("band between review and act is REVIEW", () => {
    const { act, review } = GATE_THRESHOLDS.moderate;
    const mid = (act + review) / 2;
    expect(decide(mid, "moderate")).toBe("review");
  });

  test("risk scaling — same confidence can act read-only but escalate destructive", () => {
    expect(decide(0.6, "read-only")).toBe("act");
    expect(decide(0.6, "moderate")).toBe("review");
    expect(decide(0.6, "destructive")).toBe("escalate");
  });
});