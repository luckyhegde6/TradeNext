// lib/__tests__/layaProvider.test.ts
// ph22 Decision engine — Laya provider (mock, Laya decode contract).
// Deterministic answers: choice = keys[argmax] under peaked spread,
// score = expected-value mean of numeric state fields, noul = p[1].
jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { LayaMockProvider } from "@/lib/services/decision/layaProvider";

const provider = new LayaMockProvider();

describe("LayaMockProvider — choice", () => {
  test("picks first option (argmax under peaked probs) with peaked probabilities", async () => {
    const res = await provider.evaluate({
      state: { momentum: 0.8 },
      questions: [
        { type: "choice", name: "bias", options: ["trending", "range", "reversal"] },
      ],
    });
    const a = res.answers.bias as { choice: string; probabilities: number[]; confidence: number };
    expect(a.choice).toBe("trending");
    expect(a.probabilities[0]).toBeCloseTo(0.9);
    expect(a.probabilities.reduce((s: number, p: number) => s + p, 0)).toBeCloseTo(1, 6);
    expect(a.confidence).toBeGreaterThan(0);
    expect(a.confidence).toBeLessThanOrEqual(1);
  });
});

describe("LayaMockProvider — score", () => {
  test("computes expected-value mean of numeric state fields named after criteria", async () => {
    const res = await provider.evaluate({
      state: { momentum: 0.8, trend: 0.6 },
      questions: [{ type: "score", name: "quality", criteria: ["momentum", "trend"] }],
    });
    const a = res.answers.quality as { score: number; confidence: number };
    expect(a.score).toBeCloseTo(0.7);
    expect(a.confidence).toBeGreaterThan(0);
  });

  test("unknown fields contribute 0 (never NaN)", async () => {
    const res = await provider.evaluate({
      state: { momentum: 0.8 },
      questions: [{ type: "score", name: "quality", criteria: ["momentum", "missing"] }],
    });
    const a = res.answers.quality as { score: number };
    expect(a.score).toBeCloseTo(0.4);
  });

  test("nested statePath reads work", async () => {
    const res = await provider.evaluate({
      state: { stock: { momentum: 0.5 } },
      questions: [{ type: "score", name: "quality", criteria: ["momentum"], statePath: "stock" }],
    });
    const a = res.answers.quality as { score: number };
    expect(a.score).toBeCloseTo(0.5);
  });
});

describe("LayaMockProvider — noul", () => {
  test("returns p[1] validity (0.85 → gates permit) with no confidence field", async () => {
    const res = await provider.evaluate({
      state: {},
      questions: [{ type: "noul", name: "valid" }],
    });
    const a = res.answers.valid as { noul: number };
    expect(a.noul).toBeCloseTo(0.85);
    expect("confidence" in a).toBe(false);
  });
});

describe("LayaMockProvider — envelope", () => {
  test("returns provider label, model, latency", async () => {
    const res = await provider.evaluate({
      state: {},
      questions: [{ type: "noul", name: "valid" }],
    });
    expect(res.provider).toBe("laya-mock");
    expect(res.model).toBe("laya-mock");
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test("health reports ok — deterministic mock, real gated behind DECISION_LAYA_REAL=1", async () => {
    const h = await provider.health();
    expect(h.ok).toBe(true);
    expect(h.detail).toContain("laya-mock");
    expect(h.detail).toContain("DECISION_LAYA_REAL=1");
  });
});