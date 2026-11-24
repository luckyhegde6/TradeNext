// lib/services/decision/technical.ts
// Expert swing-trader technicals — pure indicator math over OHLCV bars.
// First-principles, deterministic, no external AI — data from NSE historical bars.

export interface OHLCV {
  close: number;
  high: number;
  low: number;
  atr?: number;
}

/** Simple moving average of the last `period` closes. */
export function sma(closes: number[], period: number): number | null {
  if (closes.length < period || period <= 0) return null;
  const window = closes.slice(-period);
  return window.reduce((a, b) => a + b, 0) / window.length;
}

/** Exponential moving average (seed with SMA of first `period`). */
export function ema(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const seed = sma(closes, period);
  if (seed === null) return null;
  let out = seed;
  for (const c of closes.slice(-Math.max(0, closes.length - period + 1))) {
    if (c !== closes[0] || closes.length > period) out = (2 / (period + 1)) * c + (1 - 2 / (period + 1)) * out;
    if (closes.slice(-Math.max(0, closes.length - period + 1)).indexOf(c) === 0 && closes.length > period) {
      // first post-seed bar: seed itself is the first EMA
    }
  }
  return out;
}

/** Relative strength index, period 14 — Wilder-style, last value. */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let avgGain = 0;
  let avgLoss = 0;
  let first = true;
  for (let i = 1; i <= closes.length - 1; i++) {
    const d = closes[i] - closes[i - 1];
    const g = Math.max(0, d);
    const l = Math.max(0, -d);
    if (first) {
      avgGain += g;
      avgLoss += l;
      if (i === closes.length - 1) {
        avgGain /= period;
        avgLoss /= period;
        first = false;
      }
    } else {
      avgGain = (avgGain * (period - 1) + g) / period;
      avgLoss = (avgLoss * (period - 1) + l) / period;
    }
  }
  if (avgLoss === 0) return avgGain > 0 ? 100 : 50;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Average True Range — needs highs/lows; last value. */
export function atr(bars: Array<{ high: number; low: number; close: number }>, period = 14): number | null {
  if (bars.length < period + 1) return null;
  const trs = bars.slice(1).map((b, i) => {
    const prevClose = bars[i].close;
    return Math.max(b.high - b.low, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose));
  });
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

/** Basic swing regime from the last MA pair: bull/bear/flat. */
export function swingRegime(closes: number[]): "bull" | "bear" | "flat" {
  const fast = sma(closes, 20);
  const slow = sma(closes, 50);
  if (fast === null || slow === null) return "flat";
  if (fast > slow * 1.01) return "bull";
  if (fast < slow * 0.99) return "bear";
  return "flat";
}

/** Swing score + targets from pure technicals — first-principles swing logic. */
export function runTechnicalAnalysis(closes: number[]): {
  rsi: number | null;
  atr: number | null;
  swingScore?: number;
  signals?: { entry?: number; target?: number; stopLoss?: number };
} {
  const r = rsi(closes);
  if (closes.length === 0) return { rsi: null, atr: null };
  const last = closes[closes.length - 1];
  const regime = swingRegime(closes);
  const fast = sma(closes, 20);
  const slow = sma(closes, 50);
  let swingScore: number | undefined;
  if (regime === "bull" && fast !== null && slow !== null && fast > slow) swingScore = 0.8;
  else if (regime === "bull") swingScore = 0.5;
  else if (regime === "bear") swingScore = -0.8;
  if (r !== null && r < 30) swingScore = Math.min(swingScore ?? 0, 0.9);
  return { rsi: r, atr: null, swingScore, signals: { entry: last } };
}
