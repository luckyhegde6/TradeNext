// lib/services/decision/layaProvider.ts
// ph22 Decision engine — Laya provider (spec §4.D).
//
// Laya (convaiinnovations/laya, Apache-2.0, local non-autoregressive) is THE
// provider for the decision engine (TypeSafe/Jev is out of scope by design —
// this repo runs a local, free, calibrated engine, no hosted dependency).
//
// Two providers live here:
//   LayaMockProvider ("laya-mock") — the DEFAULT while DECISION_LAYA_REAL is
//     unset. Emits DETERMINISTIC answers ALIGNED WITH LAYA'S DECODE CONTRACT so
//     every consumer behaves the same against mock or real:
//       choice → keys[argmax] with peaked per-option probabilities
//       score  → Σ i·pᵢ expected value over criteria (weighted mean of numeric
//                `state` fields named after each criterion)
//       noul   → p[1] = 0.85 (high validity — gates permit)
//       confidence = shape(probabilities) — peaked = confident, flat = uncertain
//   LayaRealProvider ("laya") — selected only with DECISION_LAYA_REAL=1
//     (whitelist "1"|"true"|"yes" in client.ts). Runs the REAL local engine:
//     `lib/services/laya/agent.ts` system_one over the int8 ONNX backbone via
//     the JS ports (P1 build_sequence → P2 tokenizer WASM → P3 int8 backbone;
//     spike verdict APPROVE at v3.40.8, engine landed v3.41.x).
// Answers NEVER hallucinate target levels; they only rank/select/gate.
import logger from "@/lib/logger";
import { getLayaAgent, layaAgentAvailable, type LayaAnswers } from "../laya/agent";
import { layaWeightsDir } from "../laya/tokenizer";
import { shapeConfidence } from "./gate";
import type { DecisionProvider, ProviderHealth } from "./provider";
import type { EvaluateResponse } from "./types";
import type { DecisionQuestion } from "./types";

const MOCK_NOUL = 0.85; // p[1] — high validity = gate permits

/** Peaked per-option probabilities: option 0 at 0.9, remainder spread evenly. */
function probabilitiesFor(k: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < k; i += 1) out.push(i === 0 ? 0.9 : 0.1 / (k - 1));
  return out;
}

/** Pull numeric fields from `state` (nested dotted paths supported). */
function readStateNumber(state: unknown, path: string): number {
  const parts = path.split(".");
  let cur: unknown = state;
  for (const part of parts) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return Number.NaN;
    }
  }
  if (typeof cur === "number" && Number.isFinite(cur)) return cur;
  return Number.NaN;
}

/**
 * Ensures the denominator `k` for confidence shaping ≥ 2 (degenerate
 * one-option questions get a deterministic spread).
 */
function safeProbabilities(k: number): number[] {
  return probabilitiesFor(Math.max(2, k));
}

export class LayaMockProvider implements DecisionProvider {
  readonly provider = "laya-mock";

  async evaluate(req: Parameters<DecisionProvider["evaluate"]>[0]): Promise<EvaluateResponse> {
    const started = Date.now();
    const answers: EvaluateResponse["answers"] = {};
    const state = req.state;
    for (const q of req.questions as DecisionQuestion[]) {
      if (q.type === "choice") {
        const probs = safeProbabilities(q.options.length);
        answers[q.name] = {
          choice: q.options[0] ?? "", // keys[argmax] → option 0 under the peaked spread
          probabilities: probs,
          confidence: shapeConfidence(probs),
        };
      } else if (q.type === "score") {
        const vals = q.criteria.map((c) => {
          const v = q.statePath ? readStateNumber(state, `${q.statePath}.${c}`) : readStateNumber(state, c);
          return Number.isNaN(v) ? 0 : Math.max(0, Math.min(1, v));
        });
        // Σ i·pᵢ expected value — a weighted mean of the criterion scores.
        const score =
          vals.length > 0
            ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100
            : 0;
        const probs = safeProbabilities(2);
        answers[q.name] = { score, probabilities: probs, confidence: shapeConfidence(probs) };
      } else {
        // noul → validity p[1]; no confidence field per the primitive contract.
        answers[q.name] = { noul: MOCK_NOUL };
      }
    }
    logger.info({
      msg: "Decision engine (laya-mock) evaluated",
      questions: req.questions.length,
      provider: this.provider,
    });
    return { answers, provider: this.provider, model: "laya-mock", latencyMs: Date.now() - started };
  }

  async health(): Promise<ProviderHealth> {
    return {
      ok: true,
      detail: "laya-mock (deterministic; real Laya inference gated behind DECISION_LAYA_REAL=1)",
    };
  }
}

/** `model` label surfaced on real EvaluateResponse (spec 18 §4.D). */
export const LAYA_REAL_MODEL = "laya-rl-agent (v1 int8)";

/**
 * Map Laya system_one answers (dict-shaped per §5.3) onto the provider-agnostic
 * `DecisionAnswer` shape. `action`/`legend` are Laya trace metadata (kept on
 * `LayaAnswers` for observability) and are omitted per spec §4.A; noul drops
 * confidence by contract (NoulAnswer has no confidence field).
 */
export function mapLayaAnswers(answers: LayaAnswers["answers"]): EvaluateResponse["answers"] {
  const out: EvaluateResponse["answers"] = {};
  for (const [name, a] of Object.entries(answers)) {
    if (a.type === "choice") {
      out[name] = { choice: a.choice, probabilities: Object.values(a.probabilities), confidence: a.confidence };
    } else if (a.type === "score") {
      out[name] = { score: a.score, probabilities: Object.values(a.probabilities), confidence: a.confidence };
    } else {
      out[name] = { noul: a.noul };
    }
  }
  return out;
}

/**
 * Real Laya inference (spec 18 §4.D). Lazy singleton engine (`getLayaAgent`):
 * tokenizer + int8 ONNX backbone are loaded on first use and cached. Model dir
 * = `DECISION_LAYA_MODEL_DIR ?? lib/services/laya/weights/v1` (default via
 * `layaWeightsDir()`; the constructor accepts an override for tests).
 *
 * evaluate() throws loudly on missing weights / load / decode failure — the
 * client owns retry + failure trace; NEVER a silent mock fallback. health()
 * reports ok + loaded status + source pin.
 */
export class LayaRealProvider implements DecisionProvider {
  readonly provider = "laya";
  private readonly dir: string;

  constructor(dir: string = layaWeightsDir()) {
    this.dir = dir;
  }

  async evaluate(req: Parameters<DecisionProvider["evaluate"]>[0]): Promise<EvaluateResponse> {
    if (!layaAgentAvailable(this.dir)) {
      throw new Error(
        `laya real engine unavailable — weights missing at ${this.dir} (see docs/designDoc/ph22-laya-js-extraction-plan.md)`,
      );
    }
    const agent = await getLayaAgent(this.dir); // loud on load failure
    const started = Date.now();
    const out = await agent.systemOne(req.state, req.questions);
    const latencyMs = Date.now() - started;
    logger.info({
      msg: "Decision engine (laya real) evaluated",
      questions: req.questions.length,
      provider: this.provider,
      latencyMs,
      inputTokens: out.usage.inputTokens,
    });
    return {
      answers: mapLayaAnswers(out.answers),
      provider: this.provider,
      model: LAYA_REAL_MODEL,
      latencyMs,
    };
  }

  async health(): Promise<ProviderHealth> {
    if (!layaAgentAvailable(this.dir)) {
      return { ok: false, detail: `laya real engine unavailable — weights missing at ${this.dir}` };
    }
    try {
      const agent = await getLayaAgent(this.dir);
      const h = agent.health();
      return { ok: true, detail: `${h.detail} · source ${this.dir}` };
    } catch (err) {
      return {
        ok: false,
        detail: `laya real loader failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}