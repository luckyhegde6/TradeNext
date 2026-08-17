// lib/services/chartinkUnifiedScreenerService.ts
// Unified daily-screener runner — Chartink 117-template registry as the
// PRIMARY source, TradingView (98 FilterGroup templates) as FALLBACK.
//
// Per-template source chain (first hit wins):
//   1. chartink_db    — fresh captured rows from the DB (72h TTL) — zero network
//   2. chartink_live  — template has a scanClause → POST /screener/process
//   3. tradingview    — no clause or both above failed → resolve a TV
//                       FilterGroup template (by curated id, name match, or
//                       category default) and filter ONE shared universe scan
//
// Output is signature-compatible with chartinkService.runDailyScreeners
// (ScreenerResult[]) so the daily-rec engine can switch with a one-line import
// change, while each result also carries `source` + originating `templateIds`.

import logger from "@/lib/logger";
import { staticCache } from "@/lib/cache";
import {
  getChartinkTemplates,
  getChartinkTemplate,
  type ChartinkTemplate,
} from "@/lib/services/chartinkTemplates";
import { fetchChartinkScan } from "@/lib/services/chartinkScanService";
import {
  getChartinkScreeners,
  getChartinkScreenerResults,
  type ChartinkScreenerOverview,
} from "@/lib/services/chartinkScreenerService";
import { advancedScan } from "@/lib/services/tradingview-service";
import {
  SCREENER_TEMPLATES,
  type ScreenerTemplate,
} from "@/lib/screener/screener-templates";
import { getRequiredColumns } from "@/lib/screener/condition-tree";
import { applyFilterGroup } from "@/lib/screener/filter-engine";
import {
  deduplicateResults,
  type ScreenerResult,
  type ChartinkStock,
} from "@/lib/services/chartinkService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Which producer supplied a result's data. */
export type ScreenerSource = "chartink_db" | "chartink_live" | "tradingview";

/** ScreenerResult extended with source attribution. */
export interface UnifiedScreenerResult extends ScreenerResult {
  source: ScreenerSource;
  /** Chartink template ids that flagged this stock (registry ids). */
  templateIds: string[];
}

/** Options for the unified run. */
export interface UnifiedScreenerOptions {
  forceRefresh?: boolean;
  /** Restrict the run to these template ids (default: all). */
  templateIds?: string[];
  /** Restrict by category id (default: all). */
  categoryId?: string;
  /** Exclude whole categories (e.g. the swing tab's scans from the daily run). */
  excludeCategoryIds?: string[];
  /** Max rows per tradingview fallback template (default 100). */
  tvFallbackLimit?: number;
}

/** Per-template outcome used internally. */
interface TemplateRun {
  template: ChartinkTemplate;
  stocks: ChartinkStock[];
  source: ScreenerSource;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_TTL = 300;

/**
 * Options-aware cache key. The runner is invoked with different scopes
 * (full daily run, category runs, per-template-id runs like the Swing tab),
 * and all of them used to share ONE fixed key — a swing run could read the
 * whole daily list (or overwrite it with swing-only rows). The key encodes
 * the template-id/category/exclusion scope so each scope has its own cache.
 */
function unifiedCacheKey(options: UnifiedScreenerOptions): string {
  const { templateIds, categoryId, excludeCategoryIds = [] } = options;
  let scope = "all";
  if (templateIds && templateIds.length > 0) scope = `t:${templateIds.join(",")}`;
  else if (categoryId) scope = `c:${categoryId}`;
  const excl = excludeCategoryIds.length > 0 ? `-x${excludeCategoryIds.join(",")}` : "";
  return `chartink-unified:${scope}${excl}`;
}

/** TV universe range — full NSE universe in one scan (matches advanced route). */
const TV_UNIVERSE: { from: number; to: number } = { from: 0, to: 2000 };

/**
 * Curated exact-match overrides (chartink template id → TV template NAME).
 * Name-based matching + category defaults cover the rest; this map pins the
 * high-value top-loved screeners to their v3.5.2-validated TV proxies.
 */
const CURATED_TV_FALLBACK: Record<string, string> = {
  "top-loved.short-term-breakouts": "Short Term Breakouts",
  "top-loved.potential-breakouts": "Potential Breakouts",
  "top-loved.boss-scanner-for-btst": "BOSS Scanner BTST",
  "top-loved.nks-best-buy-stocks-intraday": "NKS Best Buy Stocks Intraday",
  "top-loved.moving-average-bullish-strong-buy": "FNO Stocks Bullish Trend (ADX+MACD)",
  "top-loved.strong-stocks": "Bullish Momentum Stocks",
  "top-loved.perfect-sell-short": "Perfect Sell (Short)",
};

/** Chartink category id → TV template category id. */
const CATEGORY_TV_MAP: Record<string, string> = {
  fundamental: "fundamental",
  "top-loved": "range_breakout",
  candlestick: "candlestick",
  "range-breakouts": "range_breakout",
  "intraday-bullish": "intraday_bullish",
  crossover: "crossover",
  bullish: "bullish",
  bearish: "bearish",
  "intraday-bearish": "intraday_bearish",
  swing: "range_breakout",
};

// ---------------------------------------------------------------------------
// TV fallback resolver
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "and", "the", "for", "with", "from", "that", "top", "scan", "scanner",
  "stocks", "stock", "based", "copy", "best", "buy", "sell", "day", "his",
]);

/** Lower-case, non-alphanumerics → space, drop stopwords + short tokens. */
function tokenizeName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Fraction of chartink tokens present in the TV template name. */
function nameMatchScore(chartinkName: string, tvName: string): number {
  const a = tokenizeName(chartinkName);
  const b = new Set(tokenizeName(tvName));
  if (a.length === 0) return 0;
  const hit = a.filter((w) => b.has(w)).length;
  return hit / a.length;
}

/** Pick the most popular TV template in a category (deterministic tie-break). */
function categoryDefault(tvCategory: string): ScreenerTemplate | null {
  const members = SCREENER_TEMPLATES.filter((t) => t.category === tvCategory);
  if (members.length === 0) return null;
  return [...members].sort(
    (a, b) =>
      (b.popularity ?? 0) - (a.popularity ?? 0) ||
      a.name.localeCompare(b.name),
  )[0];
}

/**
 * Resolve a Chartink template to its TradingView fallback equivalent.
 * Order: curated exact map → token-match ≥ 0.6 → category default.
 * Returns null when no sensible TV equivalent exists.
 */
export function resolveTvFallback(
  template: ChartinkTemplate,
): ScreenerTemplate | null {
  // 1. Curated exact match by chartink id
  const curatedName = CURATED_TV_FALLBACK[template.id];
  if (curatedName) {
    const tv = SCREENER_TEMPLATES.find(
      (t) => t.name.toLowerCase() === curatedName.toLowerCase(),
    );
    if (tv) return tv;
  }

  // 2. Best token-name match above threshold
  let best: ScreenerTemplate | null = null;
  let bestScore = 0.6; // threshold
  for (const tv of SCREENER_TEMPLATES) {
    const score = nameMatchScore(template.name, tv.name);
    if (score > bestScore) {
      bestScore = score;
      best = tv;
    }
  }
  if (best) return best;

  // 3. Category default
  const tvCategory = CATEGORY_TV_MAP[template.categoryId];
  return tvCategory ? categoryDefault(tvCategory) : null;
}

// ---------------------------------------------------------------------------
// Source-chain stage 2/3 helpers
// ---------------------------------------------------------------------------

/** Normalise TV scanned rows into ChartinkStock shape. */
function tvRowToChartinkStock(row: Record<string, unknown>): ChartinkStock {
  const symbol = String(row.symbol ?? "").toUpperCase();
  const nseCode = symbol.includes(":NSE") || symbol.includes("NSE:")
    ? symbol.split(":")[1] ?? symbol
    : symbol.replace("NSE:", "");
  return {
    nse_script_code: nseCode,
    name: String(row.name ?? row.description ?? nseCode),
    close: Number(row.close ?? 0),
    change: Number(row.change ?? 0),
    pChange: Number(row.change ?? 0), // TV `change` IS % on NSE (v3.5.2)
    volume: Number(row.volume ?? 0),
    market_cap_basic: Number(row.market_cap_basic ?? 0) || undefined,
    _tvRow: row,
  } as ChartinkStock;
}

/** Normalise DB/captured or live scan rows (ChartinkScanStock) into ChartinkStock. */
function scanStockToChartinkStock(stock: {
  symbol: string;
  close: number;
  changePercent: number;
  volume: number;
  name?: string;
}): ChartinkStock {
  return {
    nse_script_code: stock.symbol.toUpperCase(),
    name: stock.name ?? stock.symbol.toUpperCase(),
    close: stock.close,
    change: stock.changePercent,
    pChange: stock.changePercent,
    volume: stock.volume,
  } as ChartinkStock;
}

// ---------------------------------------------------------------------------
// Core runner
// ---------------------------------------------------------------------------

/**
 * Run the Chartink-primary screener pipeline.
 *
 * For each registry template:
 *  - Fresh captured DB rows (72h TTL) are used when present → `chartink_db`.
 *  - Otherwise a live `fetchChartinkScan` runs when the template has a
 *    scanClause → `chartink_live`.
 *  - Otherwise (catalog-only or both failed) the TV resolver supplies a
 *    FilterGroup template and the result comes from ONE shared universe scan.
 *
 * TV fallback templates share a single `advancedScan` of the full NSE
 * universe (union of required columns) so N catalog-only templates cost
 * 1 TV call, not N.
 *
 * Results are de-duplicated into {@link ScreenerResult} (engine-compatible)
 * with `source` + `templateIds` attribution. Cached 5 min unless forceRefresh.
 */
export async function runChartinkUnifiedScreeners(
  options: UnifiedScreenerOptions = {},
): Promise<UnifiedScreenerResult[]> {
  const {
    forceRefresh = false,
    templateIds,
    categoryId,
    excludeCategoryIds = [],
    tvFallbackLimit = 100,
  } = options;

  if (!forceRefresh) {
    const cached = staticCache.get(unifiedCacheKey(options));
    if (cached) return cached as UnifiedScreenerResult[];
  }

  const templates = getChartinkTemplates(categoryId).filter(
    (t) =>
      !excludeCategoryIds.includes(t.categoryId) &&
      (!templateIds || templateIds.includes(t.id)),
  );
  if (templates.length === 0) return [];

  logger.info({ msg: "Chartink unified screeners run", templates: templates.length });

  // ── Stage 1: fresh captured DB rows (primary, zero network) ─────────────
  const overview = await getChartinkScreeners({ categoryId });
  const overviewById = new Map(overview.map((o) => [o.id, o]));
  const freshIds = new Set(
    overview
      .filter((o) => o.resultCount > 0 && !o.stale)
      .map((o) => o.id),
  );

  const runs: TemplateRun[] = [];
  const tvCandidates: ChartinkTemplate[] = [];

  for (const template of templates) {
    if (freshIds.has(template.id)) {
      try {
        const rows = await getChartinkScreenerResults(template.id);
        if (rows.length > 0) {
          runs.push({
            template,
            source: "chartink_db",
            stocks: rows.map(scanStockToChartinkStock),
          });
          continue;
        }
      } catch (e: unknown) {
        logger.warn({
          msg: "DB captured rows failed, continuing chain",
          templateId: template.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    tvCandidates.push(template);
  }

  // ── Stage 2: live Chartink fetch for clause-ready templates ────────────
  const clauseTemplates = tvCandidates.filter((t) => !!t.scanClause);
  // Catalog-only templates (no scanClause) go straight to the TV fallback
  // stage; clause templates join them only if live fetch produced 0 rows.
  const stillTv: ChartinkTemplate[] = [...tvCandidates.filter((t) => !t.scanClause)];

  await Promise.all(
    clauseTemplates.map(async (template) => {
      try {
        const result = await fetchChartinkScan(template, { forceRefresh });
        if (result.stocks.length > 0) {
          runs.push({
            template,
            source: "chartink_live",
            stocks: result.stocks.map(scanStockToChartinkStock),
          });
          return;
        }
      } catch (e: unknown) {
        logger.warn({
          msg: "Live Chartink fetch failed, TV fallback",
          templateId: template.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      stillTv.push(template);
    }),
  );

  // ── Stage 3: TradingView fallback via ONE shared universe scan ─────────
  const tvResolved = stillTv
    .map((template) => ({ template, tv: resolveTvFallback(template) }))
    .filter((x): x is { template: ChartinkTemplate; tv: ScreenerTemplate } => !!x.tv);

  if (tvResolved.length > 0) {
    const unionColumns = Array.from(
      new Set(tvResolved.flatMap((x) => getRequiredColumns(x.tv.filterGroup))),
    );
    unionColumns.push("name", "close", "volume", "market_cap_basic");

    const universe = await advancedScan([], unionColumns, TV_UNIVERSE);

    for (const { template, tv } of tvResolved) {
      try {
        const { stocks } = applyFilterGroup(tv.filterGroup, universe, {
          limit: tvFallbackLimit,
        });
        if (stocks.length > 0) {
          runs.push({
            template,
            source: "tradingview",
            stocks: stocks.map(tvRowToChartinkStock),
          });
        } else {
          logger.debug({ msg: "TV fallback returned 0 stocks", templateId: template.id });
        }
      } catch (e: unknown) {
        logger.warn({
          msg: "TV fallback filter failed",
          templateId: template.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  // ── Merge + attribute ──────────────────────────────────────────────────
  const deduped = deduplicateResults(
    runs.map((r) => ({ stocks: r.stocks, screenerName: r.template.name })),
  );

  // Attach source/templateIds per result: a stock keeps the source of the
  // first (highest priority) template that flagged it.
  const sourceMap = new Map<string, { source: ScreenerSource; templateIds: string[] }>();
  for (const run of runs) {
    for (const stock of run.stocks) {
      const symbol = String(stock.nse_script_code ?? "").toUpperCase();
      if (!symbol) continue;
      const existing = sourceMap.get(symbol);
      if (existing) {
        if (!existing.templateIds.includes(run.template.id)) {
          existing.templateIds.push(run.template.id);
        }
      } else {
        sourceMap.set(symbol, { source: run.source, templateIds: [run.template.id] });
      }
    }
  }

  const results: UnifiedScreenerResult[] = deduped.map((r) => {
    const attribution = sourceMap.get(r.symbol) ?? {
      source: "tradingview" as ScreenerSource,
      templateIds: r.screenerNames,
    };
    return { ...r, source: attribution.source, templateIds: attribution.templateIds };
  });

  staticCache.set(unifiedCacheKey(options), results, CACHE_TTL);

  logger.info({
    msg: "Chartink unified screeners finished",
    totalUnique: results.length,
    chartinkDb: results.filter((r) => r.source === "chartink_db").length,
    chartinkLive: results.filter((r) => r.source === "chartink_live").length,
    tradingview: results.filter((r) => r.source === "tradingview").length,
  });

  return results;
}

/**
 * Run a SINGLE chartink template through the same source chain.
 * Used by the `/api/screener/chartink` route + UI template runs.
 *
 * @returns stocks + source for that one template (no cross-template dedup).
 */
export async function runChartinkScreenerById(
  templateId: string,
  options: { forceRefresh?: boolean; tvFallbackLimit?: number } = {},
): Promise<{ template: ChartinkTemplate; stocks: ChartinkStock[]; source: ScreenerSource; warning?: string }> {
  const template = getChartinkTemplate(templateId);
  if (!template) throw new Error(`Unknown Chartink template: ${templateId}`);

  const { forceRefresh = false, tvFallbackLimit = 100 } = options;

  // 1. Fresh DB rows
  try {
    const overviews = await getChartinkScreeners();
    const ov = overviews.find((o: ChartinkScreenerOverview) => o.id === templateId);
    if (ov && ov.resultCount > 0 && !ov.stale) {
      const rows = await getChartinkScreenerResults(templateId);
      if (rows.length > 0) {
        return {
          template,
          source: "chartink_db",
          stocks: rows.map(scanStockToChartinkStock),
        };
      }
    }
  } catch (e: unknown) {
    logger.warn({
      msg: "DB rows failed for single run",
      templateId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // 2. Live chartink
  if (template.scanClause) {
    try {
      const result = await fetchChartinkScan(template, { forceRefresh });
      if (result.stocks.length > 0) {
        return {
          template,
          source: "chartink_live",
          stocks: result.stocks.map(scanStockToChartinkStock),
        };
      }
    } catch (e: unknown) {
      logger.warn({
        msg: "Live Chartink failed for single run",
        templateId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 3. TV fallback
  const tv = resolveTvFallback(template);
  if (!tv) {
    return {
      template,
      stocks: [],
      source: "tradingview",
      warning: !template.scanClause
        ? `No scan clause available and no TV fallback found for this template.`
        : `All data sources failed for this template.`,
    };
  }

  try {
    const columns = Array.from(new Set(getRequiredColumns(tv.filterGroup)));
    columns.push("name", "close", "volume", "market_cap_basic");
    const universe = await advancedScan([], columns, TV_UNIVERSE);
    const { stocks } = applyFilterGroup(tv.filterGroup, universe, {
      limit: tvFallbackLimit,
    });

    if (stocks.length === 0) {
      return {
        template,
        stocks: [],
        source: "tradingview",
        warning: `TV fallback "${tv.name}" returned 0 results — may be rate-limited or filter mismatch.`,
      };
    }

    return {
      template,
      source: "tradingview",
      stocks: stocks.map(tvRowToChartinkStock),
    };
  } catch (e: unknown) {
    logger.warn({
      msg: "TV fallback failed for single run",
      templateId,
      tvTemplate: tv.name,
      error: e instanceof Error ? e.message : String(e),
    });
    return {
      template,
      stocks: [],
      source: "tradingview",
      warning: `TV fallback failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}