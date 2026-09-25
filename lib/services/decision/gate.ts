// lib/services/decision/gate.ts
// ph22 Decision engine — confidence shaping + confidence-gated routing (spec §4.E).
//
// decide(confidence, risk) maps a calibrated confidence onto ACT / REVIEW /
// ESCALATE using per-risk threshold bands. shapeConfidence() derives a
// 0..1 confidence from a probability distribution the way Laya's
// `confidence_from_probs` does: 1 − H(p)/log₂(k) (uniform → 0, one-hot → 1).
// Providers may return their own confidence verbatim; shapeConfidence is the
// deterministic fallback / test seam.
import type { Gate, Risk } from "./types";

/** Per-risk ACT / REVIEW threshold bands (spec §4.E). */
export const GATE_THRESHOLDS: Record<Risk, { act: number; review: number }> = {
  "read-only": { act: 0.55, review: 0.35 },
  moderate: { act: 0.75, review: 0.5 },
  destructive: { act: 0.9, review: 0.7 },
};

/**
 * Route on confidence: >= act → "act" · >= review → "review" · else → "escalate".
 * Boundary-exact (confidence === act is ACT).
 */
export function decide(confidence: number, risk: Risk): Gate {
  const { act, review } = GATE_THRESHOLDS[risk];
  if (confidence >= act) return "act";
  if (confidence >= review) return "review";
  return "escalate";
}

/**
 * Confidence from a probability distribution: 1 − H(p)/log₂(k).
 * Flat (uniform) → 0 · peaked (one-hot) → 1 · empty/degnerate → 0.
 * Mirrors Laya `confidence_from_probs`; used as the deterministic fallback
 * when a provider omits confidence (e.g. mock/noul questions).
 */
export function shapeConfidence(probabilities: number[]): number {
  if (!Array.isArray(probabilities) || probabilities.length < 2) return 0;
  const total = probabilities.reduce((sum, p) => sum + Math.max(0, p), 0);
  if (total <= 0) return 0;
  const k = probabilities.length;
  if (k < 2) return 0;
  let entropy = 0;
  for (const raw of probabilities) {
    const p = Math.max(0, raw) / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  const maxEntropy = Math.log2(k);
  if (maxEntropy <= 0) return 0;
  const conf = 1 - entropy / maxEntropy;
  return Math.max(0, Math.min(1, conf));
}