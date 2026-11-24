// lib/services/decision/types.ts
// Pure decision-engine types — IB + PM + expert swing trader perspectives.

export type Verdict = "BUY" | "HOLD" | "SELL";

export interface DecisionConclusion {
  symbol: string;
  perspectives: {
    /** Investment banker view (fundamentals + valuation). */
    ib: string;
    /** Portfolio manager view (risk + position sizing). */
    pm: string;
    /** Expert swing-trader view (technicals, levels, targets). */
    swing: string;
  };
  verdict: Verdict;
  rationale: string;
  /** Fused confidence, 0–1, from the presence + strength of the perspectives. */
  confidence: number;
  signals?: { entry?: number; target?: number; stopLoss?: number; regime?: string };
  updatedAt: string;
}
