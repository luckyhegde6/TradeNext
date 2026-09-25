// lib/services/decision/provider.ts
// ph22 Decision engine — DecisionProvider interface (spec §4.B).
//
// One interface, the Laya implementation (local, mock-first until the
// P1–P3 parity gate lands; TypeSafe/Jev is out of scope by repo design).
// The client owns retry; a provider throws on transport/provider failure
// and NEVER swallows errors.
import type { EvaluateRequest, EvaluateResponse } from "./types";

export interface ProviderHealth {
  ok: boolean;
  detail?: string;
}

export interface DecisionProvider {
  /** `"laya"` | `"typesafe"` (mock mode reports `"laya-mock"`). */
  readonly provider: string;
  /**
   * Run a state + atomic questions through the provider. Returns typed-shaped
   * answers per primitive; throws on transport/provider failure (never returns
   * a partial-shaped lie — malformed answers are skipped by the caller).
   */
  evaluate(req: EvaluateRequest): Promise<EvaluateResponse>;
  /** Provider liveness probe (model loaded / API key valid). */
  health(): Promise<ProviderHealth>;
}