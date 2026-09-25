// lib/services/decision/fusion.ts
// ph22 Decision engine — weighted composite scoring (spec §4.F).
//
// Composite = weighted mean of per-factor scores (criteria named after the
// rubric's factors), each factor gated individually at read-only risk, then
// combined conservatively (worst gate wins). DETERMINISTIC + local: no engine
// call — POC A (screener pass) must stay synchronous and non-blocking, so the
// engine provider (Laya) can be dropped in later behind the same rubric shape.
import { decide, shapeConfidence } from "./gate";
import type { Gate } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One rubric factor: a criterion label + weight + local extractor. */
export interface RubricFactor {
  /** Criterion label — mirrors a future engine score-question name. */
  criterion: string;
  weight: number;
  /**
   * Pull the raw 0..1 evidence out of the state. Returns undefined when the
   * state carries no data for this factor (treated as missing evidence).
   */
  extract: (state: Record<string, unknown>) => number | undefined;
}

export interface Rubric {
  name: string;
  factors: RubricFactor[];
}

export interface FactorOutcome {
  criterion: string;
  score: number;
  confidence: number;
  gate: Gate;
  /** False when the state had no data for this factor (score = 0). */
  present: boolean;
}

export interface CompositeOutcome {
  rubricName: string;
  composite: number;
  confidence: number;
  /** Conservative: the worst (lowest-severity) factor gate. */
  gate: Gate;
  factors: FactorOutcome[];
  provider: "local";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Gate severity for conservative fusion: escalate is worst, act is best. */
const GATE_SEVERITY: Record<Gate, number> = { escalate: 0, review: 1, act: 2 };

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Local confidence for a single factor: peakedness of [score, 1−score].
 * A strong factor (score → 1) reads as peaked → high confidence; a weak one
 * (score ≈ 0.5) reads as flat → ~0 confidence. Deterministic, matches the
 * shapeConfidence contract used by the engine.
 */
function factorConfidence(score: number): number {
  return shapeConfidence([clamp01(score), 1 - clamp01(score)]);
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Score a state against a rubric. Composite = weighted mean of factor scores;
 * overall confidence = weighted mean of factor confidences; overall gate is
 * the WORST factor gate (escalate > review > act) — a single weak/absent
 * factor blocks auto-action, which is the desired conservative default.
 */
export function scoreCandidate(
  state: Record<string, unknown>,
  rubric: Rubric,
): CompositeOutcome {
  const weightTotal = rubric.factors.reduce((sum, f) => sum + Math.max(0, f.weight), 0);

  if (weightTotal <= 0 || rubric.factors.length === 0) {
    return {
      rubricName: rubric.name,
      composite: 0,
      confidence: 0,
      gate: "escalate",
      factors: [],
      provider: "local",
    };
  }

  const factors: FactorOutcome[] = rubric.factors.map((f) => {
    const raw = f.extract(state);
    const present = typeof raw === "number" && Number.isFinite(raw);
    const score = clamp01(present ? (raw as number) : 0);
    const confidence = present ? factorConfidence(score) : 0;
    return {
      criterion: f.criterion,
      score,
      confidence,
      gate: present ? decide(confidence, "read-only") : "escalate",
      present,
    };
  });

  let composite = 0;
  let confidence = 0;
  let worst: Gate = "act";
  for (let i = 0; i < factors.length; i++) {
    const w = Math.max(0, rubric.factors[i].weight);
    composite += w * factors[i].score;
    confidence += w * factors[i].confidence;
    const severity = GATE_SEVERITY[factors[i].gate];
    if (severity < GATE_SEVERITY[worst]) worst = factors[i].gate;
  }
  composite = clamp01(composite / weightTotal);
  confidence = clamp01(confidence / weightTotal);

  return {
    rubricName: rubric.name,
    composite,
    confidence,
    gate: worst,
    factors,
    provider: "local",
  };
}

// ---------------------------------------------------------------------------
// POC A — unified-screener rubric
// ---------------------------------------------------------------------------

/**
 * Default rubric for the screener POC A pass (DECISION_POC_ENABLED=true).
 * Evidence comes straight from ScreenerResult fields:
 *   - momentum:    changePercent scaled to 0..1 on a cap of ±5% (5%+ ⇒ 1)
 *   - signalSupport: screenerCount scaled to 0..1 on a cap of 4 screeners
 * Weights: momentum 0.6 · signalSupport 0.4.
 */
export const SCREENER_POC_RUBRIC: Rubric = {
  name: "unified-screener-poc-a",
  factors: [
    {
      criterion: "momentum",
      weight: 0.6,
      extract: (state) => {
        const pct = state["changePercent"];
        return typeof pct === "number" && Number.isFinite(pct)
          ? (Math.max(-5, Math.min(5, pct)) + 5) / 10
          : undefined;
      },
    },
    {
      criterion: "signalSupport",
      weight: 0.4,
      extract: (state) => {
        const count = state["screenerCount"];
        return typeof count === "number" && Number.isFinite(count)
          ? Math.min(1, count / 4)
          : undefined;
      },
    },
  ],
};

/**
 * Convenience wrapper for the unified-screener hook: builds a state from a
 * ScreenerResult-shaped row and scores it with the default POC rubric.
 */
export function scoreScreenerResult(
  row: { changePercent?: unknown; screenerCount?: unknown },
): CompositeOutcome {
  return scoreCandidate(
    { changePercent: row.changePercent, screenerCount: row.screenerCount },
    SCREENER_POC_RUBRIC,
  );
}