/**
 * Technical Analysis — server-side computation of technical indicators
 * and candlestick pattern recognition.
 *
 * Used as Tier 2 fallback when TradingView doesn't expose certain
 * indicators via its scanner API. Also powers the Pattern Scout
 * AI agent in Phase 4.
 */

// ============================================================
// Types
// ============================================================

export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MACDResult {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export interface BollingerResult {
  upper: number[];
  middle: number[];
  lower: number[];
}

export interface CandlestickPattern {
  name: string;
  type: "bullish" | "bearish" | "neutral";
  confidence: number;
  description: string;
}

// ============================================================
// Moving Averages
// ============================================================

export function computeSMA(values: number[], period: number): number[] {
  const result: number[] = new Array(values.length).fill(NaN);
  if (values.length < period) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  result[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    sum = sum - values[i - period] + values[i];
    result[i] = sum / period;
  }
  return result;
}

export function computeEMA(values: number[], period: number): number[] {
  const result: number[] = new Array(values.length).fill(NaN);
  if (values.length < period) return result;
  const multiplier = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  result[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    result[i] = (values[i] - result[i - 1]) * multiplier + result[i - 1];
  }
  return result;
}

// ============================================================
// RSI
// ============================================================

export function computeRSI(prices: number[], period: number = 14): number[] {
  const result: number[] = new Array(prices.length).fill(NaN);
  if (prices.length < period + 1) return result;
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? Math.abs(diff) : 0);
  }
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  if (avgLoss === 0) {
    result[period] = 100;
  } else {
    result[period] = 100 - 100 / (1 + avgGain / avgLoss);
  }
  for (let i = period + 1; i < prices.length; i++) {
    const idx = i - 1;
    avgGain = (avgGain * (period - 1) + gains[idx]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[idx]) / period;
    if (avgLoss === 0) {
      result[i] = 100;
    } else {
      result[i] = 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return result;
}

// ============================================================
// MACD
// ============================================================

export function computeMACD(
  prices: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDResult {
  const emaFast = computeEMA(prices, fastPeriod);
  const emaSlow = computeEMA(prices, slowPeriod);
  const macd: number[] = new Array(prices.length).fill(NaN);
  for (let i = 0; i < prices.length; i++) {
    if (!isNaN(emaFast[i]) && !isNaN(emaSlow[i])) {
      macd[i] = emaFast[i] - emaSlow[i];
    }
  }
  const signal = computeEMA(macd.map((v) => (isNaN(v) ? 0 : v)), signalPeriod);
  for (let i = 0; i < signalPeriod - 1; i++) signal[i] = NaN;
  const histogram: number[] = new Array(prices.length).fill(NaN);
  for (let i = 0; i < prices.length; i++) {
    if (!isNaN(macd[i]) && !isNaN(signal[i])) {
      histogram[i] = macd[i] - signal[i];
    }
  }
  return { macd, signal, histogram };
}

// ============================================================
// Bollinger Bands
// ============================================================

export function computeBollinger(
  prices: number[],
  period: number = 20,
  multiplier: number = 2
): BollingerResult {
  const middle = computeSMA(prices, period);
  const upper: number[] = new Array(prices.length).fill(NaN);
  const lower: number[] = new Array(prices.length).fill(NaN);
  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    const mean = middle[i];
    const variance = slice.reduce((sum, val) => sum + (val - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    upper[i] = mean + multiplier * stdDev;
    lower[i] = mean - multiplier * stdDev;
  }
  return { upper, middle, lower };
}

// ============================================================
// Candlestick Pattern Recognition
// ============================================================

export function detectCandlestickPatterns(ohlcv: OHLCV[]): CandlestickPattern[] {
  if (ohlcv.length < 3) return [];
  const patterns: CandlestickPattern[] = [];
  const current = ohlcv[ohlcv.length - 1];
  const prev = ohlcv[ohlcv.length - 2];
  const bodySize = Math.abs(current.close - current.open);
  const totalRange = current.high - current.low;
  const upperShadow = current.high - Math.max(current.open, current.close);
  const lowerShadow = Math.min(current.open, current.close) - current.low;
  const isBullish = current.close > current.open;
  if (totalRange === 0) return [];

  // Doji
  if (bodySize / totalRange < 0.1) {
    patterns.push({ name: "Doji", type: "neutral", confidence: 0.7, description: "Open and close nearly equal, indecision" });
  }

  // Hammer
  if (bodySize / totalRange < 0.4) {
    if (lowerShadow > 2 * bodySize && upperShadow < 0.3 * bodySize) {
      patterns.push({ name: "Hammer", type: "bullish", confidence: 0.6, description: "Long lower wick, potential bullish reversal" });
    }
    if (upperShadow > 2 * bodySize && lowerShadow < 0.3 * bodySize) {
      patterns.push({ name: "Shooting Star", type: "bearish", confidence: 0.6, description: "Long upper wick, potential bearish reversal" });
    }
  }

  // Marubozu
  if (bodySize / totalRange > 0.85 && upperShadow / totalRange < 0.05 && lowerShadow / totalRange < 0.05) {
    patterns.push({ name: isBullish ? "Bullish Marubozu" : "Bearish Marubozu", type: isBullish ? "bullish" : "bearish", confidence: 0.7, description: "No wicks, strong momentum" });
  }

  // Spinning Top
  if (bodySize / totalRange < 0.3 && upperShadow > 0.3 * bodySize && lowerShadow > 0.3 * bodySize) {
    patterns.push({ name: "Spinning Top", type: "neutral", confidence: 0.5, description: "Indecision/consolidation" });
  }

  // Engulfing patterns
  if (prev) {
    const prevIsBullish = prev.close > prev.open;
    if (!isBullish && prevIsBullish && current.open > prev.close && current.close < prev.open) {
      patterns.push({ name: "Bullish Engulfing", type: "bullish", confidence: 0.8, description: "Bullish candle engulfs previous bearish candle" });
    }
    if (isBullish && !prevIsBullish && current.open < prev.close && current.close > prev.open) {
      patterns.push({ name: "Bearish Engulfing", type: "bearish", confidence: 0.8, description: "Bearish candle engulfs previous bullish candle" });
    }
  }

  return patterns;
}

// ─── Average True Range (ATR) ────────────────────────────────────────────────

/**
 * Compute Average True Range over `period` bars.
 * TR = max(high-low, |high-prevClose|, |low-prevClose|)
 * ATR = SMA of TR over `period`
 */
export function computeATR(bars: OHLCV[], period: number = 14): number[] {
  if (bars.length < 2) return [];

  const trueRanges: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    const high = bars[i].high;
    const low = bars[i].low;
    if (i === 0) {
      trueRanges.push(high - low);
    } else {
      const prevClose = bars[i - 1].close;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trueRanges.push(tr);
    }
  }

  // ATR = SMA of true ranges starting from index `period - 1`
  const atr: number[] = [];
  for (let i = period - 1; i < trueRanges.length; i++) {
    const slice = trueRanges.slice(i - period + 1, i + 1);
    const avg = slice.reduce((sum, v) => sum + v, 0) / period;
    atr.push(parseFloat(avg.toFixed(2)));
  }
  return atr;
}

// ─── Support / Resistance (Pivot-Point Based) ────────────────────────────────

export interface SupportResistance {
  support: number | null;
  resistance: number | null;
  pivotHighs: number[];
  pivotLows: number[];
}

/**
 * Detect support and resistance levels using pivot-point highs/lows.
 * A pivot high is a bar whose high is higher than the N bars on each side.
 * A pivot low is a bar whose low is lower than the N bars on each side.
 * Returns the most recent support (highest pivot low below current price)
 * and resistance (lowest pivot high above current price).
 */
export function findSupportResistance(
  bars: OHLCV[],
  lookback: number = 5
): SupportResistance {
  if (bars.length < lookback * 2 + 1) {
    return { support: null, resistance: null, pivotHighs: [], pivotLows: [] };
  }

  const pivotHighs: number[] = [];
  const pivotLows: number[] = [];

  for (let i = lookback; i < bars.length - lookback; i++) {
    let isPivotHigh = true;
    let isPivotLow = true;

    for (let j = 1; j <= lookback; j++) {
      if (bars[i].high <= bars[i - j].high || bars[i].high <= bars[i + j].high) {
        isPivotHigh = false;
      }
      if (bars[i].low >= bars[i - j].low || bars[i].low >= bars[i + j].low) {
        isPivotLow = false;
      }
    }

    if (isPivotHigh) pivotHighs.push(bars[i].high);
    if (isPivotLow) pivotLows.push(bars[i].low);
  }

  const currentPrice = bars[bars.length - 1].close;

  // Support = highest pivot low below current price
  const supportsBelow = pivotLows.filter((l) => l < currentPrice);
  const support = supportsBelow.length > 0 ? Math.max(...supportsBelow) : null;

  // Resistance = lowest pivot high above current price
  const resistancesAbove = pivotHighs.filter((h) => h > currentPrice);
  const resistance = resistancesAbove.length > 0 ? Math.min(...resistancesAbove) : null;

  return {
    support: support !== null ? parseFloat(support.toFixed(2)) : null,
    resistance: resistance !== null ? parseFloat(resistance.toFixed(2)) : null,
    pivotHighs,
    pivotLows,
  };
}
