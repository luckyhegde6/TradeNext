/**
 * Laya minimal `system_one` decode agent (spec 18 §4.D — plan step 16;
 * extraction plan §5.3 — agent.py port).
 *
 * Pipeline per request: every question → `_toInternal` → `buildSequence` →
 * ONE collated batch → ONE chained forward → per-row decode:
 *
 *   k = len(markers); t = temperature_by_options[temp_bucket(qt,k)] ?? temperature[qt]
 *   z = logits[r,0:k] / t; p = max-sub softmax(z)
 *   choice → choice: keys[argmax], probabilities {key: v}, confidence, action
 *   score  → score: Σ i·pᵢ, legend {str(i): c}, probabilities {str(i): v}, confidence, action
 *   noul   → noul: p[1], confidence: max(p1, 1−p1), action
 *   confidence = round(confidence_from_probs(p, k), 4)   (half-even, Python round)
 *   usage.input_tokens = Σ attention_mask; output_tokens = 0
 *
 * Parity notes under the D2 self-consistency gate:
 *  - `_toInternal` choice: criteria options become dict keys {c: None}
 *    (Python `_to_internal`), which `renderOptions` renders as plain keys —
 *    0/false remain real descriptions, only null/"" are "none".
 *  - `k` is the question's OWN real marker count (Python `len(markers)`), taken
 *    BEFORE the decision model's K>=2 pad — padded slots beyond k are never
 *    decoded from.
 *  - `action.actProbability` = softmax(act_logits)[1] — the act head's second
 *    class ("act"); null when the graph omits act_logits (never fabricated).
 *  - Temperatures come from the load-time CLAMPED tables ([0.5, 5.0] — Python
 *    agent.py clamps at load and records rejects) via `calibrateTemperature`.
 *  - The `"options exceed head_max_len"` guard lives here in system_one
 *    (Python validates in system_one, not build_sequence).
 *
 * Deps: the tokenizer + decision model are lazy singletons (D6) — this module
 * imports no native package statically; the provider imports this file
 * directly and the barrel stays dep-free.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { DecisionQuestion } from "../decision/types";
import { buildSequence } from "./buildSequence";
import {
  calibrateTemperature,
  clampedTemperatureTables,
  confidenceFromProbs,
  type LayaRuntimeConfig,
} from "./calibration";
import { collateItems } from "./collate";
import { getLayaDecisionModel, layaModelAvailable, type LayaDecisionModel } from "./decisionModel";
import { qtypeIndex, type QtypeIndex } from "./qtypes";
import { renderOptions, type InternalQuestion } from "./serialize";
import { getLayaTokenizer, layaWeightsDir, tokenizerAvailable, type TokenizerLike } from "./tokenizer";

export const LAYA_CONFIG_JSON = "rl_agent_config.json";
export const LAYA_AGENT_MODEL = "laya-rl-agent" as const;

export interface LayaAction {
  actProbability: number;
}

/** Python §5.3 answer shapes. `probabilities`/`legend` are dicts keyed per Python. */
export type LayaAnswer =
  | {
      type: "choice";
      choice: string;
      probabilities: Record<string, number>;
      confidence: number;
      action: LayaAction | null;
    }
  | {
      type: "score";
      score: number;
      legend: Record<string, string>;
      probabilities: Record<string, number>;
      confidence: number;
      action: LayaAction | null;
    }
  | { type: "noul"; noul: number; confidence: number; action: LayaAction | null };

export interface LayaAnswers {
  model: typeof LAYA_AGENT_MODEL;
  answers: Record<string, LayaAnswer>;
  usage: { inputTokens: number; outputTokens: 0 };
}

export interface LayaAgentHealth {
  loaded: boolean;
  hiddenDim: number;
  loadMs: number;
  forwards: number;
  lastForwardMs: number | null;
  modelLatencyMs: number | null;
  configRejected: string[];
  detail: string;
}

/** Python `round(x, digits)` — half-even rounding of the EXACT binary value.
 *  CPython rounds the exact rational (printf-family), so e.g. `round(2.675, 2)
 *  == 2.67` (the double is a hair below the tie) and `round(0.5) == 0` (an
 *  exact tie rounds to even; V8 `toFixed` would wrongly give 1.0). Implemented
 *  with BigInt exact arithmetic: value = m·2^e, scaled = m·5^d·2^(e+d), compare
 *  the remainder against half the divisor, ties to even. `Number(scaled)/10^d`
 *  mirrors CPython's `float(rounded)/10**d` conversion path. */
export function pyRound(value: number, digits = 4): number {
  if (!Number.isFinite(value)) return value;
  const d = Math.max(0, Math.trunc(digits));

  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, false);
  const bits = view.getBigUint64(0, false);
  const neg = (bits >> BigInt(63)) === BigInt(1);
  const expBits = Number((bits >> BigInt(52)) & BigInt(0x7ff));
  const frac = bits & BigInt(0xfffffffffffff);
  const m = expBits === 0 ? frac : frac | BigInt(0x10000000000000);
  const e = expBits === 0 ? -1074 : expBits - 1023 - 52;

  const shift = BigInt(e + d);
  if (shift >= BigInt(0)) return value; // scaled value is an exact integer: no rounding delta

  const divisor = BigInt(1) << -shift;
  const scaledM = m * BigInt(5) ** BigInt(d);
  const intPart = scaledM >> -shift;
  const rem = scaledM - (intPart << -shift);
  const half = divisor >> BigInt(1);

  let scaled = intPart;
  if (rem > half) scaled = intPart + BigInt(1);
  else if (rem === half) scaled = (intPart & BigInt(1)) === BigInt(0) ? intPart : intPart + BigInt(1); // tie → even

  const pow10 = BigInt(10) ** BigInt(d);
  return Number(neg ? -scaled : scaled) / Number(pow10);
}

/** Max-subtraction softmax (Python `softmax(z)` stability form). */
export function maxSubSoftmax(z: number[]): number[] {
  let max = -Infinity;
  for (const v of z) if (v > max) max = v;
  const exps = z.map((v) => Math.exp(v - max));
  const sum = exps.reduce((s, v) => s + v, 0);
  return exps.map((v) => v / sum);
}

/** True when all three runtime artifacts exist (test gate; CI has none). */
export function layaAgentAvailable(dir: string = layaWeightsDir()): boolean {
  return layaModelAvailable(dir) && tokenizerAvailable() && existsSync(join(dir, LAYA_CONFIG_JSON));
}

/** `_to_internal`: DecisionQuestion → InternalQuestion (choice crit = {c: None}). */
export function toInternal(q: DecisionQuestion): InternalQuestion {
  const ins = typeof q.instruction === "string" ? q.instruction : "";
  if (q.type === "choice") {
    const crit: Record<string, unknown> = {};
    for (const opt of q.options) crit[opt] = null;
    return { t: "choice", ins, crit };
  }
  if (q.type === "score") return { t: "score", ins, crit: q.criteria };
  return { t: "noul", ins };
}

export interface ClampedTemps {
  temperature: number[];
  temperatureByOptions: Record<string, number>;
  rejected: string[];
}

/**
 * §5.3 per-row decode — pure function of its inputs.
 * `temps` = the load-time clamped tables; `k` = real marker count (>= 2
 * post-pad); `actRow` = the row's act-head logits or null.
 */
export function decodeQuestion(
  iq: InternalQuestion,
  temps: ClampedTemps,
  k: number,
  rowLogits: number[],
  actRow: number[] | null,
): LayaAnswer {
  const t = calibrateTemperature(temps, qtypeIndex(iq.t), k);
  const z = rowLogits.slice(0, k).map((v) => v / t);
  const p = maxSubSoftmax(z);
  const confidence = pyRound(confidenceFromProbs(p, k), 4);
  const action = actRow ? { actProbability: pyRound(maxSubSoftmax(actRow)[1] ?? maxSubSoftmax(actRow)[0], 4) } : null;

  if (iq.t === "choice") {
    const keys = iq.crit && !Array.isArray(iq.crit) ? Object.keys(iq.crit) : [];
    let argmax = 0;
    for (let i = 1; i < k; i++) if (p[i] > p[argmax]) argmax = i;
    const probabilities: Record<string, number> = {};
    keys.forEach((key, i) => {
      probabilities[key] = pyRound(p[i] ?? 0, 4);
    });
    return { type: "choice", choice: keys[argmax] ?? "", probabilities, confidence, action };
  }

  if (iq.t === "score") {
    const crit = Array.isArray(iq.crit) ? (iq.crit as string[]) : [];
    let sum = 0;
    for (let i = 0; i < k; i++) sum += i * (p[i] ?? 0);
    const legend: Record<string, string> = {};
    const probabilities: Record<string, number> = {};
    for (let i = 0; i < k; i++) {
      legend[String(i)] = crit[i] ?? String(i);
      probabilities[String(i)] = pyRound(p[i] ?? 0, 4);
    }
    return { type: "score", score: pyRound(sum, 4), legend, probabilities, confidence, action };
  }

  const p1 = p[1] ?? 0;
  return { type: "noul", noul: pyRound(p1, 4), confidence: pyRound(Math.max(p1, 1 - p1), 4), action };
}

/**
 * LayaAgent — minimal RL agent: load-time clamped config + tokenizer + model
 * singletons, then per-question `systemOne` decode.
 */
export class LayaAgent {
  private lastModelMs: number | null = null;

  private constructor(
    private readonly tok: TokenizerLike,
    private readonly model: LayaDecisionModel,
    private readonly clamped: ClampedTemps,
    private readonly loadMs: number,
  ) {}

  static async load(dir: string = layaWeightsDir()): Promise<LayaAgent> {
    const t0 = performance.now();
    const raw = readRuntimeConfig(dir);
    const clamped = clampedTemperatureTables(raw);
    const [tok, model] = await Promise.all([getLayaTokenizer(dir), getLayaDecisionModel(dir)]);
    return new LayaAgent(tok, model, clamped, performance.now() - t0);
  }

  /**
   * system_one: one chained forward PER question, then §5.3 decode.
   * The exported ONNX graphs are single-sequence only — a multi-row batch gets
   * flattened to one long sequence (head expects B*L tokens; verified
   * 2×138 → 276 → Add-broadcast crash), so the JS runtime serves questions
   * with independent 1-row forwards. Decode is per-row with zero cross-row
   * interaction, so the outputs are identical to the batch formulation.
   * Throws loudly on any stage failure (never swallows; client owns retry).
   */
  async systemOne(state: unknown, questions: DecisionQuestion[]): Promise<LayaAnswers> {
    if (questions.length === 0) throw new Error("laya agent: no questions");
    const started = Date.now();

    const answers: Record<string, LayaAnswer> = {};
    let inputTokens = 0;
    for (const q of questions) {
      const iq = toInternal(q);
      const seq = buildSequence(this.tok, state as string | Record<string, unknown> | unknown[], iq);
      const order = renderOptions(iq);
      if (seq.markers.length !== order.length) {
        throw new Error("options exceed head_max_len");
      }
      const batch = collateItems(
        [[{ ids: seq.ids, markers: seq.markers, qtype: qtypeIndex(iq.t) }]],
        this.tok.padTokenId,
      );
      if (!batch) throw new Error("laya agent: collate failed for non-empty batch");
      const forward = await this.model.forward(batch);
      inputTokens += batch.attentionMask.flat().reduce((s, v) => s + v, 0);

      const k = seq.markers.length;
      const rowLogits = Array.from(forward.logits.slice(0, k));
      const actRow = forward.actLogits
        ? Array.from(forward.actLogits.slice(0, Math.min(2, forward.actLogits.length)))
        : null;
      answers[q.name] = decodeQuestion(iq, this.clamped, k, rowLogits, actRow);
    }
    this.lastModelMs = Date.now() - started;

    return { model: LAYA_AGENT_MODEL, answers, usage: { inputTokens, outputTokens: 0 } };
  }

  health(): LayaAgentHealth {
    const mh = this.model.health();
    return {
      loaded: true,
      hiddenDim: mh.hiddenDim,
      loadMs: this.loadMs,
      forwards: mh.forwards,
      lastForwardMs: mh.lastForwardMs,
      modelLatencyMs: this.lastModelMs,
      configRejected: this.clamped.rejected,
      detail: `laya-rl-agent (v1 int8, local) — hidden ${mh.hiddenDim}, loadMs ${Math.round(this.loadMs)}, forwards ${mh.forwards}, lastForwardMs ${mh.lastForwardMs ?? "n/a"}, modelLatencyMs ${this.lastModelMs ?? "n/a"}ms, configRejected ${this.clamped.rejected.length}`,
    };
  }
}

/** Parse + minimal-shape validate rl_agent_config.json (throws loud, never silent).
 *  The on-disk file is Python-written (snake_case `temperature_by_options`);
 *  we map it to the camelCase `LayaRuntimeConfig` the P1 API consumes. */
export function readRuntimeConfig(dir: string): LayaRuntimeConfig {
  const file = join(dir, LAYA_CONFIG_JSON);
  if (!existsSync(file)) throw new Error(`laya agent: config missing (${file})`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`laya agent: config unparseable (${file}): ${err instanceof Error ? err.message : String(err)}`);
  }
  const cfg = parsed as Record<string, unknown>;
  const temperature = cfg["temperature"];
  const byOptions = cfg["temperature_by_options"] ?? cfg["temperatureByOptions"];
  if (
    !Array.isArray(temperature) ||
    typeof byOptions !== "object" ||
    byOptions === null
  ) {
    throw new Error(`laya agent: config missing temperature tables (${file})`);
  }
  return { temperature: temperature as number[], temperatureByOptions: byOptions as Record<string, number> };
}

let singleton: Promise<LayaAgent> | null = null;

/** Lazy singleton (D6): failed load clears itself for retry. */
export function getLayaAgent(dir: string = layaWeightsDir()): Promise<LayaAgent> {
  if (!singleton) {
    singleton = LayaAgent.load(dir).catch((err) => {
      singleton = null;
      throw err;
    });
  }
  return singleton;
}