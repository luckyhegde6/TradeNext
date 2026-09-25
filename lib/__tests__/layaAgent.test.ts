/**
 * LayaAgent system_one decode tests (spec 18, plan step 17).
 *
 * Two tiers:
 *  1. PURE helpers (pyRound / maxSubSoftmax / toInternal) — always run,
 *     no weights needed; these are the §5.3 numerics in isolation.
 *  2. END-TO-END decode — weights-gated per D5 (CI has no checkpoints →
 *     suite skips). Runs in a CHILD Node process (`scripts/dev-checks/
 *     laya-agent.ts`): tokenizer WASM + onnxruntime-node create their objects
 *     in Node's main realm, which fails ort's `instanceof Float32Array` guard
 *     under Jest's vm sandbox (same rationale as laya-forward.ts). The child
 *     decodes one mixed batch (choice k=3, score k=3, noul k=2) twice and
 *     emits answers/usage/health/determinism as JSON.
 *
 * @jest-environment node
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { LAYA_AGENT_MODEL, layaAgentAvailable, maxSubSoftmax, pyRound, toInternal } from "../services/laya/agent";
import { LAYA_HIDDEN_DIM } from "../services/laya/decisionModel";

const OPTIONS = ["buy", "hold", "sell"];
const CRITERIA = ["weak", "medium", "strong"];
const QUESTION_KEYS = ["trade", "conviction", "valid"];

describe("laya agent numerics (pure, no weights)", () => {
  it("pyRound matches Python round() exact-value semantics at 4dp", () => {
    // CPython rounds the EXACT binary value (printf %.4f path): 0.12345's
    // double is a hair ABOVE half → up; 2.675's and 0.12355's are a hair
    // BELOW → down (verified against CPython on this machine).
    expect(pyRound(0.12345, 4)).toBe(0.1235);
    expect(pyRound(0.12355, 4)).toBeCloseTo(0.1235, 10);
    expect(pyRound(2.675, 2)).toBeCloseTo(2.67, 10); // famous float: 2.675 → 2.67
    expect(pyRound(0.5, 0)).toBe(0);
    expect(pyRound(1.5, 0)).toBe(2);
    expect(pyRound(2.5, 0)).toBe(2);
    expect(pyRound(3.5, 0)).toBe(4);
  });

  it("maxSubSoftmax is stable under large logits (max-subtraction form)", () => {
    expect(maxSubSoftmax([0, 0])).toHaveLength(2);
    expect(maxSubSoftmax([0, 0])[0]).toBeCloseTo(0.5, 10);
    const big = maxSubSoftmax([1e9, 0, -1e9]);
    expect(big[0]).toBeCloseTo(1, 12);
    expect(big[2]).toBeCloseTo(0, 12);
    expect(big.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
  });

  it("toInternal maps DecisionQuestion → InternalQuestion per _to_internal", () => {
    const choice = toInternal({ name: "t", type: "choice", options: OPTIONS, instruction: "x" });
    expect(choice.t).toBe("choice");
    expect(choice.ins).toBe("x");
    expect(choice.crit).toEqual({ buy: null, hold: null, sell: null });

    const score = toInternal({ name: "s", type: "score", criteria: CRITERIA, instruction: "y" });
    expect(score.t).toBe("score");
    expect(score.crit).toEqual(CRITERIA);

    const noul = toInternal({ name: "n", type: "noul", instruction: "z" });
    expect(noul.t).toBe("noul");
    expect(noul.crit).toBeUndefined();

    const noIns = toInternal({ name: "c", type: "choice", options: ["a", "b"] });
    expect(noIns.ins).toBe("");
    const badIns = toInternal({ name: "c2", type: "noul", instruction: 42 as unknown as string });
    expect(badIns.ins).toBe("");
  });
});

const maybeDescribe = layaAgentAvailable() ? describe : describe.skip;

interface LayaAnswerOut {
  type: string;
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
  score?: number;
  legend?: Record<string, string>;
  noul?: number;
  action?: { actProbability: number } | null;
}

interface ProbeOut {
  available: boolean;
  model?: string;
  questionKeys?: string[];
  answers?: Record<string, LayaAnswerOut>;
  usage?: { inputTokens: number; outputTokens: number };
  determinismEqual?: boolean;
  health?: {
    loaded: boolean;
    hiddenDim: number;
    loadMs: number;
    forwards: number;
    lastForwardMs: number | null;
    modelLatencyMs: number | null;
    configRejected: string[];
  };
}

maybeDescribe("laya agent system_one decode (weights, child-process)", () => {
  let probe: ProbeOut;

  beforeAll(() => {
    const script = join(process.cwd(), "scripts", "dev-checks", "laya-agent.ts");
    const raw = execFileSync(process.execPath, ["--import", "tsx", script], {
      encoding: "utf8",
      timeout: 120_000,
    });
    probe = JSON.parse(raw) as ProbeOut;
    if (!probe || probe.available !== true) {
      throw new Error(`laya-agent probe did not run: ${raw.slice(0, 200)}`);
    }
  }, 60_000);

  const is4dp = (v: number): boolean => Math.abs(Math.round(v * 10000) - v * 10000) < 1e-6;

  it("answers every question and identifies the model", () => {
    expect(probe.model).toBe(LAYA_AGENT_MODEL);
    expect(probe.questionKeys).toEqual(QUESTION_KEYS);
    expect(Object.keys(probe.answers ?? {})).toEqual(QUESTION_KEYS);
  });

  it("decodes the choice question: keys[argmax], dict probabilities, 4dp confidence", () => {
    const a = probe.answers?.trade;
    expect(a?.type).toBe("choice");
    expect(OPTIONS).toContain(a?.choice);
    const keys = Object.keys(a?.probabilities ?? {});
    expect(keys).toEqual(OPTIONS);
    const p = a?.probabilities ?? {};
    const sum = OPTIONS.reduce((s, o) => s + (p[o] ?? 0), 0);
    expect(sum).toBeGreaterThan(0.99);
    expect(sum).toBeLessThan(1.01);
    expect(a?.confidence).toBeGreaterThanOrEqual(0);
    expect(a?.confidence).toBeLessThanOrEqual(1);
    expect(is4dp(a!.confidence as number)).toBe(true);
  });

  it("choice argmax consistency: the chosen option carries the max probability", () => {
    const a = probe.answers?.trade;
    const p = a?.probabilities ?? {};
    const max = Math.max(...OPTIONS.map((o) => p[o] ?? 0));
    expect(p[a?.choice ?? ""]).toBeCloseTo(max, 6);
  });

  it("choice carries the act head probability (act_logits emitted for qtype=0)", () => {
    const a = probe.answers?.trade;
    expect(a?.action).not.toBeNull();
    const ap = a?.action?.actProbability ?? -1;
    expect(ap).toBeGreaterThanOrEqual(0);
    expect(ap).toBeLessThanOrEqual(1);
    expect(is4dp(ap)).toBe(true);
  });

  it("decodes the score question: Σ i·p_i, legend + dict probabilities", () => {
    const a = probe.answers?.conviction;
    expect(a?.type).toBe("score");
    expect(a?.legend).toEqual({ "0": "weak", "1": "medium", "2": "strong" });
    const p = a?.probabilities ?? {};
    expect(Object.keys(p)).toEqual(["0", "1", "2"]);
    const expected = Object.entries(p).reduce((s, [k, v]) => s + Number(k) * v, 0);
    expect(a?.score).toBeCloseTo(expected, 3);
    expect(a!.score as number).toBeGreaterThanOrEqual(0);
    expect(a!.score as number).toBeLessThanOrEqual(2); // max index for k=3
    expect(is4dp(a!.score as number)).toBe(true);
  });

  it("decodes the noul question: p[1] with confidence max(p1, 1−p1)", () => {
    const a = probe.answers?.valid;
    expect(a?.type).toBe("noul");
    expect(a!.noul as number).toBeGreaterThanOrEqual(0);
    expect(a!.noul as number).toBeLessThanOrEqual(1);
    const noul = a?.noul ?? 0;
    expect(a?.confidence).toBeCloseTo(Math.max(noul, 1 - noul), 2); // rounded 4dp, ≤1e-4 slack
    expect(is4dp(a!.noul as number)).toBe(true);
    expect(is4dp(a!.confidence as number)).toBe(true);
  });

  it("usage: inputTokens = Σ attention (integer > 0), outputTokens 0", () => {
    expect(probe.usage?.inputTokens).toBeGreaterThan(0);
    expect(Number.isInteger(probe.usage?.inputTokens)).toBe(true);
    expect(probe.usage?.outputTokens).toBe(0);
  });

  it("decode is deterministic across repeated system_one calls", () => {
    expect(probe.determinismEqual).toBe(true);
  });

  it("health: hidden 1024, loadMs, forwards, agent latency + real config clamp rejects", () => {
    const h = probe.health;
    expect(h?.loaded).toBe(true);
    expect(h?.hiddenDim).toBe(LAYA_HIDDEN_DIM);
    expect(h?.loadMs).toBeGreaterThan(0);
    expect(h?.forwards).toBeGreaterThanOrEqual(2);
    expect(h?.lastForwardMs).not.toBeNull();
    expect(h?.modelLatencyMs).not.toBeNull();
    expect(Array.isArray(h?.configRejected)).toBe(true);
    // v1 rl_agent_config.json ships choice:11+ = 0.10058 → load-time clamp to 0.5
    expect(h?.configRejected.join(",")).toContain("choice:11+");
  });
});