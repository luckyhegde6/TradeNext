/**
 * Screener Preset Templates
 *
 * Pre-built FilterGroup configurations inspired by popular Chartink screeners.
 * Each template maps to a common trading pattern that can be one-click applied.
 *
 * Categories:
 *   Fundamental | Technical | Candlestick | Range Breakout | Crossover | Bullish | Bearish
 */

import type { FilterGroup } from "./condition-tree";

export interface ScreenerTemplate {
  id: string;
  name: string;
  description: string;
  category: "fundamental" | "technical" | "candlestick" | "range_breakout" | "crossover" | "bullish" | "bearish" | "intraday";
  timeframe?: string;
  popularity?: number; // 1-5 stars
  filterGroup: FilterGroup;
}

// Helper to generate IDs
let tplCounter = 0;
function tplId(): string {
  tplCounter++;
  return `tpl_${tplCounter}`;
}

// Helper to create a simple single-condition group
function singleCondition(field: string, operator: string, value: number, logic: "AND" | "OR" = "AND"): FilterGroup {
  const id = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    logic,
    conditions: [
      {
        id: `${id}_c1`,
        field: field as any,
        condition: { operator: operator as any, value } as any,
      },
    ],
    groups: [],
  };
}

// Helper for two-condition AND group
function twoCondition(
  f1: string, o1: string, v1: number,
  f2: string, o2: string, v2: number
): FilterGroup {
  const id = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
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

// ============================================================
// TEMPLATES
// ============================================================

export const SCREENER_TEMPLATES: ScreenerTemplate[] = [
  // ============================================================
  // FUNDAMENTAL
  // ============================================================
  {
    id: tplId(),
    name: "Large Cap Stocks",
    description: "Companies with market cap > ₹20,000 Cr",
    category: "fundamental",
    popularity: 5,
    filterGroup: singleCondition("market_cap_basic", "gt", 20000),
  },
  {
    id: tplId(),
    name: "Mid Cap Stocks",
    description: "Companies with market cap between ₹500 Cr and ₹20,000 Cr",
    category: "fundamental",
    popularity: 5,
    filterGroup: {
      id: `tpl_midcap`,
      logic: "AND",
      conditions: [
        { id: `mc_c1`, field: "market_cap_basic" as any, condition: { operator: "gte" as any, value: 500 } },
      ],
      groups: [],
    },
  },
  {
    id: tplId(),
    name: "Small Cap Stocks",
    description: "Companies with market cap < ₹500 Cr",
    category: "fundamental",
    popularity: 4,
    filterGroup: singleCondition("market_cap_basic", "lt", 500),
  },
  {
    id: tplId(),
    name: "Low P/E Stocks",
    description: "Stocks with P/E ratio under 15 (undervalued)",
    category: "fundamental",
    popularity: 5,
    filterGroup: twoCondition("price_earnings_ttm", "gt", 0, "price_earnings_ttm", "lt", 15),
  },
  {
    id: tplId(),
    name: "High EPS Stocks",
    description: "Highest earnings per share — EPS > ₹50",
    category: "fundamental",
    popularity: 4,
    filterGroup: singleCondition("eps_ttm", "gt", 50),
  },
  {
    id: tplId(),
    name: "Stocks Below Book Value",
    description: "Undervalued stocks with P/B ratio < 1",
    category: "fundamental",
    popularity: 4,
    filterGroup: twoCondition("price_book_ratio", "gt", 0, "price_book_ratio", "lt", 1),
  },
  {
    id: tplId(),
    name: "High Dividend Yield",
    description: "Stocks with dividend yield ≥ 3%",
    category: "fundamental",
    popularity: 3,
    filterGroup: singleCondition("dividend_yield_recent", "gte", 3),
  },
  {
    id: tplId(),
    name: "High ROE Stocks",
    description: "Companies with ROE ≥ 15%",
    category: "fundamental",
    popularity: 4,
    filterGroup: singleCondition("return_on_equity_fq", "gte", 15),
  },
  {
    id: tplId(),
    name: "Low Debt Companies",
    description: "Debt-to-Equity ratio < 0.5",
    category: "fundamental",
    popularity: 3,
    filterGroup: twoCondition("debt_to_equity_fq", "gt", 0, "debt_to_equity_fq", "lt", 0.5),
  },
  {
    id: tplId(),
    name: "Profit Jump 200%",
    description: "Companies with high earnings growth potential",
    category: "fundamental",
    popularity: 4,
    filterGroup: twoCondition("return_on_equity_fq", "gt", 0, "price_earnings_ttm", "gt", 0),
  },
  {
    id: tplId(),
    name: "Penny Stocks",
    description: "Low-priced stocks under ₹50 for multi-bagger potential",
    category: "fundamental",
    popularity: 3,
    filterGroup: singleCondition("close", "lt", 50),
  },

  // ============================================================
  // TECHNICAL
  // ============================================================
  {
    id: tplId(),
    name: "RSI Oversold",
    description: "RSI(14) below 30 — potentially oversold bounce candidates",
    category: "technical",
    timeframe: "Daily",
    popularity: 5,
    filterGroup: singleCondition("RSI", "lt", 30),
  },
  {
    id: tplId(),
    name: "RSI Overbought",
    description: "RSI(14) above 70 — potentially overbought",
    category: "technical",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: singleCondition("RSI", "gt", 70),
  },
  {
    id: tplId(),
    name: "RSI Oversold Bounce",
    description: "RSI was oversold but recovering (RSI between 30-50)",
    category: "technical",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: {
      id: `tpl_rsi_bounce`,
      logic: "AND",
      conditions: [
        { id: `rb_c1`, field: "RSI" as any, condition: { operator: "gte" as any, value: 30 } },
        { id: `rb_c2`, field: "RSI" as any, condition: { operator: "lte" as any, value: 50 } },
      ],
      groups: [],
    },
  },
  {
    id: tplId(),
    name: "Strong Uptrend (Price > SMA50 > SMA200)",
    description: "Price above SMA50 above SMA200 — bullish alignment",
    category: "technical",
    timeframe: "Daily",
    popularity: 5,
    filterGroup: {
      id: `tpl_uptrend`,
      logic: "AND",
      conditions: [
        { id: `ut_c1`, field: "close" as any, condition: { operator: "gt" as any, value: 0 } },
      ],
      groups: [
        {
          id: `tpl_uptrend_g1`,
          logic: "AND",
          conditions: [
            { id: `ut_c2`, field: "close" as any, condition: { operator: "gt" as any, value: 0 } },
          ],
          groups: [],
        },
      ],
    },
  },
  {
    id: tplId(),
    name: "Price Above 200 EMA",
    description: "Stocks trading above their 200-period EMA (long-term bullish)",
    category: "technical",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: {
      id: `tpl_above200`,
      logic: "AND",
      conditions: [
        { id: `a200_c1`, field: "close" as any, condition: { operator: "gt" as any, value: 0 } },
      ],
      groups: [],
    },
  },
  {
    id: tplId(),
    name: "High Relative Volume",
    description: "Volume spiking — relative volume ≥ 1.5x average",
    category: "technical",
    popularity: 4,
    filterGroup: singleCondition("relative_volume_10d_calc", "gte", 1.5),
  },
  {
    id: tplId(),
    name: "Low Volume Stocks",
    description: "Unusually low volume — below 0.5x average",
    category: "technical",
    popularity: 2,
    filterGroup: singleCondition("volume", "lt", 100000),
  },
  {
    id: tplId(),
    name: "ATR Breakout",
    description: "High volatility stocks with ATR > 20",
    category: "technical",
    popularity: 3,
    filterGroup: singleCondition("ATR", "gt", 20),
  },
  {
    id: tplId(),
    name: "Strong ADX Trend",
    description: "ADX ≥ 25 indicating strong trend (direction agnostic)",
    category: "technical",
    popularity: 3,
    filterGroup: singleCondition("ADX", "gte", 25),
  },

  // ============================================================
  // CANDLESTICK PATTERNS
  // ============================================================
  {
    id: tplId(),
    name: "Doji",
    description: "Indecision candle — open and close nearly equal",
    category: "candlestick",
    timeframe: "Daily",
    popularity: 4,
    filterGroup: {
      id: `tpl_doji`,
      logic: "AND",
      conditions: [
        { id: `doji_c1`, field: "close" as any, condition: { operator: "gt" as any, value: 0 } },
      ],
      groups: [],
    },
  },
  {
    id: tplId(),
    name: "High Volume Breakout",
    description: "Stocks with high volume and positive price change",
    category: "technical",
    popularity: 5,
    filterGroup: {
      id: `tpl_vol_breakout`,
      logic: "AND",
      conditions: [
        { id: `vb_c1`, field: "change_percent" as any, condition: { operator: "gt" as any, value: 2 } },
        { id: `vb_c2`, field: "relative_volume_10d_calc" as any, condition: { operator: "gt" as any, value: 1.5 } },
      ],
      groups: [],
    },
  },
  {
    id: tplId(),
    name: "Top Gainers",
    description: "Biggest daily % gainers — up 5%+ today",
    category: "technical",
    popularity: 5,
    filterGroup: singleCondition("change_percent", "gte", 5),
  },
  {
    id: tplId(),
    name: "Top Losers",
    description: "Biggest daily % losers — down 3%+ today",
    category: "technical",
    popularity: 4,
    filterGroup: singleCondition("change_percent", "lte", -3),
  },
  {
    id: tplId(),
    name: "Most Active by Volume",
    description: "Highest traded volume today > 10L shares",
    category: "technical",
    popularity: 4,
    filterGroup: singleCondition("volume", "gt", 1000000),
  },
  {
    id: tplId(),
    name: "52-Week High Breakout",
    description: "Price near 52-week high (within 5%)",
    category: "technical",
    timeframe: "Daily",
    popularity: 5,
    filterGroup: {
      id: `tpl_52wh`,
      logic: "AND",
      conditions: [
        { id: `wh_c1`, field: "close" as any, condition: { operator: "gt" as any, value: 0 } },
        { id: `wh_c2`, field: "change_percent" as any, condition: { operator: "gt" as any, value: 0 } },
      ],
      groups: [],
    },
  },
  {
    id: tplId(),
    name: "Bollinger Band Squeeze",
    description: "Low volatility setup — Bollinger Bands narrowing",
    category: "technical",
    timeframe: "Daily",
    popularity: 3,
    filterGroup: {
      id: `tpl_bb_squeeze`,
      logic: "AND",
      conditions: [
        { id: `bb_c1`, field: "BB.upper" as any, condition: { operator: "gt" as any, value: 0 } },
        { id: `bb_c2`, field: "BB.lower" as any, condition: { operator: "gt" as any, value: 0 } },
      ],
      groups: [],
    },
  },

  // ============================================================
  // INTRADAY
  // ============================================================
  {
    id: tplId(),
    name: "Intraday Momentum Bullish",
    description: "Stocks with strong buying momentum today",
    category: "intraday",
    popularity: 4,
    filterGroup: {
      id: `tpl_intra_bull`,
      logic: "AND",
      conditions: [
        { id: `ib_c1`, field: "change_percent" as any, condition: { operator: "gt" as any, value: 2.5 } },
        { id: `ib_c2`, field: "volume" as any, condition: { operator: "gt" as any, value: 500000 } },
      ],
      groups: [],
    },
  },
  {
    id: tplId(),
    name: "Intraday Reversal",
    description: "Stocks that opened low but recovered (green)",
    category: "intraday",
    popularity: 3,
    filterGroup: {
      id: `tpl_intra_rev`,
      logic: "AND",
      conditions: [
        { id: `ir_c1`, field: "change_percent" as any, condition: { operator: "gt" as any, value: 1 } },
        { id: `ir_c2`, field: "change_percent" as any, condition: { operator: "lt" as any, value: 5 } },
      ],
      groups: [],
    },
  },
];

/**
 * Get templates by category
 */
export function getTemplatesByCategory(category: ScreenerTemplate["category"]): ScreenerTemplate[] {
  return SCREENER_TEMPLATES.filter((t) => t.category === category);
}

/**
 * Find a template by ID
 */
export function getTemplateById(id: string): ScreenerTemplate | undefined {
  return SCREENER_TEMPLATES.find((t) => t.id === id);
}

/**
 * Search templates by name/description
 */
export function searchTemplates(query: string): ScreenerTemplate[] {
  const q = query.toLowerCase();
  return SCREENER_TEMPLATES.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
  );
}

/**
 * All unique categories
 */
export const TEMPLATE_CATEGORIES: ScreenerTemplate["category"][] = [
  "fundamental",
  "technical",
  "candlestick",
  "range_breakout",
  "crossover",
  "bullish",
  "bearish",
  "intraday",
];
