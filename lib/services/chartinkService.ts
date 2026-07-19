// lib/services/chartinkService.ts
// Hybrid screener: Chartink API first, TradingView fallback
// Used by the Daily Recommendations Engine (v3.3.0)

import logger from "@/lib/logger";
import { staticCache } from "@/lib/cache";
import { advancedScan } from "@/lib/services/tradingview-service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw stock row returned by Chartink's screener API. */
export interface ChartinkStock {
  nse_script_code: string;
  name: string;
  close: number;
  change: number;
  pChange: number;
  volume: number;
  [key: string]: unknown;
}

/** Definition of a single daily screener. */
export interface ScreenerDef {
  id: string;
  name: string;
  /** Chartink template ID (e.g. "tpl_27") or a raw DSL query string. */
  chartinkTemplate: string;
  /** Equivalent TradingView filter conditions used when Chartink is unavailable. */
  tradingviewFilters: {
    left: string;
    operation: string;
    right: number;
  }[];
  /** Extra TradingView columns required beyond defaults. */
  tradingviewColumns?: string[];
}

/** De-duplicated stock after merging results from all screeners. */
export interface ScreenerResult {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  /** Names of screeners that flagged this stock. */
  screenerNames: string[];
  /** Number of screeners that flagged this stock (higher = stronger signal). */
  screenerCount: number;
}

/** Internal wrapper pairing raw stocks with the screener that produced them. */
interface ScreenerRun {
  stocks: ChartinkStock[];
  screenerName: string;
}

// ---------------------------------------------------------------------------
// Screener definitions — the 7 daily screeners
// ---------------------------------------------------------------------------

const DAILY_SCREENERS: ScreenerDef[] = [
  {
    id: "short_term_breakouts",
    name: "Short Term Breakouts",
    chartinkTemplate: "tpl_27",
    tradingviewFilters: [
      { left: "close", operation: "greater", right: 0 },
      { left: "relative_volume_10d_calc", operation: "greater", right: 1.5 },
    ],
  },
  {
    id: "rsi_overbought_oversold",
    name: "RSI Overbought / Oversold",
    chartinkTemplate: "tpl_11+12",
    tradingviewFilters: [
      { left: "RSI", operation: "less", right: 30 },
    ],
    tradingviewColumns: ["RSI"],
  },
  {
    id: "boss_scanner_btst",
    name: "BOSS Scanner BTST",
    chartinkTemplate: "tpl_57",
    tradingviewFilters: [
      { left: "relative_volume_10d_calc", operation: "greater", right: 2 },
      { left: "change_percent", operation: "greater", right: 0 },
    ],
  },
  {
    id: "bullish_momentum",
    name: "Bullish Momentum",
    chartinkTemplate: "tpl_50",
    tradingviewFilters: [
      { left: "change_percent", operation: "greater", right: 2 },
      { left: "relative_volume_10d_calc", operation: "greater", right: 1.5 },
    ],
  },
  {
    id: "bullish_marubozu_15m",
    name: "Bullish Marubozu 15min",
    chartinkTemplate: "tpl_40",
    tradingviewFilters: [
      { left: "change_percent", operation: "greater", right: 1 },
    ],
  },
  {
    id: "potential_breakouts",
    name: "Potential Breakouts",
    chartinkTemplate: "tpl_28",
    tradingviewFilters: [
      { left: "close", operation: "greater", right: 0 },
      { left: "relative_volume_10d_calc", operation: "greater", right: 1.2 },
    ],
  },
  {
    id: "first_15min_breakout",
    name: "First 15min Breakout",
    chartinkTemplate: "tpl_33",
    tradingviewFilters: [
      { left: "change_percent", operation: "greater", right: 1.5 },
      { left: "relative_volume_10d_calc", operation: "greater", right: 1 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Chartink helpers
// ---------------------------------------------------------------------------

const CHARTINK_BASE = "https://chartink.com/screener";
const CHARTINK_SCAN_URL = `${CHARTINK_BASE}/process`;

/** HTTP headers that mimic a browser request to Chartink. */
const CHARTINK_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Referer: CHARTINK_BASE,
  Accept: "application/json, text/plain, */*",
};

/**
 * Try running a screener through the Chartink API.
 *
 * Chartink accepts either:
 *  - A template payload: `{ "template": "tpl_27" }`
 *  - A DSL query body:   `{ "query": "( {cash} ( market cap > 10000 ) )" }`
 *
 * We attempt the template first; if the template ID looks like a raw query
 * string (doesn't start with "tpl_") we send it as a query instead.
 */
async function tryChartink(screener: ScreenerDef): Promise<ChartinkStock[]> {
  const isTemplate = screener.chartinkTemplate.startsWith("tpl_");
  const body = isTemplate
    ? { template: screener.chartinkTemplate }
    : { query: screener.chartinkTemplate };

  const response = await fetch(CHARTINK_SCAN_URL, {
    method: "POST",
    headers: CHARTINK_HEADERS,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Chartink HTTP ${response.status}`);
  }

  const json = await response.json() as Record<string, unknown>;

  // Chartink returns either:
  //   { data: ChartinkStock[] }                  (new format)
  //   { data: ChartinkStock[], recordsTotal: N }  (DataTables format)
  const raw = json.data;
  if (!Array.isArray(raw)) {
    throw new Error("Chartink returned no data array");
  }

  return raw as ChartinkStock[];
}

// ---------------------------------------------------------------------------
// TradingView fallback
// ---------------------------------------------------------------------------

/**
 * Run a screener via the TradingView scanner API (direct, no middleman).
 *
 * Each screener maps to a set of TradingView filter conditions.  We always
 * add the NSE exchange filter and request the columns needed for scoring.
 */
async function tryTradingView(screener: ScreenerDef): Promise<ChartinkStock[]> {
  const columns = [
    "name",
    "close",
    "change",
    "change_percent",
    "volume",
    "relative_volume_10d_calc",
    "SMA20",
    "SMA50",
    "high",
    "low",
    "open",
    "Perf.W",
    "Perf.M",
    ...(screener.tradingviewColumns ?? []),
  ];

  const rows = await advancedScan(
    screener.tradingviewFilters,
    columns,
    { from: 0, to: 500 },
  );

  // Map TradingView rows back to ChartinkStock shape so downstream
  // deduplication works uniformly.
  return rows.map((row) => {
    const symbol = String(row.symbol ?? "");
    const nseCode = symbol.includes(":") ? symbol.split(":")[1] : symbol;

    return {
      nse_script_code: nseCode,
      name: String(row.name ?? row.description ?? nseCode),
      close: Number(row.close ?? 0),
      change: Number(row.change ?? 0),
      pChange: Number(row.change_percent ?? 0),
      volume: Number(row.volume ?? 0),
      // Preserve extras for downstream consumers
      _tvRow: row,
    } as ChartinkStock;
  });
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Run a single screener with Chartink-first, TradingView-fallback strategy.
 * Returns the raw {@link ChartinkStock} list regardless of which source
 * provided the data.
 */
async function runScreenerWithFallback(
  screener: ScreenerDef,
): Promise<ChartinkStock[]> {
  try {
    const chartinkResults = await tryChartink(screener);
    if (chartinkResults.length > 0) {
      return chartinkResults;
    }
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    logger.warn({
      msg: "Chartink failed, falling back to TradingView",
      screener: screener.name,
      error: errMsg,
    });
  }

  return tryTradingView(screener);
}

/**
 * Merge a list of per-screener runs into de-duplicated {@link ScreenerResult}
 * entries, tracking which screeners flagged each stock.
 */
function deduplicateResults(runs: ScreenerRun[]): ScreenerResult[] {
  const map = new Map<
    string,
    {
      name: string;
      price: number;
      change: number;
      changePercent: number;
      volume: number;
      screenerNames: Set<string>;
    }
  >();

  for (const run of runs) {
    for (const stock of run.stocks) {
      const symbol = stock.nse_script_code?.toUpperCase();
      if (!symbol) continue;

      const existing = map.get(symbol);
      if (existing) {
        existing.screenerNames.add(run.screenerName);
        // Update price/volume to latest available non-zero values
        if (stock.close > 0) existing.price = stock.close;
        if (stock.change !== 0) existing.change = stock.change;
        if (stock.pChange !== 0) existing.changePercent = stock.pChange;
        if (stock.volume > 0) existing.volume = stock.volume;
      } else {
        map.set(symbol, {
          name: stock.name || symbol,
          price: stock.close,
          change: stock.change,
          changePercent: stock.pChange,
          volume: stock.volume,
          screenerNames: new Set([run.screenerName]),
        });
      }
    }
  }

  // Convert to array, compute count, and sort by screener agreement
  const results: ScreenerResult[] = Array.from(map.entries()).map(
    ([symbol, data]) => ({
      symbol,
      name: data.name,
      price: data.price,
      change: data.change,
      changePercent: data.changePercent,
      volume: data.volume,
      screenerNames: Array.from(data.screenerNames),
      screenerCount: data.screenerNames.size,
    }),
  );

  results.sort((a, b) => b.screenerCount - a.screenerCount || b.volume - a.volume);

  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Cache key prefix for daily screener results. */
const CACHE_KEY = "daily-recommendations:screener-results";
/** Cache duration: 5 minutes. */
const CACHE_TTL = 300;

/**
 * Run all 7 daily screeners, deduplicate results, and return a ranked list.
 *
 * Results are cached for 5 minutes to avoid redundant API calls when the
 * recommendation engine polls repeatedly.
 *
 * @param options.forceRefresh  Skip the cache and fetch fresh data.
 * @returns De-duplicated, ranked list of stocks flagged by one or more screeners.
 */
export async function runDailyScreeners(
  options: { forceRefresh?: boolean } = {},
): Promise<ScreenerResult[]> {
  const { forceRefresh = false } = options;

  if (!forceRefresh) {
    const cached = staticCache.get(CACHE_KEY);
    if (cached) {
      logger.debug({ msg: "Daily screeners cache hit" });
      return cached as ScreenerResult[];
    }
  }

  const overallStart = Date.now();
  logger.info({ msg: "Running daily screeners", count: DAILY_SCREENERS.length });

  // Run all screeners in parallel; individual failures are isolated
  const settled = await Promise.allSettled(
    DAILY_SCREENERS.map(async (screener) => {
      const start = Date.now();
      try {
        const stocks = await runScreenerWithFallback(screener);
        const elapsed = Date.now() - start;
        logger.info({
          msg: "Screener completed",
          screener: screener.name,
          stocks: stocks.length,
          elapsed,
        });
        return { stocks, screenerName: screener.name };
      } catch (e: unknown) {
        const elapsed = Date.now() - start;
        const errMsg = e instanceof Error ? e.message : String(e);
        logger.error({
          msg: "Screener failed",
          screener: screener.name,
          error: errMsg,
          elapsed,
        });
        // Return empty so other screeners are unaffected
        return { stocks: [] as ChartinkStock[], screenerName: screener.name };
      }
    }),
  );

  // Collect successful runs
  const runs: ScreenerRun[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      runs.push(result.value);
    }
  }

  const deduped = deduplicateResults(runs);
  const elapsed = Date.now() - overallStart;

  logger.info({
    msg: "Daily screeners finished",
    totalUnique: deduped.length,
    withMultipleScreeners: deduped.filter((r) => r.screenerCount > 1).length,
    elapsed,
  });

  // Cache the results
  staticCache.set(CACHE_KEY, deduped, CACHE_TTL);

  return deduped;
}

/**
 * Return the list of screener definitions.  Useful for admin dashboards or
 * debugging to see what screeners are configured.
 */
export function getScreeners(): ReadonlyArray<ScreenerDef> {
  return DAILY_SCREENERS;
}

/**
 * Run a single screener by its ID.  Useful for manual testing or admin
 * "run now" buttons.
 *
 * @param screenerId  One of the defined screener IDs.
 * @throws If the screener ID is not found.
 */
export async function runSingleScreener(
  screenerId: string,
): Promise<ScreenerResult[]> {
  const screener = DAILY_SCREENERS.find((s) => s.id === screenerId);
  if (!screener) {
    throw new Error(`Unknown screener: ${screenerId}`);
  }

  const start = Date.now();
  const stocks = await runScreenerWithFallback(screener);
  const elapsed = Date.now() - start;

  logger.info({
    msg: "Single screener run",
    screener: screener.name,
    stocks: stocks.length,
    elapsed,
  });

  return deduplicateResults([
    { stocks, screenerName: screener.name },
  ]);
}
