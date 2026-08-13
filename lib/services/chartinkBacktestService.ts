// lib/services/chartinkBacktestService.ts
// Fetch backtest results from Chartink's /backtest/process endpoint using a
// template's native scan_clause DSL. This mirrors what the Chartink web UI
// sends when you hit "Backtest" on a screener page, so the results match the
// site exactly.
//
// Response shape (captured from the live site):
//   {
//     metaData: {
//       columnAliases: {...},
//       availableLimit: 26, maxRows: 160, isTrend: true, limit: 100,
//       groups: ["AUTO","BANK",...],          // sector list (paired with groupData)
//       tradeTimes: [epochMs...],             // one bucket per backtest step
//       lastUpdateTime: epochMs,
//     },
//     aggregatedStockList: [ [ [sym,capClass,sector]... ], ... ],  // per tradeTime
//     groupData: [{ name: "AUTO", results: [{ "<expr>": [counts per bucket] }] }],
//     time, baseTime, link
//   }

import logger from "@/lib/logger";
import { staticCache } from "@/lib/cache";
import {
  getChartinkTemplate,
  type ChartinkTemplate,
} from "@/lib/services/chartinkTemplates";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single stock entry inside an aggregatedStockList timeframe bucket. */
export interface ChartinkBacktestStock {
  symbol: string;
  /** Market-cap bucket tag (e.g. "L" / "M" / "S" / "MC"). */
  capClass: string;
  /** Sector name (e.g. "BANK", "AUTO", "REALTY"). */
  sector: string;
}

/** One backtest group (sector) series — counts per tradeTime bucket. */
export interface ChartinkBacktestGroup {
  name: string;
  /** Count per tradeTime bucket (length === tradeTimes.length). */
  counts: number[];
}

/** Normalised backtest result. */
export interface ChartinkBacktestResult {
  templateId: string;
  templateName: string;
  /** Sector names, in Chartink's order (index-aligned with groups). */
  groups: string[];
  /** Epoch ms per backtest step (index-aligned with timeSeries). */
  tradeTimes: number[];
  /** Stock membership per backtest step (index-aligned with tradeTimes). */
  timeSeries: ChartinkBacktestStock[][];
  /** Per-sector count series (index-aligned with tradeTimes). */
  groupSeries: ChartinkBacktestGroup[];
  /** Total distinct stocks ever seen across all time buckets. */
  totalStocks: number;
  /** Latest bucket's stocks (most recent backtest step = current match). */
  currentStocks: ChartinkBacktestStock[];
  /** Raw scanlink id from the response. */
  link?: string;
  /** Epoch ms when the backtest was fetched. */
  fetchedAt: number;
}

/** The raw Chartink /backtest/process payload (as captured). */
export interface ChartinkBacktestResponse {
  metaData?: {
    /** Expression → alias mapping for the groupcount columns. */
    columnAliases?: Record<string, string>;
    availableLimit?: number;
    maxRows?: number;
    isTrend?: boolean;
    limit?: number;
    groups?: string[];
    tradeTimes?: number[];
    lastUpdateTime?: number;
  };
  aggregatedStockList?: unknown[];
  groupData?: Array<{
    name?: string;
    results?: Array<Record<string, unknown>>;
  }>;
  time?: number;
  baseTime?: number;
  link?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHARTINK_BACKTEST_URL = "https://chartink.com/backtest/process";

/** Browser-like headers; Chartink rejects plain curl/undici defaults. */
const CHARTINK_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Referer: "https://chartink.com/screener",
  Accept: "application/json, text/plain, */*",
};

/** Cache prefix for template backtest results. */
const CACHE_PREFIX = "chartink-backtest";
/** Cache TTL: 10 minutes (backtests are heavier than scans). */
const CACHE_TTL = 600;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate + normalise the aggregatedStockList buckets.
 * Each timeframe bucket is an array of [symbol, capClass, sector] triplets;
 * empty buckets are valid (no stocks matched at that step).
 */
function parseStockList(raw: unknown): ChartinkBacktestStock[][] {
  if (!Array.isArray(raw)) return [];

  return raw.map((bucket) => {
    if (!Array.isArray(bucket)) return [];
    return bucket
      .map((entry): ChartinkBacktestStock | null => {
        if (!Array.isArray(entry) || entry.length < 3) return null;
        const [symbol, capClass, sector] = entry as [unknown, unknown, unknown];
        const sym = String(symbol ?? "").trim().toUpperCase();
        if (!sym) return null;
        return {
          symbol: sym,
          capClass: String(capClass ?? ""),
          sector: String(sector ?? ""),
        };
      })
      .filter((e): e is ChartinkBacktestStock => e !== null);
  });
}

/** Parse groupData into per-sector count series. */
function parseGroupSeries(
  raw: unknown,
  groups: string[],
  tradeTimes: number[],
): ChartinkBacktestGroup[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry) => {
      const name = String(entry?.name ?? "").trim();
      if (!name) return null;

      // results[0] holds { "<debug-expr>": [counts...] } — grab its first
      // numeric array as the count series for this sector.
      const resultsArr = Array.isArray(entry?.results) ? entry.results : [];
      let counts: number[] = [];
      for (const res of resultsArr) {
        if (res && typeof res === "object") {
          for (const value of Object.values(res)) {
            if (Array.isArray(value)) {
              counts = value.map(Number);
              break;
            }
          }
        }
        if (counts.length > 0) break;
      }

      // Ensure the series matches tradeTimes length (pad/truncate defensively)
      if (counts.length !== tradeTimes.length) {
        counts = tradeTimes.map((_, i) => counts[i] ?? 0);
      }

      return { name, counts };
    })
    .filter((e): e is ChartinkBacktestGroup => e !== null);
}

// ---------------------------------------------------------------------------
// Core fetch + parse
// ---------------------------------------------------------------------------

/**
 * Fetch a template's backtest from Chartink.
 * Returns an empty result (all arrays []) when the response can't be parsed.
 */
export async function fetchChartinkBacktest(
  template: ChartinkTemplate,
  options: { forceRefresh?: boolean } = {},
): Promise<ChartinkBacktestResult> {
  const { forceRefresh = false } = options;
  const cacheKey = `${CACHE_PREFIX}:${template.id}`;

  if (!forceRefresh) {
    const cached = staticCache.get(cacheKey);
    if (cached) {
      logger.debug({
        msg: "Chartink backtest cache hit",
        templateId: template.id,
      });
      return cached as ChartinkBacktestResult;
    }
  }

  // Catalog-only templates (clause not yet provided) can't be backtested yet.
  if (!template.scanClause) {
    throw new Error(
      `Chartink template has no scan_clause yet (catalog-only): ${template.id}`,
    );
  }

  const body: Record<string, unknown> = { scan_clause: template.scanClause };
  // Chartink UI defaults to max_rows "160" for backtests.
  body["max_rows"] = String(template.backtestMaxRows ?? 160);

  logger.info({
    msg: "Fetching Chartink backtest",
    templateId: template.id,
    templateName: template.name,
  });

  const start = Date.now();
  const response = await fetch(CHARTINK_BACKTEST_URL, {
    method: "POST",
    headers: CHARTINK_HEADERS,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Chartink backtest HTTP ${response.status}`);
  }

  const json = (await response.json()) as ChartinkBacktestResponse;

  // metaData.groups vs metaData.tradeTimes — sectors and bucket timestamps
  const groups = Array.isArray(json.metaData?.groups)
    ? json.metaData.groups.map(String)
    : [];
  const tradeTimes = Array.isArray(json.metaData?.tradeTimes)
    ? json.metaData.tradeTimes.map(Number)
    : [];

  const timeSeries = parseStockList(json.aggregatedStockList);
  const groupSeries = parseGroupSeries(json.groupData, groups, tradeTimes);

  // Normalise: timeSeries must be index-aligned with tradeTimes
  if (tradeTimes.length > 0 && timeSeries.length !== tradeTimes.length) {
    // Pad with empty buckets or truncate — Chartink always aligns them, this
    // is defensive only.
    while (timeSeries.length < tradeTimes.length) timeSeries.push([]);
    timeSeries.length = tradeTimes.length;
  }

  const flat = timeSeries.flat();
  const currentStocks = timeSeries[timeSeries.length - 1] ?? [];

  const result: ChartinkBacktestResult = {
    templateId: template.id,
    templateName: template.name,
    groups,
    tradeTimes,
    timeSeries,
    groupSeries,
    totalStocks: new Set(flat.map((s) => s.symbol)).size,
    currentStocks,
    link: json.link,
    fetchedAt: Date.now(),
  };

  logger.info({
    msg: "Chartink backtest fetched",
    templateId: template.id,
    steps: tradeTimes.length,
    totalStocks: result.totalStocks,
    currentStocks: currentStocks.length,
    elapsed: Date.now() - start,
  });

  staticCache.set(cacheKey, result, CACHE_TTL);
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a template backtest by id.  Convenience wrapper around
 * {@link fetchChartinkBacktest} for callers that only have an id.
 *
 * @throws When the template id is unknown.
 */
export async function runChartinkBacktestById(
  templateId: string,
  options: { forceRefresh?: boolean } = {},
): Promise<ChartinkBacktestResult> {
  const template = getChartinkTemplate(templateId);
  if (!template) {
    throw new Error(`Unknown Chartink template: ${templateId}`);
  }
  return fetchChartinkBacktest(template, options);
}