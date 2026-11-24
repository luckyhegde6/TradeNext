// lib/services/decision/engine.ts
// Pure new decision engine — "investment banker + portfolio manager + expert
// swing trader" perspectives, fused from NSE data. Deterministic math — no PoC,
// no mocks, no external AI. Entry point: analyzeStock(symbol).

import { fetchSecurityWiseHistoricalData, securityWiseBarsToOHLCV } from "@/lib/nse-api";
import { runFundamentalAnalysis, ibView } from "./fundamental";
import { riskStats, positionSizePct } from "./portfolio";
import { runTechnicalAnalysis, swingRegime, type SwingTechnicals } from "./technical";
import type { DecisionConclusion, Verdict } from "./types";

const HIST_DAYS = 200;

function fmtDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${day}-${m}-${String(d.getFullYear()).slice(-2)}`;
}

function dateFromDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return fmtDate(d);
}

/** Fuse the three perspective scores into a verdict (first principles: mean of present perspectives). */
export function fuseVerdict(ibScore: number | null, pmScore: number | null, swingScore: number | null): Verdict {
  const parts: number[] = [];
  if (ibScore !== null) parts.push(ibScore);
  if (pmScore !== null) parts.push(pmScore);
  if (swingScore !== null) parts.push(swingScore);
  if (parts.length === 0) return "HOLD";
  const mean = parts.reduce((a, b) => a + b, 0) / parts.length;
  return mean >= 0.6 ? "BUY" : mean <= -0.4 ? "SELL" : "HOLD";
}

export async function analyzeStock(symbol: string): Promise<DecisionConclusion> {
  const bars = securityWiseBarsToOHLCV(
    await fetchSecurityWiseHistoricalData(symbol, dateFromDaysAgo(HIST_DAYS), dateFromDaysAgo(0)),
  );
  const closes = bars.map((b) => b.close);
  const toN = (n: number | undefined) => (n !== undefined ? Math.round((n + Number.EPSILON) * 100) / 100 : undefined);

  const [fundamentals, tech, risk] = await Promise.all([
    runFundamentalAnalysis(symbol),
    runTechnicalAnalysis(closes),
    riskStats(closes),
  ]);

  // ── IB (investment banker) score from fundamentals ─────────────────────
  const ibScore = fundamentals && Object.keys(fundamentals).length > 0 ? 1 : null;

  // ── PM (portfolio manager) score from risk stats ──────────────────────
  let pmScore: number | null = null;
  if (risk.maxDrawdownPct !== null) {
    const dd = risk.maxDrawdownPct * 100;
    pmScore = dd > 20 ? -1 : dd > 10 ? 0 : dd > 0 ? 1 : 1;
  }

  // ── Swing (expert swing trader) score from technicals + regime ─────────
  const swingScore = tech.swingScore !== undefined ? tech.swingScore : null;
  const regime = swingRegime(closes);

  const verdict = fuseVerdict(ibScore, pmScore, swingScore);

  const perspectiveLines = [
    `IB (${fundamentals ? " fundamentals: " + ibView(fundamentals) : "no fundamentals data"})`,
    `PM (${risk.maxDrawdownPct !== null ? `maxDD ${(risk.maxDrawdownPct * 100).toFixed(1)}%` : "no risk data"}; position size ${toN(positionSizePct(risk)) ?? "n/a"}%)`,
    `Swing (regime=${regime}${tech.rsi !== undefined ? `, RSI ${toN(tech.rsi)}` : ""}${tech.atr !== undefined ? `, ATR ${toN(tech.atr)}` : ""})`,
  ];

  return {
    symbol: symbol.toUpperCase(),
    perspectives: {
      ib: ibScore !== null && fundamentals ? ibView(fundamentals) : "fundamentals unavailable",
      pm: risk.maxDrawdownPct !== null
        ? `max drawdown ${(risk.maxDrawdownPct * 100).toFixed(1)}% — position sizing ${toN(positionSizePct(risk)) ?? "n/a"}%`
        : "risk stats unavailable",
      swing: tech.swingScore !== undefined
        ? `regime=${regime}, swingScore=${tech.swingScore}`
        : `regime=${regime}, no swing score`,
    },
    verdict,
    rationale: `Fused from ${perspectiveLines.length} perspectives: ${perspectiveLines.join("; ")}.`,
    confidence: swingScore !== null ? 0.5 + 0.5 * Math.abs(swingScore) : 0.3,
    signals: tech.signals,
    updatedAt: new Date().toISOString(),
  };
}

export type { Verdict };
