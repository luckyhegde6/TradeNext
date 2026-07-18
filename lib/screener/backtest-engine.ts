/**
 * Backtest Engine — simulates trades against historical OHLCV data
 * using the FilterGroup condition tree as the entry strategy.
 *
 * How it works:
 *   1. Accepts an entry FilterGroup (strategy) and exit parameters
 *   2. Fetches DailyPrice records for candidate symbols
 *   3. Computes technical indicators from OHLCV data
 *   4. Evaluates the entry filter on each bar
 *   5. Simulates entry/exit trades with P&L tracking
 *   6. Returns performance metrics (win rate, Sharpe, max drawdown)
 *
 * Phase 1 scope: single-symbol backtest, basic exit types,
 *                equal-weight position sizing.
 */

import type { FilterGroup } from "./condition-tree";
import { evaluateFilterGroup, resolveFieldValue } from "./filter-engine";
import {
  computeSMA,
  computeEMA,
  computeRSI,
  computeMACD,
  computeBollinger,
  type OHLCV,
} from "./technical-analysis";

// ============================================================
// Types
// ============================================================

export interface BacktestParams {
  /** Entry strategy as a FilterGroup tree */
  entryFilter: FilterGroup;
  /** Profit target as percentage (e.g., 5 = +5%) */
  profitTarget?: number;
  /** Stop loss as percentage (e.g., 3 = -3%) */
  stopLoss?: number;
  /** Trailing stop as percentage activates after profit target hit */
  trailingStop?: number;
  /** Maximum holding period in bars (default: 60) */
  maxHoldingBars?: number;
  /** Initial capital for position sizing */
  initialCapital: number;
  /** Percentage of capital per trade (1–100, default: 25) */
  positionSizePercent?: number;
}

export interface SimulatedTrade {
  entryDate: string;
  exitDate: string | null;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  exitReason: "target" | "stop_loss" | "trailing_stop" | "max_bars" | "open";
}

export interface PerformanceMetrics {
  totalReturn: number;
  totalReturnPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
}

export interface BacktestEngineResult {
  symbol: string;
  params: BacktestParams;
  trades: SimulatedTrade[];
  metrics: PerformanceMetrics;
  barCount: number;
}

// ============================================================
// OHLCV → field resolver (computes indicators on the fly)
// ============================================================

/**
 * Build a data record from OHLCV bars that the FilterGroup evaluator
 * can read.  Resolves all FILTER_FIELDS (price, volume, technical).
 */
function buildBarRecord(
  ohlcv: OHLCV,
  allBars: OHLCV[],
  idx: number
): Record<string, unknown> {
  // Past bars needed for indicator computation (look-back up to 200)
  const history = allBars.slice(0, idx + 1);
  const closes = history.map((b) => b.close);
  const volumes = history.map((b) => b.volume);
  const highs = history.map((b) => b.high);
  const lows = history.map((b) => b.low);

  // Moving averages
  const sma20 = computeSMA(closes, 20);
  const sma50 = computeSMA(closes, 50);
  const sma200 = computeSMA(closes, 200);
  const ema20 = computeEMA(closes, 20);

  // RSI
  const rsi = computeRSI(closes, 14);

  // MACD
  const macdResult = computeMACD(closes, 12, 26, 9);

  // Bollinger Bands (20, 2)
  const bb = computeBollinger(closes, 20, 2);

  // Volume SMA
  const volSma20 = computeSMA(volumes, 20);

  const prevClose = closes.length > 1 ? closes[closes.length - 2] : ohlcv.close;
  const changeVal = ohlcv.close - prevClose;

  const record: Record<string, unknown> = {
    close: ohlcv.close,
    open: ohlcv.open,
    high: ohlcv.high,
    low: ohlcv.low,
    volume: ohlcv.volume,
    change: changeVal,
    change_percent: prevClose > 0 ? (changeVal / prevClose) * 100 : 0,

    // Moving averages
    SMA20: sma20[idx],
    SMA50: sma50[idx],
    SMA200: sma200[idx],
    EMA20: ema20[idx],

    // RSI
    RSI: rsi[idx],

    // MACD
    "MACD.macd": macdResult.macd[idx],
    "MACD.signal": macdResult.signal[idx],
    "MACD.histogram": macdResult.histogram[idx],

    // Bollinger
    "BB.upper": bb.upper[idx],
    "BB.middle": bb.middle[idx],
    "BB.lower": bb.lower[idx],

    // Volume
    VolSMA20: volSma20[idx],
  };

  // Also add all raw OHLCV fields for easy access
  return record;
}

// ============================================================
// Drawdown calculation
// ============================================================

function computeDrawdown(equityCurve: number[]): { maxDrawdown: number; maxDrawdownPercent: number } {
  let peak = equityCurve[0] || 0;
  let maxDd = 0;
  let maxDdPct = 0;

  for (const value of equityCurve) {
    if (value > peak) peak = value;
    const dd = peak - value;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
    if (ddPct > maxDdPct) maxDdPct = ddPct;
  }

  return { maxDrawdown: maxDd, maxDrawdownPercent: maxDdPct };
}

// ============================================================
// Sharpe ratio (annualized, assuming daily bars, RF = 0)
// ============================================================

function computeSharpeRatio(dailyReturns: number[]): number {
  if (dailyReturns.length < 2) return 0;
  const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
  const variance =
    dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyReturns.length - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  // Annualize: sqrt(252) for daily data
  return (mean / stdDev) * Math.sqrt(252);
}

// ============================================================
// Main backtest entry point
// ============================================================

/**
 * Run a backtest for a single symbol against historical OHLCV data.
 *
 * @param symbol   Stock ticker (for record-keeping)
 * @param ohlcv    Array of OHLCV bars (sorted ascending by timestamp)
 * @param params   Backtest parameters (filter, targets, sizing)
 * @returns        BacktestEngineResult with trades and metrics
 */
export function runBacktest(
  symbol: string,
  ohlcv: OHLCV[],
  params: BacktestParams
): BacktestEngineResult {
  const trades: SimulatedTrade[] = [];
  if (ohlcv.length < 50) {
    return {
      symbol,
      params,
      trades: [],
      metrics: getEmptyMetrics(),
      barCount: ohlcv.length,
    };
  }

  const maxBars = params.maxHoldingBars ?? 60;
  const posSizePct = (params.positionSizePercent ?? 25) / 100;

  // State
  let inPosition = false;
  let entryBar = 0;
  let entryPrice = 0;
  let quantity = 0;
  let highestPrice = 0;
  let currentTrade: SimulatedTrade | null = null;

  // Equity tracking
  let cash = params.initialCapital;
  let equity = params.initialCapital;
  const equityCurve: number[] = [equity];
  const dailyReturns: number[] = [];

  // Walk through bars
  for (let i = 50; i < ohlcv.length; i++) {
    const bar = ohlcv[i];
    const record = buildBarRecord(bar, ohlcv, i);

    if (!inPosition) {
      // === Check entry condition ===
      const shouldEnter = evaluateFilterGroup(params.entryFilter, record);
      if (shouldEnter) {
        inPosition = true;
        entryBar = i;
        entryPrice = bar.close;
        quantity = Math.floor((cash * posSizePct) / bar.close);
        if (quantity < 1) quantity = 1;
        highestPrice = bar.close;

        currentTrade = {
          entryDate: new Date(bar.timestamp).toISOString().split("T")[0],
          exitDate: null,
          entryPrice,
          exitPrice: null,
          quantity,
          pnl: 0,
          pnlPercent: 0,
          exitReason: "open",
        };
      }
    } else {
      // === Check exit conditions ===
      let exitPrice: number | null = null;
      let exitReason: "target" | "stop_loss" | "trailing_stop" | "max_bars" | null = null;

      // Update highest price for trailing stop
      if (bar.high > highestPrice) {
        highestPrice = bar.high;
      }

      // 1. Profit target
      if (params.profitTarget && bar.high >= entryPrice * (1 + params.profitTarget / 100)) {
        exitPrice = entryPrice * (1 + params.profitTarget / 100);
        exitReason = "target";
      }

      // 2. Trailing stop
      if (!exitReason && params.trailingStop && highestPrice > entryPrice) {
        const trailLevel = highestPrice * (1 - params.trailingStop / 100);
        if (bar.low <= trailLevel) {
          exitPrice = trailLevel;
          exitReason = "trailing_stop";
        }
      }

      // 3. Stop loss (only if trailing stop didn't trigger)
      if (!exitReason && params.stopLoss) {
        const stopLevel = entryPrice * (1 - params.stopLoss / 100);
        if (bar.low <= stopLevel) {
          exitPrice = stopLevel;
          exitReason = "stop_loss";
        }
      }

      // 4. Max holding bars
      if (!exitReason && (i - entryBar) >= maxBars) {
        exitPrice = bar.close;
        exitReason = "max_bars";
      }

      if (exitPrice !== null && currentTrade) {
        // Close trade
        inPosition = false;
        const pnl = (exitPrice - entryPrice) * quantity;
        const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;

        currentTrade.exitDate = new Date(bar.timestamp).toISOString().split("T")[0];
        currentTrade.exitPrice = exitPrice;
        currentTrade.pnl = pnl;
        currentTrade.pnlPercent = pnlPct;
        currentTrade.exitReason = exitReason ?? "max_bars";
        trades.push(currentTrade);

        // Update equity
        cash += pnl;
        equity = cash;
        equityCurve.push(equity);
        dailyReturns.push(equityCurve.length > 1
          ? (equityCurve[equityCurve.length - 1] - equityCurve[equityCurve.length - 2]) / equityCurve[equityCurve.length - 2]
          : 0
        );

        currentTrade = null;
      }
    }
  }

  // Close any open position at last bar
  if (inPosition && currentTrade) {
    const lastClose = ohlcv[ohlcv.length - 1].close;
    const pnl = (lastClose - entryPrice) * quantity;
    const pnlPct = ((lastClose - entryPrice) / entryPrice) * 100;

    currentTrade.exitDate = new Date(ohlcv[ohlcv.length - 1].timestamp).toISOString().split("T")[0];
    currentTrade.exitPrice = lastClose;
    currentTrade.pnl = pnl;
    currentTrade.pnlPercent = pnlPct;
    currentTrade.exitReason = "max_bars"; // Treat end-of-data as max bars
    trades.push(currentTrade);
  }

  // === Compute metrics ===
  const metrics = computeMetrics(trades, params.initialCapital, equityCurve, dailyReturns);

  return {
    symbol,
    params,
    trades,
    metrics,
    barCount: ohlcv.length,
  };
}

// ============================================================
// Metrics computation
// ============================================================

function computeMetrics(
  trades: SimulatedTrade[],
  initialCapital: number,
  equityCurve: number[],
  dailyReturns: number[]
): PerformanceMetrics {
  const totalTrades = trades.length;
  if (totalTrades === 0) return getEmptyMetrics();

  const winningTrades = trades.filter((t) => t.pnl > 0);
  const losingTrades = trades.filter((t) => t.pnl <= 0);
  const winRate = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;

  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const totalReturnPercent = initialCapital > 0
    ? ((equityCurve[equityCurve.length - 1] - initialCapital) / initialCapital) * 100
    : 0;

  const avgWin = winningTrades.length > 0
    ? winningTrades.reduce((s, t) => s + t.pnl, 0) / winningTrades.length
    : 0;
  const avgLoss = losingTrades.length > 0
    ? Math.abs(losingTrades.reduce((s, t) => s + t.pnl, 0) / losingTrades.length)
    : 0;
  const largestWin = winningTrades.length > 0
    ? Math.max(...winningTrades.map((t) => t.pnl))
    : 0;
  const largestLoss = losingTrades.length > 0
    ? Math.min(...losingTrades.map((t) => t.pnl))
    : 0;

  const { maxDrawdown, maxDrawdownPercent } = computeDrawdown(equityCurve.length > 0 ? equityCurve : [initialCapital]);
  const sharpeRatio = computeSharpeRatio(dailyReturns);

  return {
    totalReturn: totalPnl,
    totalReturnPercent,
    totalTrades,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate,
    avgWin,
    avgLoss,
    largestWin,
    largestLoss,
    maxDrawdown,
    maxDrawdownPercent,
    sharpeRatio,
  };
}

function getEmptyMetrics(): PerformanceMetrics {
  return {
    totalReturn: 0,
    totalReturnPercent: 0,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    avgWin: 0,
    avgLoss: 0,
    largestWin: 0,
    largestLoss: 0,
    maxDrawdown: 0,
    maxDrawdownPercent: 0,
    sharpeRatio: 0,
  };
}
