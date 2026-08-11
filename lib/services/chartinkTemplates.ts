// lib/services/chartinkTemplates.ts
// Chartink scan template registry — loaded from the JSON config folder
// `lib/services/chartink-scans/<category>.json` so scans are trivially
// editable/transportable without code changes.
//
// Each entry mirrors exactly what Chartink's web UI sends to
// /screener/process and /backtest/process:
//   - scanClause:    the DSL filter expression (e.g. profit-jump-by-200)
//   - debugClause:   groupcount(...) breakdowns for multi-condition screens
//   - columnClause:  the output columns (price, % change, volume, ...)
//   - backtestMaxRows: max rows for /backtest/process (UI sends "160")
//
// Entries without a scanClause yet are "catalog-only" (available for
// dropdowns/selection) but cannot be fetched until the clause is added.

import type {
  ChartinkCategoryFile,
  ChartinkTemplate,
} from "@/lib/services/chartinkScansTypes";
import fundamentalScans from "./chartink-scans/fundamental.json";
import topLovedScans from "./chartink-scans/top-loved.json";
import candlestickScans from "./chartink-scans/candlestick-patterns.json";
import rangeBreakoutsScans from "./chartink-scans/range-breakouts.json";
import intradayBullishScans from "./chartink-scans/intraday-bullish.json";
import crossoverScans from "./chartink-scans/crossover.json";
import bullishScans from "./chartink-scans/bullish.json";
import bearishScans from "./chartink-scans/bearish.json";
import intradayBearishScans from "./chartink-scans/intraday-bearish.json";

// ---------------------------------------------------------------------------
// Category definitions (display order + metadata)
// ---------------------------------------------------------------------------

const CATEGORIES: ReadonlyArray<{ id: string; name: string; file: ChartinkCategoryFile }> = [
  { id: "fundamental", name: "Fundamental Scans", file: fundamentalScans },
  { id: "top-loved", name: "Top Loved", file: topLovedScans },
  { id: "candlestick", name: "Candlestick Patterns Scan", file: candlestickScans },
  { id: "range-breakouts", name: "Range Breakouts Scan", file: rangeBreakoutsScans },
  { id: "intraday-bullish", name: "Intraday Bullish Scan", file: intradayBullishScans },
  { id: "crossover", name: "Crossover", file: crossoverScans },
  { id: "bullish", name: "Bullish Scan", file: bullishScans },
  { id: "bearish", name: "Bearish Scan", file: bearishScans },
  { id: "intraday-bearish", name: "Intraday Bearish Scan", file: intradayBearishScans },
];

/** Flattened registry: categoryId -> templates (from the JSON files). */
const REGISTRY: Map<string, ChartinkTemplate> = new Map();

// Build once at module load. A scan missing in its file is simply absent.
for (const category of CATEGORIES) {
  for (const entry of category.file) {
    REGISTRY.set(entry.id, { ...entry, categoryId: category.id });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Category descriptor for dropdowns/selections. */
export interface ChartinkCategory {
  id: string;
  name: string;
  /** Number of scans in this category. */
  count: number;
  /** Number of scans with a scanClause ready to fetch. */
  fetchableCount: number;
}

/**
 * Return the category list (id, name, counts) — used for dropdowns and
 * "categories and selections" UI.
 */
export function getChartinkCategories(): ChartinkCategory[] {
  return CATEGORIES.map((c) => {
    const templates = Array.from(REGISTRY.values()).filter(
      (t) => t.categoryId === c.id,
    );
    return {
      id: c.id,
      name: c.name,
      count: templates.length,
      fetchableCount: templates.filter((t) => !!t.scanClause).length,
    };
  });
}

/**
 * Return all registered templates, optionally filtered by category id.
 * Each template's `url` links back to the Chartink scanner page.
 */
export function getChartinkTemplates(
  categoryId?: string,
): ChartinkTemplate[] {
  const all = Array.from(REGISTRY.values());
  return categoryId ? all.filter((t) => t.categoryId === categoryId) : all;
}

/** Look up a single template by id. */
export function getChartinkTemplate(id: string): ChartinkTemplate | undefined {
  return REGISTRY.get(id);
}

/**
 * Register (or overwrite) a Chartink template at runtime, e.g. from an admin
 * JSON upload. Runtime additions live only in memory.
 */
export function registerChartinkTemplate(template: ChartinkTemplate): void {
  REGISTRY.set(template.id, template);
}

export type { ChartinkTemplate, ChartinkCategoryFile }; 
// eslint-disable-next-line import/no-default-export
export default getChartinkTemplates;