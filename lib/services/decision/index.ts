// lib/services/decision/index.ts — barrel for the pure decision engine.
export { analyzeStock, fuseVerdict } from "./engine";
export { runTechnicalAnalysis, swingRegime, sma, rsi, atr } from "./technical";
export { riskStats, positionSizePct } from "./portfolio";
export { runFundamentalAnalysis, ibView } from "./fundamental";
export type { DecisionConclusion, Verdict } from "./types";
