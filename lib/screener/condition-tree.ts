/**
 * Condition Tree — Filter grammar types for the Advanced Screener.
 *
 * Defines a recursive condition tree with AND/OR logic groups,
 * typed filter fields, operators, and Zod validation schemas.
 *
 * This is the shared type system used by:
 *   - Filter Builder UI (frontend)
 *   - Condition Evaluation Engine (server)
 *   - API request/response validation
 *   - Scan Config persistence
 */

import { z } from "zod";

// ============================================================
// Filter Fields — the universe of available filters
// ============================================================

export const FILTER_FIELDS = {
  // Price
  close: { label: "Price", category: "price", type: "number" },
  open: { label: "Open", category: "price", type: "number" },
  high: { label: "High", category: "price", type: "number" },
  low: { label: "Low", category: "price", type: "number" },
  change: { label: "Change (₹)", category: "price", type: "number" },
  change_percent: { label: "% Change", category: "price", type: "number" },
  "52_week_high": { label: "52W High", category: "price", type: "number" },
  "52_week_low": { label: "52W Low", category: "price", type: "number" },

  // Volume
  volume: { label: "Volume", category: "volume", type: "number" },
  relative_volume_10d_calc: { label: "Relative Volume (10d)", category: "volume", type: "number" },
  average_volume_50: { label: "Avg Volume (50d)", category: "volume", type: "number" },

  // Fundamentals
  market_cap_basic: { label: "Market Cap", category: "fundamental", type: "number" },
  price_earnings_ttm: { label: "P/E (TTM)", category: "fundamental", type: "number" },
  price_book_ratio: { label: "P/B", category: "fundamental", type: "number" },
  dividend_yield_recent: { label: "Dividend Yield", category: "fundamental", type: "number" },
  return_on_equity_fq: { label: "ROE", category: "fundamental", type: "number" },
  debt_to_equity_fq: { label: "Debt/Equity", category: "fundamental", type: "number" },
  eps_ttm: { label: "EPS (TTM)", category: "fundamental", type: "number" },
  total_revenue: { label: "Revenue", category: "fundamental", type: "number" },
  sector: { label: "Sector", category: "fundamental", type: "string" },
  industry: { label: "Industry", category: "fundamental", type: "string" },

  // Technical indicators
  RSI: { label: "RSI (14)", category: "technical", type: "number" },
  "MACD.macd": { label: "MACD Line", category: "technical", type: "number" },
  "MACD.signal": { label: "MACD Signal", category: "technical", type: "number" },
  "MACD.histogram": { label: "MACD Histogram", category: "technical", type: "number" },
  SMA20: { label: "SMA (20)", category: "technical", type: "number" },
  SMA50: { label: "SMA (50)", category: "technical", type: "number" },
  SMA200: { label: "SMA (200)", category: "technical", type: "number" },
  EMA20: { label: "EMA (20)", category: "technical", type: "number" },
  "BB.upper": { label: "Bollinger Upper", category: "technical", type: "number" },
  "BB.middle": { label: "Bollinger Middle", category: "technical", type: "number" },
  "BB.lower": { label: "Bollinger Lower", category: "technical", type: "number" },
  "BB.percent_b": { label: "%B", category: "technical", type: "number" },
  VolSMA20: { label: "Volume SMA (20)", category: "technical", type: "number" },
  ADX: { label: "ADX", category: "technical", type: "number" },
  "ADX.positive_di": { label: "+DI", category: "technical", type: "number" },
  "ADX.negative_di": { label: "-DI", category: "technical", type: "number" },
  Williams_R: { label: "Williams %R", category: "technical", type: "number" },
  AO: { label: "Awesome Oscillator", category: "technical", type: "number" },
  "Stoch.K": { label: "Stochastic %K", category: "technical", type: "number" },
  "Stoch.D": { label: "Stochastic %D", category: "technical", type: "number" },
  "Stoch.RSI.K": { label: "Stoch RSI %K", category: "technical", type: "number" },
  ATR: { label: "ATR", category: "technical", type: "number" },
  Chaikin_Money_Flow: { label: "Chaikin Money Flow", category: "technical", type: "number" },
  Beta_3Y: { label: "Beta (3Y)", category: "technical", type: "number" },

  // Performance
  "Perf.W": { label: "1W Performance", category: "performance", type: "number" },
  "Perf.M": { label: "1M Performance", category: "performance", type: "number" },
  "Perf.3M": { label: "3M Performance", category: "performance", type: "number" },
  "Perf.6M": { label: "6M Performance", category: "performance", type: "number" },
  "Perf.YTD": { label: "YTD Performance", category: "performance", type: "number" },
  "Perf.12M": { label: "1Y Performance", category: "performance", type: "number" },

  // Ratings
  technical_rating: { label: "Technical Rating", category: "rating", type: "string" },
  analyst_rating: { label: "Analyst Rating", category: "rating", type: "string" },
  recommendation: { label: "Recommendation", category: "rating", type: "string" },
} as const;

export type FilterField = keyof typeof FILTER_FIELDS;

export interface FieldMeta {
  label: string;
  category: "price" | "volume" | "fundamental" | "technical" | "performance" | "rating";
  type: "number" | "string";
}

// ============================================================
// Operators
// ============================================================

export const NUMERIC_OPERATORS = [
  "gt", "gte", "lt", "lte", "eq", "neq", "between",
  "crosses_above", "crosses_below",
] as const;

export const STRING_OPERATORS = [
  "eq", "neq", "in", "not_in",
] as const;

export type NumericOperator = (typeof NUMERIC_OPERATORS)[number];
export type StringOperator = (typeof STRING_OPERATORS)[number];
export type FilterOperator = NumericOperator | StringOperator;

// ============================================================
// Condition — a single filter condition
// ============================================================

export interface NumericConditionValue {
  operator: NumericOperator;
  value: number;
  value2?: number; // For "between": { min, max }
  field2?: string; // For crossover conditions: SMA50 crosses SMA200
}

export interface StringConditionValue {
  operator: StringOperator;
  value: string | string[];
}

export type ConditionValue = NumericConditionValue | StringConditionValue;

export interface FilterCondition {
  id: string;
  field: FilterField;
  /** Human-readable label for display (set from FILTER_FIELDS) */
  fieldLabel?: string;
  condition: ConditionValue;
}

// ============================================================
// Filter Group — recursive AND/OR tree node
// ============================================================

export interface FilterGroup {
  id: string;
  logic: "AND" | "OR";
  conditions: FilterCondition[];
  groups: FilterGroup[]; // Nested sub-groups
}

// ============================================================
// Zod Schemas for runtime validation (API inputs)
// ============================================================

const numericOperatorSchema = z.enum(NUMERIC_OPERATORS);
const stringOperatorSchema = z.enum(STRING_OPERATORS);

const numericConditionSchema: z.ZodType<NumericConditionValue> = z.object({
  operator: numericOperatorSchema,
  value: z.number(),
  value2: z.number().optional(),
  field2: z.string().optional(),
});

const stringConditionSchema = z.object({
  operator: stringOperatorSchema,
  value: z.union([z.string(), z.array(z.string())]),
}) satisfies z.ZodType<unknown>;

const conditionValueSchema = z.union([
  numericConditionSchema,
  stringConditionSchema,
]) satisfies z.ZodType<unknown>;

// Use z.object() directly; runtime validation is string-based
// (the FilterField type constraint is enforced at the TypeScript level)
const filterConditionSchema = z.object({
  id: z.string().min(1),
  field: z.string(),
  fieldLabel: z.string().optional(),
  condition: conditionValueSchema,
}) satisfies z.ZodType<unknown>;

// Zod v4 recursive schema using z.lazy()
const filterGroupSchema: z.ZodType<FilterGroup> = z.object({
  id: z.string().min(1),
  logic: z.enum(["AND", "OR"]),
  conditions: z.array(filterConditionSchema),
  groups: z.lazy(() => z.array(filterGroupSchema)),
}) as unknown as z.ZodType<FilterGroup>;

export { filterGroupSchema, filterConditionSchema, conditionValueSchema };

// ============================================================
// Scan Request / Response types
// ============================================================

export interface ScanRequest {
  filterGroup: FilterGroup;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  /** Extra columns to request from TradingView (beyond defaults) */
  extraColumns?: string[];
}

export interface ScanResponse {
  stocks: ScannedStock[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  executionMs: number;
  lastSyncedAt: string | null;
}

export interface ScannedStock {
  symbol: string;
  name?: string;
  close?: number;
  change?: number;
  percentChange?: number;
  volume?: number;
  [key: string]: unknown; // Allow any TradingView column
}

// ============================================================
// Config persistence types
// ============================================================

export interface SaveScanConfigRequest {
  name: string;
  description?: string;
  filterGroup: FilterGroup;
  columns?: string[];
  schedule?: string; // Cron expression
  isPublic?: boolean;
}

export interface UpdateScanConfigRequest extends Partial<SaveScanConfigRequest> {
  id: string;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Get field metadata from the FILTER_FIELDS registry.
 */
export function getFieldMeta(field: string): FieldMeta | undefined {
  return FILTER_FIELDS[field as FilterField] as FieldMeta | undefined;
}

/**
 * Check whether a field's value type is numeric.
 */
export function isNumericField(field: string): boolean {
  const meta = getFieldMeta(field);
  return meta?.type === "number";
}

/**
 * Get TV-compatible columns needed to evaluate all conditions in a tree.
 * Resolves the set of required TradingView scanner columns.
 */
export function getRequiredColumns(filterGroup: FilterGroup): string[] {
  const cols = new Set<string>();

  function walk(group: FilterGroup) {
    for (const c of group.conditions) {
      cols.add(c.field);
      if (c.condition.operator === "crosses_above" || c.condition.operator === "crosses_below") {
        const nc = c.condition as NumericConditionValue;
        if (nc.field2) cols.add(nc.field2);
      }
    }
    for (const g of group.groups) walk(g);
  }

  walk(filterGroup);

  // Add default columns always needed
  const defaults = ["name", "close", "change", "volume", "market_cap_basic",
    "price_earnings_ttm", "sector", "industry"];

  for (const d of defaults) cols.add(d);

  return Array.from(cols);
}

/**
 * Count the total number of conditions in a tree (for validation).
 */
export function countConditions(filterGroup: FilterGroup): number {
  let count = filterGroup.conditions.length;
  for (const g of filterGroup.groups) count += countConditions(g);
  return count;
}

/**
 * Create an empty filter group with a single default condition.
 */
export function createDefaultFilterGroup(): FilterGroup {
  return {
    id: crypto.randomUUID(),
    logic: "AND",
    conditions: [
      {
        id: crypto.randomUUID(),
        field: "close",
        condition: {
          operator: "gt",
          value: 0,
        },
      },
    ],
    groups: [],
  };
}
