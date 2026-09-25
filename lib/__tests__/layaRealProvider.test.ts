/**
 * LayaRealProvider tests (spec 18, plan step 18).
 *
 * Deterministic tier — NO weights needed:
 *  1. A provider pointed at a non-existent model dir reports health().ok=false
 *     (with the dir pin in detail) and THROWS loudly on evaluate() — the client
 *     owns retry + failure trace; never a silent mock fallback.
 *  2. mapLayaAnswers maps §5.3 dict-shaped Laya answers onto the
 *     provider-agnostic DecisionAnswer shape (action/legend are Laya trace
 *     metadata and are omitted; noul drops confidence by contract).
 *
 * Real-weights end-to-end (tokenizer + int8 ONNX in a Node-realm child process)
 * is covered by layaAgent.test.ts at the system_one level; the provider wiring
 * is verified live in Phase 6 (plan step 21: /api/admin/decision/ping with
 * DECISION_LAYA_REAL=1 → providers ["laya"]).
 *
 * @jest-environment node
 */

import { join } from "node:path";

import { LayaRealProvider, mapLayaAnswers } from "../services/decision/layaProvider";
import type { LayaAnswers } from "../services/laya/agent";

const MISSING_DIR = join("no-such", "laya", "weights", "v1");
const MODEL_LABEL_RE = /laya-rl-agent/;

describe("LayaRealProvider — missing weights (deterministic)", () => {
  const provider = new LayaRealProvider(MISSING_DIR);

  test("provider id is 'laya' (distinct from laya-mock)", () => {
    expect(provider.provider).toBe("laya");
  });

  test("health().ok is false and detail pins the missing dir", async () => {
    const h = await provider.health();
    expect(h.ok).toBe(false);
    expect(h.detail ?? "").toContain("weights missing");
    expect(h.detail ?? "").toContain(MISSING_DIR);
  });

  test("evaluate() throws loudly — never a silent mock answer", async () => {
    await expect(
      provider.evaluate({
        state: { momentum: 0.8 },
        questions: [{ type: "choice", name: "bias", options: ["buy", "hold", "sell"] }],
      }),
    ).rejects.toThrow(/weights missing/);
  });
});

describe("mapLayaAnswers — §5.3 → provider-agnostic DecisionAnswer shape", () => {
  const answers: LayaAnswers["answers"] = {
    trade: {
      type: "choice",
      choice: "sell",
      probabilities: { buy: 0.1, hold: 0.2, sell: 0.7 },
      confidence: 0.6103,
      action: { actProbability: 0.9 },
    },
    conviction: {
      type: "score",
      score: 2.3,
      legend: { "0": "weak", "1": "medium", "2": "strong" },
      probabilities: { "0": 0.1, "1": 0.4, "2": 0.5 },
      confidence: 0.5,
      action: null,
    },
    valid: { type: "noul", noul: 0.91, confidence: 0.91, action: null },
  };

  const out = mapLayaAnswers(answers);

  test("choice → { choice, probabilities[], confidence }", () => {
    expect(out.trade).toEqual({
      choice: "sell",
      probabilities: [0.1, 0.2, 0.7],
      confidence: 0.6103,
    });
  });

  test("score → keeps score + probabilities in ascending key order; legend/action dropped", () => {
    expect(out.conviction).toEqual({
      score: 2.3,
      probabilities: [0.1, 0.4, 0.5],
      confidence: 0.5,
    });
  });

  test("noul → { noul } only (confidence/action are Laya trace metadata)", () => {
    expect(out.valid).toEqual({ noul: 0.91 });
  });

  test("answers preserve question-name keys", () => {
    expect(Object.keys(out)).toEqual(["trade", "conviction", "valid"]);
  });
});

describe("LayaRealProvider field contract", () => {
  test("model label is laya-rl-agent (v1 int8)", () => {
    // evaluate's model field is checked against a stable matcher for later parity
    // fixtures — kept separate from the mapping so naming drift is caught.
    expect(require("../services/decision/layaProvider").LAYA_REAL_MODEL).toMatch(MODEL_LABEL_RE);
  });
});