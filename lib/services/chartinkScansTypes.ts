// lib/services/chartinkScansTypes.ts
// Shared types for the Chartink scan template registry (JSON-backed).
// Kept in a separate module so the JSON config files stay pure data and the
// loader (chartinkTemplates.ts) + consumers (scan/backtest services) share
// one definition.

/** A single scan entry inside a category JSON file. */
export interface ChartinkTemplate {
  /** Stable unique id, e.g. "fundamental.profit-jump-by-200". */
  id: string;
  /** Human-readable name, e.g. "Profit Jump by 200%". */
  name: string;
  /** Chartink scanner page URL this template was captured from. */
  url: string;
  /** Category this scan belongs to (assigned by the loader). */
  categoryId: string;
  /**
   * The scan_clause DSL sent to /screener/process and /backtest/process.
   * May be empty for catalog-only entries (clause not yet provided).
   */
  scanClause?: string;
  /** Optional groupcount(...) breakdown for multi-condition screens. */
  debugClause?: string;
  /** Optional column_clause for /screener/process output columns. */
  columnClause?: string;
  /** Max rows requested from /backtest/process (Chartink UI sends "160"). */
  backtestMaxRows?: number;
}

/**
 * Shape of one category JSON file: an array of template entries.
 * `categoryId` is absent from the files — the loader assigns it from the
 * category the file represents.
 */
export type ChartinkCategoryFile = Array<Omit<ChartinkTemplate, "categoryId">>;