// lib/services/decision/types.ts
// ph22 Decision engine — shared primitives + request/response types (spec §4.A).
//
// System One "atomic questions" model: Choice / Score / Noul. Every answer
// carries calibrated probabilities where the provider supports them; routing
// happens on confidence via gate.ts. Types are provider-agnostic — Laya (local)
// and TypeSafe Jev (hosted) implement the same interface.
export type DecisionPrimitive = "choice" | "score" | "noul";

/** Atomic choice question — pick one of `options`. */
export interface ChoiceQ {
  type: "choice";
  name: string;
  options: string[];
  instruction?: string;
  statePath?: string;
}

/**
 * Atomic score question — rate on an ORDERED tuple of `criteria`.
 * Order matters: it maps 1:1 to the provider's criterion scoring protocol
 * (@typesafe-ai/sdk v0.6.0 `Score.criteria` is an ordered tuple).
 */
export interface ScoreQ {
  type: "score";
  name: string;
  criteria: string[];
  instruction?: string;
  statePath?: string;
}

/** Atomic noul question — yes/no validity probe (0..1). No confidence field. */
export interface NoulQ {
  type: "noul";
  name: string;
  instruction?: string;
  statePath?: string;
}

export type DecisionQuestion = ChoiceQ | ScoreQ | NoulQ;

export interface ChoiceAnswer {
  choice: string;
  probabilities: number[];
  confidence: number;
}

export interface ScoreAnswer {
  score: number;
  probabilities: number[];
  confidence: number;
}

export interface NoulAnswer {
  noul: number;
}

export type DecisionAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

/** Shared decision context — arbitrary JSON-able state (symbol stats, market snapshot, …). */
export interface EvaluateRequest {
  state: unknown;
  questions: DecisionQuestion[];
  /** Optional model override (provider default when omitted). */
  model?: string;
}

export interface EvaluateResponse {
  answers: Record<string, DecisionAnswer>;
  provider: string;
  model: string;
  latencyMs: number;
}

/** Confidence risk bands for decide() — see gate.ts thresholds table. */
export type Risk = "read-only" | "moderate" | "destructive";

/** Gate outcome of a decision. */
export type Gate = "act" | "review" | "escalate";