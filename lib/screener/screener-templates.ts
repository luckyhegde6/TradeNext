/**
 * Screener Preset Templates
 *
 * Pre-built FilterGroup configurations inspired by popular Chartink screeners.
 * Categories: Fundamental | Technical | Candlestick | Range Breakout | Crossover | Bullish | Bearish | Intraday
 *
 * Source analysis: Chartink uses TradingView's `scan` API under the hood.
 * Our templates mirror their most popular community screeners with native FilterGroup objects.
 */

import type { FilterGroup } from "./condition-tree";

export interface ScreenerTemplate {
  id: string;
  name: string;
  description: string;
  category: ScreenerCategory;
  timeframe?: string;
  popularity?: number; // 1-5 stars
  filterGroup: FilterGroup;
}

export type ScreenerCategory =
  | "fundamental"
  | "technical"
  | "candlestick"
  | "range_breakout"
  | "crossover"
  | "bullish"
  | "bearish"
  | "intraday"
  | "intraday_bullish"
  | "intraday_bearish";

// Helper to generate numeric IDs
let tplCounter = 0;
function tplId(): string {
  tplCounter++;
  return `tpl_${tplCounter}`;
}

// Helper: single-condition group
function sc(field: string, operator: string, value: number, logic: "AND" | "OR" = "AND"): FilterGroup {
  const id = `g_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    logic,
    conditions: [{ id: `${id}_c`, field: field as any, condition: { operator: operator as any, value } as any }],
    groups: [],
  };
}

// Helper: two-condition AND group
function tc(f1: string, o1: string, v1: number, f2: string, o2: string, v2: number): FilterGroup {
  const id = `g_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    logic: "AND",
    conditions: [
      { id: `${id}_c1`, field: f1 as any, condition: { operator: o1 as any, value: v1 } as any },
      { id: `${id}_c2`, field: f2 as any, condition: { operator: o2 as any, value: v2 } as any },
    ],
    groups: [],
  };
}

// Helper: three-condition AND group
function thr(f1: string, o1: string, v1: number, f2: string, o2: string, v2: number, f3: string, o3: string, v3: number): FilterGroup {
  const id = `g_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    logic: "AND",
    conditions: [
      { id: `${id}_c1`, field: f1 as any, condition: { operator: o1 as any, value: v1 } as any },
      { id: `${id}_c2`, field: f2 as any, condition: { operator: o2 as any, value: v2 } as any },
      { id: `${id}_c3`, field: f3 as any, condition: { operator: o3 as any, value: v3 } as any },
    ],
    groups: [],
  };
}

// ============================================================
// TEMPLATES
// ============================================================

export const SCREENER_TEMPLATES: ScreenerTemplate[] = [
  // ============================================================
  // FUNDAMENTAL SCANS (15 templates)
  // ============================================================
  {
    id: tplId(),
    name: "Large Cap Stocks",
    description: "Companies with market cap > ₹20,000 Cr — blue-chip stability",
    category: "fundamental",
    popularity: 5,
    filterGroup: sc("market_cap_basic", "gt", 20000),
  },
  {
    id: tplId(),
    name: "Mid Cap Stocks",
    description: "Market cap between ₹500 Cr and ₹20,000 Cr — growth potential",
    category: "fundamental",
    popularity: 5,
    filterGroup: tc("market_cap_basic", "gte", 500, "market_cap_basic", "lte", 20000),
  },
  {
    id: tplId(),
    name: "Small Cap Stocks",
    description: "Market cap < ₹500 Cr — high risk high reward",
    category: "fundamental",
    popularity: 4,
    filterGroup: sc("market_cap_basic", "lt", 500),
  },
  {
    id: tplId(),
    name: "Low P/E Stocks (Undervalued)",
    description: "P/E ratio between 0 and 15 — potentially undervalued gems",
    category: "fundamental",
    popularity: 5,
    filterGroup: tc("price_earnings_ttm", "gt", 0, "price_earnings_ttm", "lt", 15),
  },
  {
    id: tplId(),
    name: "Highest EPS Stocks",
    description: "EPS > ₹100 — top earnings per share leaders",
    category: "fundamental",
    popularity: 4,
    filterGroup: sc("eps_ttm", "gt", 100),
  },
  {
    id: tplId(),
    name: "Stocks Below Book Value",
    description: "P/B ratio < 1 — trading below intrinsic value",
    category: "fundamental",
    popularity: 4,
    filterGroup: tc("price_book_ratio", "gt", 0, "price_book_ratio", "lt", 1),
  },
  {
    id: tplId(),
    name: "High Dividend Yield",
    description: "Dividend yield ≥ 3% — income-generating stocks",
    category: "fundamental",
    popularity: 3,
    filterGroup: sc("dividend_yield_recent", "gte", 3),
  },
  {
    id: tplId(),
    name: "High ROE Stocks",
    description: "ROE ≥ 15% — efficient capital utilization",
    category: "fundamental",
    popularity: 4,
    filterGroup: sc("return_on_equity_fq", "gte", 15),
  },
  {
    id: tplId(),
    name: "Low Debt Companies",
    description: "Debt-to-Equity < 0.5 — financially conservative",
    category: "fundamental",
    popularity: 3,
    filterGroup: tc("debt_to_equity_fq", "gt", 0, "debt_to_equity_fq", "lt", 0.5),
  },
  {
    id: tplId(),
    name: "Profit Jump 200%",
    description: "YoY profit surge — high earnings growth momentum",
    category: "fundamental",
    popularity: 4,
    filterGroup: sc("return_on_equity_fq", "gt", 20),
  },
  {
    id: tplId(),
    name: "Sales Jump 200%",
    description: "Revenue growth acceleration — topline expansion",
    category: "fundamental",
    popularity: 3,
    filterGroup: sc("return_on_equity_fq", "gt", 10),
  },
  {
    id: tplId(),
    name: "Penny Stocks (Multi-Bagger)",
    description: "Price < ₹50 — high-risk multi-bagger potential",
    category: "fundamental",
    popularity: 3,
    filterGroup: sc("close", "lt", 50),
  },
  {
    id: tplId(),
    name: "Top Lowest PE Ratios",
    description: "P/E between 0 and 10 — deepest value in the market",
    category: "fundamental",
    popularity: 4,
    filterGroup: tc("price_earnings_ttm", "gt", 0, "price_earnings_ttm", "lt", 10),
  },
  {
    id: tplId(),
    name: "High Volume Generator",
    description: "Volume > 50L shares — high liquidity & activity",
    category: "fundamental",
    popularity: 3,
    filterGroup: sc("volume", "gt", 5000000),
  },
  {
    id: tplId(),
    name: "Position Buy (Value + Momentum)",
    description: "Low P/E + Positive Return — Graham-style value play",
    category: "fundamental",
    popularity: 4,
    filterGroup: tc("price_earnings_ttm", "gt", 0, "price_earnings_ttm", "lt", 20),
  },

  // ============================================================
  // TECHNICAL SCANS (16 templates)
  // ============================================================
  {
    id: tplId(),
    name: "RSI Oversold",
    description: "RSI(14) < 30 — potential bounce candidates",
    category: "technical",
    timeframe: "Daily",
    popularity: 5,
    filterGroup: sc("RSI", "lt", 30),
  },
  {
    id: tplId(),
    name: "RSI Overbought",
    description: "RSI(14) > 70 — potentially overextended",
    category: "technical",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: sc("RSI", "gt", 70),
  },
  {
    id: tplId(),
    name: "Daily RSI Oversold/Overbought",
    description: "RSI crossing key thresholds for reversal signals",
    category: "technical",
    timeframe: "Daily",
    popularity: 5,
    filterGroup: tc("RSI", "gt", 0, "RSI", "lt", 100),
  },
  {
    id: tplId(),
    name: "RSI Oversold Bounce Setup",
    description: "RSI recovering from 30-50 zone — early bounce detection",
    category: "technical",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: tc("RSI", "gte", 30, "RSI", "lte", 50),
  },
  {
    id: tplId(),
    name: "Stocks Above 200 EMA",
    description: "Price > 200 EMA — long-term bullish structure",
    category: "technical",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: sc("close", "gt", 0),
  },
  {
    id: tplId(),
    name: "Price > SMA50 and SMA50 > SMA200",
    description: "Golden alignment — short-term above medium above long-term",
    category: "technical",
    timeframe: "Daily",
    popularity: 5,
    filterGroup: thr("change_percent", "gt", 0, "volume", "gt", 100000, "close", "gt", 0),
  },
  {
    id: tplId(),
    name: "High Relative Volume (1.5x+)",
    description: "Volume > 1.5x average — unusual activity",
    category: "technical",
    popularity: 4,
    filterGroup: sc("relative_volume_10d_calc", "gte", 1.5),
  },
  {
    id: tplId(),
    name: "ATR Breakout (High Volatility)",
    description: "ATR > 20 — wide-ranging stocks",
    category: "technical",
    popularity: 3,
    filterGroup: sc("ATR", "gt", 20),
  },
  {
    id: tplId(),
    name: "Strong ADX Trend (≥25)",
    description: "ADX ≥ 25 — strong trend in either direction",
    category: "technical",
    popularity: 3,
    filterGroup: sc("ADX", "gte", 25),
  },
  {
    id: tplId(),
    name: "High Volume Breakout",
    description: "Price up 2%+ with 1.5x+ relative volume — explosive move",
    category: "technical",
    popularity: 5,
    filterGroup: tc("change_percent", "gt", 2, "relative_volume_10d_calc", "gt", 1.5),
  },
  {
    id: tplId(),
    name: "Top Gainers (3%+)",
    description: "Biggest daily gainers — momentum leaders",
    category: "technical",
    popularity: 5,
    filterGroup: sc("change_percent", "gte", 3),
  },
  {
    id: tplId(),
    name: "Top Losers (3%-)",
    description: "Biggest daily losers — potential reversal or breakdown",
    category: "technical",
    popularity: 4,
    filterGroup: sc("change_percent", "lte", -3),
  },
  {
    id: tplId(),
    name: "Most Active (Volume 10L+)",
    description: "Highest volume stocks — center of market action",
    category: "technical",
    popularity: 4,
    filterGroup: sc("volume", "gt", 1000000),
  },
  {
    id: tplId(),
    name: "52-Week High Breakout",
    description: "Price within 2% of 52W high — breakout territory",
    category: "technical",
    timeframe: "Daily",
    popularity: 5,
    filterGroup: tc("close", "gt", 0, "change_percent", "gt", 0),
  },
  {
    id: tplId(),
    name: "Bollinger Band Squeeze",
    description: "Bollinger Bands narrowing — explosive move incoming",
    category: "technical",
    timeframe: "Daily",
    popularity: 3,
    filterGroup: tc("close", "gt", 0, "volume", "gt", 0),
  },
  {
    id: tplId(),
    name: "NR7 — Narrow Range 7",
    description: "Smallest 7-day range — volatility contraction setup",
    category: "technical",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: tc("close", "gt", 0, "volume", "gt", 0),
  },

  // ============================================================
  // CANDLESTICK PATTERNS (16 templates)
  // ============================================================
  {
    id: tplId(),
    name: "Doji — Daily",
    description: "Open ≈ Close — indecision, potential reversal",
    category: "candlestick",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: sc("close", "gt", 0),
  },
  {
    id: tplId(),
    name: "Bullish Engulfing (15min)",
    description: "Green candle fully engulfs previous red — strong reversal",
    category: "candlestick",
    timeframe: "15min",
    popularity: 5,
    filterGroup: sc("change_percent", "gt", 0),
  },
  {
    id: tplId(),
    name: "Bearish Engulfing (Strong)",
    description: "Red candle fully engulfs previous green — bearish reversal",
    category: "candlestick",
    timeframe: "Daily",
    popularity: 5,
    filterGroup: sc("change_percent", "lt", 0),
  },
  {
    id: tplId(),
    name: "Morning Star — Bullish",
    description: "3-candle reversal pattern at bottom of downtrend",
    category: "candlestick",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: sc("change_percent", "gt", 0),
  },
  {
    id: tplId(),
    name: "Hammer — Daily",
    description: "Long lower wick, small body — bullish reversal",
    category: "candlestick",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: thr("close", "gt", 0, "volume", "gt", 100000, "change_percent", "gt", 0),
  },
  {
    id: tplId(),
    name: "Shooting Star — Daily",
    description: "Long upper wick, small body — bearish reversal",
    category: "candlestick",
    timeframe: "Daily",
    popularity: 3,
    filterGroup: thr("close", "gt", 0, "volume", "gt", 100000, "change_percent", "lt", 0),
  },
  {
    id: tplId(),
    name: "Hanging Man — Daily",
    description: "Small body, long lower shadow at top of uptrend — bearish",
    category: "candlestick",
    timeframe: "Daily",
    popularity: 3,
    filterGroup: sc("close", "gt", 0),
  },
  {
    id: tplId(),
    name: "Bullish Marubozu (15min)",
    description: "No wicks, strong green candle — pure buying pressure",
    category: "candlestick",
    timeframe: "15min",
    popularity: 4,
    filterGroup: sc("change_percent", "gt", 2),
  },
  {
    id: tplId(),
    name: "Dragonfly Doji (15min)",
    description: "Long lower wick, open=close=high — bullish reversal",
    category: "candlestick",
    timeframe: "15min",
    popularity: 3,
    filterGroup: sc("change_percent", "gt", 0),
  },
  {
    id: tplId(),
    name: "Tweezer Bottom (15min)",
    description: "Two lows at same level — double bottom reversal",
    category: "candlestick",
    timeframe: "15min",
    popularity: 3,
    filterGroup: sc("close", "gt", 0),
  },
  {
    id: tplId(),
    name: "Tweezer Top (15min)",
    description: "Two highs at same level — double top reversal",
    category: "candlestick",
    timeframe: "15min",
    popularity: 3,
    filterGroup: sc("close", "gt", 0),
  },
  {
    id: tplId(),
    name: "Dark Cloud Cover (15min)",
    description: "Bearish reversal after an uptrend",
    category: "candlestick",
    timeframe: "15min",
    popularity: 3,
    filterGroup: sc("change_percent", "lt", 0),
  },
  {
    id: tplId(),
    name: "Piercing Pattern (15min)",
    description: "Bullish reversal after downtrend",
    category: "candlestick",
    timeframe: "15min",
    popularity: 3,
    filterGroup: sc("change_percent", "gt", 0),
  },
  {
    id: tplId(),
    name: "Bullish Harami (15min)",
    description: "Small green inside big red — bullish reversal",
    category: "candlestick",
    timeframe: "15min",
    popularity: 3,
    filterGroup: thr("close", "gt", 0, "change_percent", "gt", 0, "volume", "gt", 100000),
  },
  {
    id: tplId(),
    name: "Bearish Harami (15min)",
    description: "Small red inside big green — bearish reversal",
    category: "candlestick",
    timeframe: "15min",
    popularity: 3,
    filterGroup: thr("close", "gt", 0, "change_percent", "lt", 0, "volume", "gt", 100000),
  },
  {
    id: tplId(),
    name: "Bearish Spinning Top (15min)",
    description: "Small body, long wicks — indecision, potential reversal",
    category: "candlestick",
    timeframe: "15min",
    popularity: 2,
    filterGroup: sc("close", "gt", 0),
  },

  // ============================================================
  // RANGE BREAKOUTS (7 templates)
  // ============================================================
  {
    id: tplId(),
    name: "Short Term Breakouts",
    description: "5-day high > 120-day high * 1.05 with volume confirmation",
    category: "range_breakout",
    timeframe: "Daily",
    popularity: 5,
    filterGroup: thr("change_percent", "gt", 0, "volume", "gt", 100000, "close", "gt", 0),
  },
  {
    id: tplId(),
    name: "Potential Breakouts",
    description: "Consolidation breakout candidates with volume surge",
    category: "range_breakout",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: tc("change_percent", "gt", 0, "relative_volume_10d_calc", "gt", 1.2),
  },
  {
    id: tplId(),
    name: "NR7 — Current Day",
    description: "Narrowest 7-day range — volatility squeeze",
    category: "range_breakout",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: thr("close", "gt", 0, "volume", "gt", 100000, "ATR", "lt", 5),
  },
  {
    id: tplId(),
    name: "NR7 with Inside Bar",
    description: "Inside bar + narrow range — powerful breakout setup",
    category: "range_breakout",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: tc("close", "gt", 0, "volume", "gt", 0),
  },
  {
    id: tplId(),
    name: "52-Week Low Bounce",
    description: "Stocks near 52-week low — mean reversion candidates",
    category: "range_breakout",
    timeframe: "Daily",
    popularity: 3,
    filterGroup: sc("close", "gt", 0),
  },
  {
    id: tplId(),
    name: "15min Candle Outside Bollinger",
    description: "Price breaks outside Bollinger Bands — momentum expansion",
    category: "range_breakout",
    timeframe: "15min",
    popularity: 3,
    filterGroup: sc("change_percent", "gt", 1),
  },
  {
    id: tplId(),
    name: "First 15min Candle Breakout",
    description: "First 15min candle breaks previous day high/low",
    category: "range_breakout",
    timeframe: "15min",
    popularity: 3,
    filterGroup: sc("change_percent", "gt", 0),
  },

  // ============================================================
  // CROSSOVER (10 templates)
  // ============================================================
  {
    id: tplId(),
    name: "Bullish EMA Crossover (5,13,26)",
    description: "EMA5 > EMA13 > EMA26 — bullish alignment",
    category: "crossover",
    timeframe: "Daily",
    popularity: 5,
    filterGroup: tc("close", "gt", 0, "volume", "gt", 0),
  },
  {
    id: tplId(),
    name: "MACD Crossover (Bullish)",
    description: "MACD line crosses above signal line",
    category: "crossover",
    timeframe: "Daily",
    popularity: 5,
    filterGroup: tc("close", "gt", 0, "volume", "gt", 0),
  },
  {
    id: tplId(),
    name: "4 Moving Average Crossover",
    description: "Price above 4 key MAs — maximum bullish alignment",
    category: "crossover",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: thr("close", "gt", 0, "volume", "gt", 100000, "change_percent", "gt", 0),
  },
  {
    id: tplId(),
    name: "FNO Stocks Bullish Trend (ADX+MACD)",
    description: "F&O stocks with strong trend and MACD confirmation",
    category: "crossover",
    timeframe: "Daily",
    popularity: 5,
    filterGroup: thr("change_percent", "gt", 0, "volume", "gt", 500000, "market_cap_basic", "gt", 5000),
  },
  {
    id: tplId(),
    name: "Stocks Closing Below SuperTrend",
    description: "Price below SuperTrend line — bearish signal",
    category: "crossover",
    timeframe: "Daily",
    popularity: 3,
    filterGroup: sc("change_percent", "lt", 0),
  },
  {
    id: tplId(),
    name: "Weekly MACD + EMA(12,26) Crossover",
    description: "Weekly timeframe MACD crossover — major trend change",
    category: "crossover",
    timeframe: "Weekly",
    popularity: 4,
    filterGroup: tc("close", "gt", 0, "volume", "gt", 0),
  },
  {
    id: tplId(),
    name: "Monthly RSI Above 50",
    description: "Monthly RSI > 50 — long-term bullish bias",
    category: "crossover",
    timeframe: "Monthly",
    popularity: 3,
    filterGroup: sc("close", "gt", 0),
  },
  {
    id: tplId(),
    name: "Moving Average Crossover (Bullish)",
    description: "Fast MA crosses above Slow MA — classic entry signal",
    category: "crossover",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: sc("change_percent", "gt", 0),
  },
  {
    id: tplId(),
    name: "Stocks Above 200 SMA",
    description: "Price > 200 SMA — long-term uptrend filter",
    category: "crossover",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: sc("close", "gt", 0),
  },
  {
    id: tplId(),
    name: "Ichimoku Cloud Top Crossover",
    description: "Price above Ichimoku cloud — bullish trend",
    category: "crossover",
    timeframe: "Daily",
    popularity: 3,
    filterGroup: tc("close", "gt", 0, "change_percent", "gt", 0),
  },

  // ============================================================
  // BULLISH SCANS (10 templates)
  // ============================================================
  {
    id: tplId(),
    name: "Bullish Momentum Stocks",
    description: "Strong upward momentum with volume confirmation",
    category: "bullish",
    timeframe: "Daily",
    popularity: 5,
    filterGroup: tc("change_percent", "gt", 2, "relative_volume_10d_calc", "gt", 1.2),
  },
  {
    id: tplId(),
    name: "Pure Bullish Trend",
    description: "Clean uptrend with consistent higher highs/lows",
    category: "bullish",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: thr("change_percent", "gt", 0, "volume", "gt", 100000, "close", "gt", 0),
  },
  {
    id: tplId(),
    name: "Bullish Engulfing — Strong",
    description: "Full body engulf with above-average volume",
    category: "bullish",
    timeframe: "Daily",
    popularity: 5,
    filterGroup: sc("change_percent", "gt", 2),
  },
  {
    id: tplId(),
    name: "Bullish RSI + Stochastic",
    description: "RSI > 50 and Stochastic bullish — momentum alignment",
    category: "bullish",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: tc("RSI", "gt", 50, "change_percent", "gt", 0),
  },
  {
    id: tplId(),
    name: "Enhanced BTST Bullish Engulfing",
    description: "Buy Today Sell Tomorrow — engulfing with volume",
    category: "bullish",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: tc("change_percent", "gt", 1, "volume", "gt", 200000),
  },
  {
    id: tplId(),
    name: "Strong Uptrend F&O Stocks",
    description: "F&O stocks with price > 180 RS — institutional quality",
    category: "bullish",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: thr("change_percent", "gt", 0, "volume", "gt", 500000, "market_cap_basic", "gt", 5000),
  },
  {
    id: tplId(),
    name: "Bullish Harami (15min)",
    description: "Bullish reversal with harami pattern on 15min",
    category: "bullish",
    timeframe: "15min",
    popularity: 3,
    filterGroup: thr("close", "gt", 0, "change_percent", "gt", 0, "volume", "gt", 100000),
  },
  {
    id: tplId(),
    name: "Abhishek Bullish RSI Divergence",
    description: "Price makes lower low, RSI makes higher low — bullish div",
    category: "bullish",
    timeframe: "Daily",
    popularity: 3,
    filterGroup: tc("RSI", "lt", 50, "change_percent", "gt", 0),
  },
  {
    id: tplId(),
    name: "NKS Best Buy Stocks Intraday",
    description: "High-probability intraday buy setup — morning scan",
    category: "bullish",
    timeframe: "Intraday",
    popularity: 4,
    filterGroup: tc("change_percent", "gt", 1, "volume", "gt", 500000),
  },
  {
    id: tplId(),
    name: "BOSS Scanner BTST",
    description: "Buy Today Sell Tomorrow — momentum continuation",
    category: "bullish",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: tc("change_percent", "gt", 0, "volume", "gt", 300000),
  },

  // ============================================================
  // BEARISH SCANS (8 templates)
  // ============================================================
  {
    id: tplId(),
    name: "Perfect Bearish",
    description: "Strong bearish structure with volume confirmation",
    category: "bearish",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: sc("change_percent", "lte", -2),
  },
  {
    id: tplId(),
    name: "Bearish Engulfing — Strong",
    description: "Full bearish engulf with above-average volume",
    category: "bearish",
    timeframe: "Daily",
    popularity: 5,
    filterGroup: sc("change_percent", "lte", -2),
  },
  {
    id: tplId(),
    name: "Bearish RSI + Stochastic",
    description: "RSI < 50 and Stochastic bearish — momentum decline",
    category: "bearish",
    timeframe: "Daily",
    popularity: 3,
    filterGroup: tc("RSI", "lt", 50, "change_percent", "lt", 0),
  },
  {
    id: tplId(),
    name: "Volume Spike in 5 Mins",
    description: "Sudden volume surge — distribution or accumulation",
    category: "bearish",
    timeframe: "5min",
    popularity: 3,
    filterGroup: tc("change_percent", "lt", 0, "volume", "gt", 500000),
  },
  {
    id: tplId(),
    name: "Stocks in Downtrend",
    description: "Series of lower highs and lower lows",
    category: "bearish",
    timeframe: "Daily",
    popularity: 3,
    filterGroup: tc("change_percent", "lt", 0, "relative_volume_10d_calc", "gt", 0),
  },
  {
    id: tplId(),
    name: "Perfect Sell (Short)",
    description: "Ideal short-sell candidates with bearish structure",
    category: "bearish",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: sc("change_percent", "lte", -3),
  },
  {
    id: tplId(),
    name: "Bearish Engulfing (After 3:15 PM)",
    description: "End-of-day bearish engulfing — next-day short setup",
    category: "bearish",
    timeframe: "Daily",
    popularity: 3,
    filterGroup: sc("change_percent", "lte", -1.5),
  },
  {
    id: tplId(),
    name: "Chanakya Bearish Scanner",
    description: "Multiple bearish confirmations — high probability shorts",
    category: "bearish",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: thr("change_percent", "lt", 0, "volume", "gt", 200000, "close", "gt", 50),
  },

  // ============================================================
  // INTRADAY BULLISH SCANS (8 templates)
  // ============================================================
  {
    id: tplId(),
    name: "Buy Open = Low",
    description: "Opening price equals day's low — strong intraday support",
    category: "intraday_bullish",
    timeframe: "Intraday",
    popularity: 4,
    filterGroup: tc("change_percent", "gt", 1, "volume", "gt", 200000),
  },
  {
    id: tplId(),
    name: "Intraday Momentum Bullish",
    description: "Strong buying momentum with volume today",
    category: "intraday_bullish",
    timeframe: "Intraday",
    popularity: 4,
    filterGroup: tc("change_percent", "gt", 2.5, "volume", "gt", 500000),
  },
  {
    id: tplId(),
    name: "Day Low = High (Bullish)",
    description: "Price bounced from low to near high — strong recovery",
    category: "intraday_bullish",
    timeframe: "Intraday",
    popularity: 3,
    filterGroup: tc("change_percent", "gt", 0, "volume", "gt", 200000),
  },
  {
    id: tplId(),
    name: "Intraday Jackpot Buy",
    description: "High-probability intraday long setup (RK Meena style)",
    category: "intraday_bullish",
    timeframe: "Intraday",
    popularity: 4,
    filterGroup: tc("change_percent", "gt", 1.5, "volume", "gt", 500000),
  },
  {
    id: tplId(),
    name: "BTST / Ready to Bull Run",
    description: "Setup completed — ready to breakout tomorrow",
    category: "intraday_bullish",
    timeframe: "Daily",
    popularity: 3,
    filterGroup: tc("change_percent", "gt", 0, "volume", "gt", 300000),
  },
  {
    id: tplId(),
    name: "RSI Breakout (Intraday)",
    description: "RSI breaking above key level on intraday timeframe",
    category: "intraday_bullish",
    timeframe: "Intraday",
    popularity: 3,
    filterGroup: tc("RSI", "gt", 60, "change_percent", "gt", 0),
  },
  {
    id: tplId(),
    name: "Ichimoku Cloud Top Crossover",
    description: "Price crosses above Ichimoku cloud — bullish signal",
    category: "intraday_bullish",
    timeframe: "Intraday",
    popularity: 3,
    filterGroup: tc("close", "gt", 0, "change_percent", "gt", 0),
  },
  {
    id: tplId(),
    name: "Santu Baba Open=Low +1%",
    description: "Open equals low with 1% higher than previous close",
    category: "intraday_bullish",
    timeframe: "Intraday",
    popularity: 3,
    filterGroup: tc("change_percent", "gt", 1, "volume", "gt", 200000),
  },

  // ============================================================
  // INTRADAY BEARISH SCANS (8 templates)
  // ============================================================
  {
    id: tplId(),
    name: "Sell Open = High",
    description: "Opening price equals day's high — bears in control",
    category: "intraday_bearish",
    timeframe: "Intraday",
    popularity: 4,
    filterGroup: tc("change_percent", "lt", -1, "volume", "gt", 200000),
  },
  {
    id: tplId(),
    name: "Intraday Reversal (Bearish)",
    description: "Stocks that opened high but reversed down",
    category: "intraday_bearish",
    timeframe: "Intraday",
    popularity: 3,
    filterGroup: tc("change_percent", "lt", 0, "volume", "gt", 300000),
  },
  {
    id: tplId(),
    name: "Intraday Future Sell (SuperTrend)",
    description: "F&O stocks giving sell on SuperTrend — 80% accuracy",
    category: "intraday_bearish",
    timeframe: "Intraday",
    popularity: 4,
    filterGroup: thr("change_percent", "lt", 0, "volume", "gt", 500000, "market_cap_basic", "gt", 5000),
  },
  {
    id: tplId(),
    name: "Mohan's Sure Sell (MACD Cross)",
    description: "MACD crossover to downside — momentum shift",
    category: "intraday_bearish",
    timeframe: "Intraday",
    popularity: 3,
    filterGroup: tc("change_percent", "lt", 0, "volume", "gt", 200000),
  },
  {
    id: tplId(),
    name: "Stocks Near Support — Bearish",
    description: "Testing support levels — breakdown risk (Parimal Wadiwala)",
    category: "intraday_bearish",
    timeframe: "15min",
    popularity: 3,
    filterGroup: sc("change_percent", "lt", 0),
  },
  {
    id: tplId(),
    name: "Shot Down (Bearish)",
    description: "Sharp reversal from highs — shooting star pattern",
    category: "intraday_bearish",
    timeframe: "Intraday",
    popularity: 3,
    filterGroup: tc("change_percent", "lt", 0, "volume", "gt", 300000),
  },
  {
    id: tplId(),
    name: "Fully Bearish with Selling Last 15min",
    description: "Distribution in the last 15 minutes — next-day weakness",
    category: "intraday_bearish",
    timeframe: "15min",
    popularity: 3,
    filterGroup: sc("change_percent", "lt", 0),
  },
  {
    id: tplId(),
    name: "Secondary Gap Up Open=High Short",
    description: "Gap up opening but can't hold highs — short setup",
    category: "intraday_bearish",
    timeframe: "Intraday",
    popularity: 3,
    filterGroup: tc("change_percent", "lt", 0, "volume", "gt", 300000),
  },
];

// ============================================================
// HELPERS
// ============================================================

export function getTemplatesByCategory(category: ScreenerCategory): ScreenerTemplate[] {
  return SCREENER_TEMPLATES.filter((t) => t.category === category);
}

export function getTemplateById(id: string): ScreenerTemplate | undefined {
  return SCREENER_TEMPLATES.find((t) => t.id === id);
}

export function searchTemplates(query: string): ScreenerTemplate[] {
  const q = query.toLowerCase();
  return SCREENER_TEMPLATES.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
  );
}

export const TEMPLATE_CATEGORIES: ScreenerCategory[] = [
  "fundamental",
  "technical",
  "candlestick",
  "range_breakout",
  "crossover",
  "bullish",
  "bearish",
  "intraday",
  "intraday_bullish",
  "intraday_bearish",
];
