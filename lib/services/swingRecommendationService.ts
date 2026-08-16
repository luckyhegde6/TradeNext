// lib/services/swingRecommendationService.ts
// Swing-tab pipeline on /recommendations:
//   1. Run the swing-trading Chartink screeners (33-template registry) through
//      the unified runner (chartink_db → chartink_live → tradingview fallback).
//   2. Segregate each stock by signal family (trend/breakout/reversal/momentum/
//      volume/range) derived from the flagging screeners' names.
//   3. Dedupe by symbol (union families + screener tags).
//   4. Rank and cap at SWING_TOP_N (market cap + screener agreement + momentum).
//   5. Enrich with momentum indicators from daily_prices (~20 sessions).
//   6. Optional AI target analysis (lib/services/ai/swing-agent.ts).
//
// REQUEST-TIME SPLIT (prod fix): the AI analysis takes minutes (4 batches × 5
// stocks, bounded concurrency, model retry/fallback) — far beyond Netlify's
// 30s request wall, which killed the synchronous pipeline mid-batch. The HTTP
// request now returns the FAST screener feed immediately with
// analysisStatus "pending" and kicks the AI analysis into a fire-and-forget
// background task (guarded so concurrent requests never double-run). When the
// analysis settles it re-sets the cache key with the final payload
// (done/failed), and the tab's polling picks it up. This relies on Netlify
// running as a persistent server (v3.11.x in-process daemon model) — the
// detached promise survives the request.
//
// The whole result is cached 30 min; forceRefresh bypasses the cache and
// re-scans/re-analyzes.

import logger from "@/lib/logger";
import { staticCache } from "@/lib/cache";
import { createAuditLog } from "@/lib/audit";
import {
  getChartinkTemplates,
  getChartinkTemplate,
} from "@/lib/services/chartinkTemplates";
import {
  runChartinkUnifiedScreeners,
  type UnifiedScreenerResult,
} from "@/lib/services/chartinkUnifiedScreenerService";
import type { ScreenerResult } from "@/lib/services/chartinkService";
import { analyzeSwingStocks, type SwingAnalysisInput } from "@/lib/services/ai/swing-agent";
import { loadConfig } from "@/lib/services/ai/config";
import type {
  SignalFamily,
  SwingIndicators,
  SwingResponse,
  SwingStock,
} from "@/lib/services/swing-types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SWING_TOP_N = 20;
const SWING_CACHE_KEY = "swing:recommendations";
const SWING_CACHE_TTL = 30 * 60; // 30 min — AI analysis is expensive
const SWING_PENDING_TTL = 10 * 60; // pending feed self-expires if the background dies

/**
 * Extra (non-swing-category) templates that belong in the swing feed — e.g. the
 * "Stocks closing below the supertrend line" crossover scan from the user's list.
 */
const SWING_EXTRA_TEMPLATE_IDS = [
  "crossover.stocks-closing-below-the-supertrend-line-4",
];

/** Names/pattern → signal family segregation (matched on template NAME). */
const FAMILY_RULES: Array<{ family: SignalFamily; pattern: RegExp }> = [
  { family: "trend", pattern: /supertrend|sma|ema|moving average|trend|renko|200 day|100\/200|100-200/i },
  { family: "breakout", pattern: /breakout|line break|swing high|200 day high|potential/i },
  { family: "reversal", pattern: /reversal|rsi|dip|buy on dip|star|higher low|swing low|morning/i },
  { family: "momentum", pattern: /cci|momentum|compounder|wealth|gaint/i },
  { family: "volume", pattern: /volume|vol >|5lac/i },
  { family: "range", pattern: /range|consolidat|btwn ema|between ema/i },
];

const EMPTY_INDICATORS: SwingIndicators = {
  momentum10: null,
  momentum20: null,
  volatility20: null,
  distanceFrom20dHigh: null,
};

// ---------------------------------------------------------------------------
// Template / family resolution (pure, exported for tests)
// ---------------------------------------------------------------------------

/** All swing template ids: swing category + extra crossover scans. */
export function getSwingTemplateIds(): string[] {
  const swing = getChartinkTemplates("swing").map((t) => t.id);
  const extra = SWING_EXTRA_TEMPLATE_IDS.filter((id) => !!getChartinkTemplate(id));
  return [...swing, ...extra];
}

/** Signal families for ONE template (by its registry name). */
export function templateFamilies(id: string, name: string): SignalFamily[] {
  const matched = new Set<SignalFamily>();
  for (const rule of FAMILY_RULES) {
    if (rule.pattern.test(name)) matched.add(rule.family);
  }
  if (matched.size === 0) {
    // Swing scans are inherently trend-oriented — default to trend.
    matched.add("trend");
  }
  return [...matched];
}

/** Union of families across the templates that flagged a stock. */
export function swingFamiliesForTemplates(
  templateIds: string[],
  nameById: Map<string, string>,
): SignalFamily[] {
  const families = new Set<SignalFamily>();
  for (const id of templateIds) {
    const name = nameById.get(id) ?? id;
    for (const f of templateFamilies(id, name)) families.add(f);
  }
  return [...families];
}

/** Merge raw results → symbol-unique SwingStocks with families + screener tags. */
export function segregateAndDedupe(
  results: UnifiedScreenerResult[],
  nameById: Map<string, string>,
): SwingStock[] {
  const map = new Map<string, SwingStock>();
  for (const r of results) {
    const symbol = r.symbol.toUpperCase();
    const families = swingFamiliesForTemplates(r.templateIds, nameById);
    const existing = map.get(symbol);
    if (existing) {
      existing.families = Array.from(new Set([...existing.families, ...families]));
      existing.screenerNames = Array.from(new Set([...existing.screenerNames, ...r.screenerNames]));
      existing.screenerCount = existing.screenerNames.length;
      if (r.price > 0) existing.price = r.price;
      if (r.changePercent !== 0) existing.changePercent = r.changePercent;
      if (r.volume > 0) existing.volume = r.volume;
    } else {
      map.set(symbol, {
        ...r,
        symbol,
        families,
        momentumScore: 0,
        indicators: EMPTY_INDICATORS,
        analysis: null,
        analysisError: null,
      });
    }
  }
  return [...map.values()];
}

// ---------------------------------------------------------------------------
// Ranking (pure, exported for tests)
// ---------------------------------------------------------------------------

/** Market-cap band score: ₹10,000Cr+ → 3, ₹1,000Cr+ → 2, ₹100Cr+ → 1. */
export function marketCapScoreOf(marketCap?: number): number {
  if (!marketCap || marketCap <= 0) return 0;
  if (marketCap >= 1e11) return 3;
  if (marketCap >= 1e10) return 2;
  if (marketCap >= 1e9) return 1;
  return 0;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Composite rank score: screener agreement dominates, then market cap, then momentum. */
export function swingCompositeScore(
  r: Pick<ScreenerResult, "screenerCount" | "changePercent" | "marketCap">,
): number {
  const marketCapScore = marketCapScoreOf(r.marketCap);
  const momentum = clamp01((r.changePercent + 5) / 10);
  return r.screenerCount * 10 + marketCapScore * 2 + momentum;
}

/** Display momentum score 0–100 derived from today's change (pre-AI). */
export function momentumScoreOf(r: Pick<ScreenerResult, "changePercent">): number {
  return Math.round(clamp01((r.changePercent + 5) / 10) * 100);
}

/** Sort by composite score (tie-break: screener agreement) and cap at topN. */
export function rankSwingStocks(stocks: SwingStock[], topN = SWING_TOP_N): SwingStock[] {
  return [...stocks]
    .sort((a, b) => {
      const scoreDiff = swingCompositeScore(b) - swingCompositeScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return b.screenerCount - a.screenerCount;
    })
    .slice(0, topN)
    .map((s) => ({ ...s, momentumScore: momentumScoreOf(s) }));
}

/** Family → count across a stock list (the "segregation" breakdown). */
export function countSegregation(stocks: SwingStock[]): Record<SignalFamily, number> {
  const counts: Record<SignalFamily, number> = {
    trend: 0,
    breakout: 0,
    reversal: 0,
    momentum: 0,
    volume: 0,
    range: 0,
  };
  for (const s of stocks) {
    for (const f of s.families) counts[f] = (counts[f] ?? 0) + 1;
  }
  return counts;
}

/**
 * Honest analysis status after a batch: "done" only when at least ONE stock
 * carries AI targets. A batch that failed for every stock (per-stock
 * analysisError, no throw) must report "failed" — the tab header renders
 * "AI targets ready" from "done", which would be a lie over an all-failed run.
 */
export function analysisStatusAfterBatch(stocks: SwingStock[]): SwingResponse["analysisStatus"] {
  return stocks.some((s) => s.analysis) ? "done" : "failed";
}

// ---------------------------------------------------------------------------
// Performance-tab persistence (v3.10.1)
// ---------------------------------------------------------------------------

/**
 * Swing trackers live in RecommendationTracker with timeHorizon "swing" — the
 * Performance tab's Swing filter maps `category="swing"` to `timeHorizon`, and
 * the daily perf-check cron iterates active trackers automatically.
 */
const SWING_TIME_HORIZON = "swing" as const;

/** RecommendationTracker-shaped draft for one AI-analyzed swing pick. PURE. */
export interface SwingTrackerDraft {
  symbol: string;
  status: "active";
  entryPrice: number;
  currentPrice: number;
  targetPrice: number;
  stopLoss: number;
  timeHorizon: typeof SWING_TIME_HORIZON;
  confidence: number;
  aiRecommendation: "BUY" | "SELL" | "HOLD";
  reasoning: string | null;
  riskFactors: string[] | null;
  screenerAttribution: {
    screenerNames: string[];
    families: SignalFamily[];
    source: string;
  } | null;
}

/** Map a swing action to the tracker recommendation vocabulary. */
export function swingActionToRecommendation(
  action: SwingStock["analysis"] extends infer _A ? "LONG" | "SHORT" | "OBSERVE" : never,
): "BUY" | "SELL" | "HOLD" {
  if (action === "LONG") return "BUY";
  if (action === "SHORT") return "SELL";
  return "HOLD";
}

/** Build a tracker draft from an analyzed swing stock (null when no analysis). */
export function swingTrackerDraft(stock: SwingStock): SwingTrackerDraft | null {
  const a = stock.analysis;
  if (!a) return null;
  return {
    symbol: stock.symbol,
    status: "active",
    entryPrice: stock.price,
    currentPrice: stock.price,
    targetPrice: a.targetPrice,
    stopLoss: a.stopLoss,
    timeHorizon: SWING_TIME_HORIZON,
    confidence: a.confidence,
    aiRecommendation: swingActionToRecommendation(a.action),
    reasoning: a.logic || null,
    riskFactors: a.riskFactors?.length ? a.riskFactors : null,
    screenerAttribution: {
      screenerNames: stock.screenerNames,
      families: stock.families,
      source: stock.source,
    },
  };
}

/** Minimal DB surface persistSwingTrackers needs (override for tests). */
export interface SwingTrackerDb {
  recommendationTracker: {
    findMany: (args: {
      where: { symbol: { in: string[] }; timeHorizon: string; status: string };
      select?: { symbol?: boolean };
    }) => Promise<Array<{ symbol: string }>>;
    createMany: (args: { data: SwingTrackerDraft[]; skipDuplicates?: boolean }) => Promise<{ count: number }>;
    updateMany: (args: {
      where: { symbol: string; timeHorizon: string; status: string };
      data: { currentPrice: number; lastCheckedAt: Date };
    }) => Promise<{ count: number }>;
  };
}

/**
 * Persist AI-analyzed swing picks as active RecommendationTracker rows
 * (timeHorizon "swing"). New symbols are created; existing active swing
 * trackers get currentPrice/lastCheckedAt refreshed (targets stay as-of
 * creation — matching the daily pipeline's tracker convention). Non-fatal —
 * callers must catch. `db` override keeps this unit-testable.
 */
export async function persistSwingTrackers(
  stocks: SwingStock[],
  db?: SwingTrackerDb,
): Promise<{ created: number; updated: number }> {
  const analyzed = stocks.filter((s) => s.analysis);
  if (analyzed.length === 0) return { created: 0, updated: 0 };

  const prisma = db ?? ((await import("@/lib/prisma")).default as unknown as SwingTrackerDb);
  const symbols = analyzed.map((s) => s.symbol);

  const existing = await prisma.recommendationTracker.findMany({
    where: { symbol: { in: symbols }, timeHorizon: SWING_TIME_HORIZON, status: "active" },
    select: { symbol: true },
  });
  const existingSymbols = new Set(existing.map((r) => r.symbol));

  let created = 0;
  const toCreate = analyzed
    .filter((s) => !existingSymbols.has(s.symbol))
    .map((s) => swingTrackerDraft(s))
    .filter((d): d is SwingTrackerDraft => d !== null);
  if (toCreate.length > 0) {
    const res = await prisma.recommendationTracker.createMany({
      data: toCreate,
      skipDuplicates: true,
    });
    created = res.count;
  }

  const priceBySymbol = new Map(analyzed.map((s) => [s.symbol, s.price]));
  const refreshSymbols = symbols.filter((sym) => existingSymbols.has(sym));
  const updated = (
    await Promise.all(
      refreshSymbols.map((sym) =>
        prisma.recommendationTracker.updateMany({
          where: { symbol: sym, timeHorizon: SWING_TIME_HORIZON, status: "active" },
          data: { currentPrice: priceBySymbol.get(sym) ?? 0, lastCheckedAt: new Date() },
        }),
      ),
    )
  ).reduce((sum, r) => sum + r.count, 0);

  return { created, updated };
}

// ---------------------------------------------------------------------------
// Indicators (pure + DB fetch)
// ---------------------------------------------------------------------------

/**
 * Momentum/indicator context from a chronologically-ordered close series.
 * PURE — unit-testable without a database.
 */
export function computeIndicatorsFromSeries(closes: number[]): SwingIndicators {
  if (closes.length < 2) return { ...EMPTY_INDICATORS };

  const last = closes[closes.length - 1];
  const pct = (prev: number | undefined): number | null =>
    prev && prev > 0 ? ((last - prev) / prev) * 100 : null;

  const momentum10 = closes.length >= 10 ? pct(closes[closes.length - 10]) : null;
  const momentum20 = closes.length >= 20 ? pct(closes[closes.length - 20]) : null;

  const high20 = Math.max(...closes.slice(-20));
  const distanceFrom20dHigh = high20 > 0 ? ((high20 - last) / high20) * 100 : null;

  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (prev > 0) returns.push((closes[i] - prev) / prev);
  }
  let volatility20: number | null = null;
  if (returns.length > 0) {
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    const vol = Math.sqrt(variance) * 100;
    if (Number.isFinite(vol)) volatility20 = vol;
  }

  return { momentum10, momentum20, volatility20, distanceFrom20dHigh };
}

/** Batch-fetch up to 25 latest daily closes per symbol → computed indicators. */
async function fetchRecentCloses(
  symbols: string[],
): Promise<Map<string, SwingIndicators>> {
  if (symbols.length === 0) return new Map();
  const prisma = (await import("@/lib/prisma")).default;
  const rows = await prisma.$queryRaw<{ ticker: string; close: number }[]>`
    SELECT ticker, close::float8 AS close
    FROM (
      SELECT ticker, close, "tradeDate",
             ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY "tradeDate" DESC) AS rn
      FROM daily_prices
      WHERE ticker = ANY(${symbols.map((s) => s.toUpperCase())}::text[])
    ) t
    WHERE t.rn <= 25
    ORDER BY t.ticker, t."tradeDate" ASC
  `;

  const bySymbol = new Map<string, number[]>();
  for (const row of rows) {
    const list = bySymbol.get(row.ticker) ?? [];
    list.push(Number(row.close));
    bySymbol.set(row.ticker, list);
  }

  const out = new Map<string, SwingIndicators>();
  for (const [symbol, closes] of bySymbol) {
    out.set(symbol, computeIndicatorsFromSeries(closes));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** Convert a ranked SwingStock into the agent's input shape. */
function toAnalysisInput(stock: SwingStock): SwingAnalysisInput {
  return {
    symbol: stock.symbol,
    price: stock.price,
    changePercent: stock.changePercent,
    volume: stock.volume,
    screenerNames: stock.screenerNames,
    families: stock.families,
    marketCap: stock.marketCap,
    momentum10: stock.indicators.momentum10,
    momentum20: stock.indicators.momentum20,
    volatility20: stock.indicators.volatility20,
    distanceFrom20dHigh: stock.indicators.distanceFrom20dHigh,
  };
}

/**
 * In-flight background analysis guard. The AI analysis (4 batches × 5 stocks,
 * bounded concurrency, model retry/fallback) takes minutes — Netlify's 30s
 * request wall killed the old synchronous pipeline mid-batch. The HTTP request
 * now returns the fast screener feed ("pending") and this promise completes
 * the analysis, re-setting the cache with the final payload. Concurrent
 * requests (tab + refresh + force) must never start a second run.
 */
let swingAnalysisInFlight: Promise<void> | null = null;

/** Test hook — await the in-flight background analysis (no-op when idle). */
export function flushSwingAnalysis(): Promise<void> {
  return swingAnalysisInFlight ?? Promise.resolve();
}

/**
 * Background AI analysis for a pending swing feed. Never throws — every
 * failure path writes a "failed" response to the cache so the tab can render
 * the honest error instead of hanging on "pending" forever.
 */
async function runSwingAnalysisInBackground(
  enriched: SwingStock[],
  cacheKey: string,
  templateCount: number,
  totalRaw: number,
): Promise<void> {
  createAuditLog({
    action: "SWING_ANALYSIS_START",
    resource: "swing_analysis",
    path: "/api/recommendations/swing",
    metadata: { stocks: enriched.length },
  }).catch(() => undefined);

  let analysisStatus: SwingResponse["analysisStatus"] = "failed";
  let analysisError: string | null | undefined;

  try {
    const config = await loadConfig();
    const analyzed = await analyzeSwingStocks(enriched.map(toAnalysisInput), config);
    const bySymbol = new Map(analyzed.map((a) => [a.symbol.toUpperCase(), a]));
    for (const s of enriched) {
      const a = bySymbol.get(s.symbol);
      if (a && a.success && a.analysis) {
        s.analysis = a.analysis;
      } else {
        s.analysisError = a?.error ?? "Analysis failed";
      }
    }
    analysisStatus = analysisStatusAfterBatch(enriched);
    const succeeded = enriched.filter((s) => s.analysis).length;

    if (analysisStatus === "failed") {
      analysisError =
        enriched.find((s) => s.analysisError)?.analysisError ?? "AI analysis failed";
      createAuditLog({
        action: "SWING_ANALYSIS_FAILED",
        resource: "swing_analysis",
        path: "/api/recommendations/swing",
        errorMessage: analysisError,
        metadata: { stocks: enriched.length, succeeded, failed: enriched.length - succeeded },
      }).catch(() => undefined);
    } else {
      createAuditLog({
        action: "SWING_ANALYSIS_COMPLETE",
        resource: "swing_analysis",
        path: "/api/recommendations/swing",
        metadata: { stocks: enriched.length, succeeded },
      }).catch(() => undefined);
    }
  } catch (e) {
    analysisError = e instanceof Error ? e.message : String(e);
    logger.error({
      msg: "Swing AI analysis failed — falling back to screener-only feed",
      error: analysisError,
    });
    analysisStatus = "failed";
    createAuditLog({
      action: "SWING_ANALYSIS_FAILED",
      resource: "swing_analysis",
      path: "/api/recommendations/swing",
      errorMessage: analysisError,
      metadata: { stocks: enriched.length },
    }).catch(() => undefined);
  }

  // v3.10.1: persist AI-analyzed picks as RecommendationTracker rows
  // (timeHorizon "swing") so they surface in the Performance tab's Swing
  // filter and the daily perf-check cron tracks them. Non-fatal — the feed
  // must never fail because persistence hiccuped.
  if (analysisStatus === "done") {
    try {
      const { created, updated } = await persistSwingTrackers(enriched);
      logger.info({ msg: "Swing trackers persisted", created, updated, symbols: enriched.length });
    } catch (e) {
      logger.warn({
        msg: "Swing tracker persistence failed — feed continues",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const response: SwingResponse = {
    success: true,
    generatedAt: new Date().toISOString(),
    templateCount,
    totalRaw,
    topN: enriched.length,
    segregation: countSegregation(enriched),
    analysisStatus,
    analysisError,
    stocks: enriched,
  };

  createAuditLog({
    action: "SWING_RUN_COMPLETE",
    resource: "swing",
    path: "/api/recommendations/swing",
    metadata: {
      templates: templateCount,
      analyze: true,
      totalRaw,
      topN: enriched.length,
      analysisStatus,
      error: analysisError ?? undefined,
    },
  }).catch(() => undefined);

  staticCache.set(cacheKey, response, SWING_CACHE_TTL);
}

/**
 * Full swing pipeline (see file header). Cached 30 min; forceRefresh bypasses.
 * When `analyze=true` the request returns the FAST screener feed with
 * analysisStatus "pending" and the AI analysis runs in the background (it
 * takes minutes and would blow the 30s Netlify request wall). Never throws
 * for feed/indicator failures — the tab must degrade gracefully (empty feed /
 * no indicators), not 500.
 */
export async function getSwingRecommendations(
  options: { forceRefresh?: boolean; analyze?: boolean } = {},
): Promise<SwingResponse> {
  const { forceRefresh = false, analyze = true } = options;

  // The analyze flag changes the cached payload (AI-analyzed vs screener-only):
  // an `analyze=false` warm-up must never serve its no-AI result to the tab's
  // `analyze=true` request (and vice versa) — keep separate cache entries.
  const cacheKey = `${SWING_CACHE_KEY}:${analyze ? "ai" : "noai"}`;
  if (!forceRefresh) {
    const cached = staticCache.get<SwingResponse>(cacheKey);
    if (cached) return cached;
  }

  const templateIds = getSwingTemplateIds();
  logger.info({ msg: "Swing run starting", templates: templateIds.length, analyze });
  createAuditLog({
    action: "SWING_RUN_START",
    resource: "swing",
    resourceId: `${SWING_CACHE_KEY}:${analyze ? "ai" : "noai"}`,
    path: "/api/recommendations/swing",
    metadata: { templates: templateIds.length, analyze },
  }).catch(() => undefined);

  let unified: UnifiedScreenerResult[];
  try {
    unified = await runChartinkUnifiedScreeners({ templateIds, forceRefresh });
  } catch (e) {
    const runError = e instanceof Error ? e.message : String(e);
    logger.error({ msg: "Swing screener run failed", error: runError });
    createAuditLog({
      action: "SWING_RUN_FAILED",
      resource: "swing",
      path: "/api/recommendations/swing",
      errorMessage: runError,
      metadata: { templates: templateIds.length, analyze },
    }).catch(() => undefined);
    throw e;
  }
  const nameById = new Map(
    templateIds.map((id) => [id, getChartinkTemplate(id)?.name ?? id]),
  );

  const deduped = segregateAndDedupe(unified, nameById);
  const ranked = rankSwingStocks(deduped);

  // Momentum indicators from daily_prices — batch, never blocks the feed.
  let indicatorMap = new Map<string, SwingIndicators>();
  try {
    indicatorMap = await fetchRecentCloses(ranked.map((s) => s.symbol));
  } catch (e) {
    logger.warn({
      msg: "Swing indicators unavailable — continuing without them",
      error: e instanceof Error ? e.message : String(e),
    });
  }
  const enriched = ranked.map((s) => ({
    ...s,
    indicators: indicatorMap.get(s.symbol) ?? EMPTY_INDICATORS,
  }));

  // AI target analysis — background (see runSwingAnalysisInBackground). The
  // request returns the pending feed immediately; the tab polls and picks up
  // the final payload once the analysis settles.
  if (analyze && enriched.length > 0) {
    if (!swingAnalysisInFlight) {
      const run = runSwingAnalysisInBackground(enriched, cacheKey, templateIds.length, deduped.length);
      swingAnalysisInFlight = run
        .catch((e) => {
          logger.error({
            msg: "Swing background analysis crashed — pending feed stays cached",
            error: e instanceof Error ? e.message : String(e),
          });
        })
        .finally(() => {
          swingAnalysisInFlight = null;
        });
    }

    const pending: SwingResponse = {
      success: true,
      generatedAt: new Date().toISOString(),
      templateCount: templateIds.length,
      totalRaw: deduped.length,
      topN: enriched.length,
      segregation: countSegregation(enriched),
      analysisStatus: "pending",
      analysisError: null,
      stocks: enriched,
    };
    // Short TTL so a stale pending self-expires if the process dies mid-run;
    // the background overwrites with the 30-min final payload when done.
    staticCache.set(cacheKey, pending, SWING_PENDING_TTL);
    return pending;
  }

  // analyze=false (or empty feed) — synchronous screener-only feed.
  const response: SwingResponse = {
    success: true,
    generatedAt: new Date().toISOString(),
    templateCount: templateIds.length,
    totalRaw: deduped.length,
    topN: enriched.length,
    segregation: countSegregation(enriched),
    analysisStatus: "skipped",
    analysisError: null,
    stocks: enriched,
  };

  createAuditLog({
    action: "SWING_RUN_COMPLETE",
    resource: "swing",
    path: "/api/recommendations/swing",
    metadata: {
      templates: templateIds.length,
      analyze,
      totalRaw: deduped.length,
      topN: enriched.length,
      analysisStatus: "skipped",
      error: undefined,
    },
  }).catch(() => undefined);

  staticCache.set(cacheKey, response, SWING_CACHE_TTL);
  return response;
}
