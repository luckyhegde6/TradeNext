// lib/services/decision/layaProvider.ts
// ph22 Decision engine — Laya provider (spec §4.D).
//
// Laya (convaiinnovations/laya, Apache-2.0, local non-autoregressive) is THE
// provider for the decision engine (TypeSafe/Jev is out of scope by design —
// this repo runs a local, free, calibrated engine, no hosted dependency).
//
// Real inference is gated behind the spike parity work (P1 build_sequence →
// P2 tokenizer WASM → P3 int8 backbone; verdict APPROVE at v3.40.8). Until
// then this provider emits DETERMINISTIC mock answers ALIGNED WITH LAYA'S
// DECODE CONTRACT so every consumer behaves the same against mock or real:
//   choice → keys[argmax] with peaked per-option probabilities
//   score  → Σ i·pᵢ expected value over criteria (weighted mean of numeric
//            `state` fields named after each criterion)
//   noul   → p[1] = 0.85 (high validity — gates permit)
//   confidence = shape(probabilities) — peaked = confident, flat = uncertain
// Answers NEVER hallucinate target levels; they only rank/select/gate.
// When the P1–P3 ports land, this class keeps its shape and swaps the mock
// math for the real engine (`modelPath` for the ONNX runtime: 503MB int8).
import logger from "@/lib/logger";
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
      detail: "laya-mock (deterministic; real Laya inference gated behind P1–P3 parity work)",
    };
  }
}