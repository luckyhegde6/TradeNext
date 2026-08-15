// lib/services/swing-types.ts
// Shared types for the Swing tab on /recommendations.
//
// PURE module — ZERO imports. Client components import types from here so the
// swing screeners' server-side chain (chartink unified runner → DB → NSE) never
// leaks into the browser bundle (mirrors the ipoIssueSize.ts client-import fix).

/** Signal family a swing screener belongs to (derived from its name/logic). */
export type SignalFamily =
  | "trend"
  | "breakout"
  | "reversal"
  | "momentum"
  | "volume"
  | "range";

/** AI swing verdict. */
export type SwingAction = "LONG" | "SHORT" | "OBSERVE";

/** Swing holding horizon. */
export type SwingTimeHorizon = "short" | "medium" | "long";

/** Momentum/indicator context computed from ~20 sessions of daily closes. */
export interface SwingIndicators {
  /** % change over the last ~10 sessions. */
  momentum10: number | null;
  /** % change over the last ~20 sessions. */
  momentum20: number | null;
  /** Daily return standard deviation over the window, in %. */
  volatility20: number | null;
  /** % below the 20-session high (0 = at the high, positive = pullback). */
  distanceFrom20dHigh: number | null;
}

/** AI target prediction for one swing stock. */
export interface SwingAnalysis {
  action: SwingAction;
  /** 0–100 conviction. */
  confidence: number;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  timeHorizon: SwingTimeHorizon;
  /** 2–3 sentence explanation — why the screener tags + indicators support the target. */
  logic: string;
  /** 0–100 AI-rated momentum setup quality. */
  momentumScore: number;
  riskFactors: string[];
}

/** One stock in the swing tab (screeners + families + indicators + AI). */
export interface SwingStock {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  /** Swing screener tags that flagged this stock. */
  screenerNames: string[];
  screenerCount: number;
  /** Market cap in ₹ (TradingView market_cap_basic when available). */
  marketCap?: number;
  /** Segregated signal families (trend/breakout/reversal/momentum/volume/range). */
  families: SignalFamily[];
  /** Chartink registry template ids that flagged this stock. */
  templateIds: string[];
  /** Data producer: chartink_db | chartink_live | tradingview. */
  source: string;
  /** Pre-AI composite rank score (0–100). */
  momentumScore: number;
  indicators: SwingIndicators;
  analysis: SwingAnalysis | null;
  analysisError: string | null;
}

/** GET /api/recommendations/swing response. */
export interface SwingResponse {
  success: boolean;
  generatedAt: string;
  templateCount: number;
  /** Unique stocks flagged before the top-N cap. */
  totalRaw: number;
  topN: number;
  /** Family → count of stocks in the top-N feed flagged with it. */
  segregation: Record<SignalFamily, number>;
  analysisStatus: "done" | "skipped" | "failed";
  /** Human-readable reason when the AI analysis failed (analysisStatus === "failed"). */
  analysisError?: string | null;
  stocks: SwingStock[];
}
