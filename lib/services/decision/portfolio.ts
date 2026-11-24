// lib/services/decision/portfolio.ts
// Portfolio-manager perspective — pure risk math from OHLCV bars.
// First-principles: volatility, max drawdown, Sharpe — deterministic, no AI.

export interface RiskStats {
  volatilityStd: number | null; // std of daily returns
  maxDrawdownPct: number | null; // worst peak-to-trough, 0..1
  sharpeRatio: number | null; // simple avg return / vol, null when vol ~0
}

function returns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const d = (closes[i] - closes[i - 1]) / closes[i - 1];
    if (Number.isFinite(d)) out.push(d);
  }
  return out;
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function riskStats(closes: number[]): RiskStats {
  const rets = returns(closes);
  const n = rets.length;
  const m = mean(rets);
  if (!n || m === null) return { volatilityStd: null, maxDrawdownPct: null, sharpeRatio: null };
  const vol = Math.sqrt(rets.reduce((a, r) => a + (r - m) ** 2, 0) / (n - 1));
  // Max drawdown from running peak
  let peak = closes[0];
  let dd = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > peak) peak = closes[i];
    else dd = Math.max(dd, (peak - closes[i]) / peak);
  }
  const sharpe = vol > 0 ? (m / vol) * Math.sqrt(252) : null;
  return { volatilityStd: vol, maxDrawdownPct: dd, sharpeRatio: sharpe };
}

/** Simple position sizing (first principles): base 1% of account, scaled by drawdown/vol. */
export function positionSizePct(riskStatsOut: RiskStats, basePct = 1): number {
  const vol = riskStatsOut.volatilityStd ?? 0;
  const dd = riskStatsOut.maxDrawdownPct ?? 0;
  const volScale = vol > 0 ? Math.min(1.5, 0.5 / vol) : 1;
  const ddScale = Math.max(0.25, Math.min(1.5, 1 - dd * 5));
  return Math.round(basePct * volScale * ddScale * 10) / 10;
}
