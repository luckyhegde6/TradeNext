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
// REQUEST-TIME SPLIT + DB-BACKED JOB (prod fixes): the AI analysis takes
// minutes (4 batches × 5 stocks, bounded concurrency, model retry/fallback) —
// far beyond Netlify's 30s request wall, which killed the synchronous pipeline
// mid-batch. The HTTP request now returns the FAST screener feed immediately
// with analysisStatus "pending" and writes a SwingAnalysisJob row (durable —
// v3.13.0). The in-process daemon (v3.11.x) + the request path both kick
// maybeProcessSwingAnalysis(), which claims the oldest pending job, runs the
// AI batches, patches the payload, and flips it done/failed. The DB row is the
// source of truth: it survives the staticCache LRU eviction, instance
// recycling, and multi-instance routing that stranded the v3.12.0 detached
// cache write on prod (pending feed evicted mid-analysis → tab stuck on
// "generating" forever).
//
// The whole result is cached 30 min; forceRefresh bypasses the cache and
// re-scans/re-analyzes.

import { Prisma } from "@prisma/client";
import logger from "@/lib/logger";
import { staticCache } from "@/lib/cache";
import { createAuditLog } from "@/lib/audit";
import { isPlanLimitBreakerOpen } from "@/lib/db-utils";
import { recordRead } from "@/lib/services/readTier";
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
const SWING_FEED_CACHE_TTL = 30 * 60; // analyze=false screener-only feed — cheap to regenerate
// v3.14.0: completed (done/failed) AI payloads are cached 24h as a safety net
// beyond the durable DB row — targets stay visible until the next swing run
// replaces them. The cache is DELETED the moment a new run starts (force
// refresh supersede + job creation), so stale targets can never show while a
// newer feed is analyzing.
const SWING_DONE_CACHE_TTL = 24 * 60 * 60;

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
// Swing signal persistence (v3.14.0 — new SwingSignal table)
// ---------------------------------------------------------------------------

/** SwingSignal-shaped draft for one posted swing stock. PURE. */
export interface SwingSignalDraft {
  jobId: string;
  symbol: string;
  name: string | null;
  price: number;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  marketCap: number | null;
  screenerNames: string[];
  screenerCount: number;
  families: SignalFamily[];
  templateIds: string[];
  source: string;
  indicators: Prisma.InputJsonValue | null;
  momentumScore: number;
  analysis: Prisma.InputJsonValue | null;
  aiRecommendation: "BUY" | "SELL" | "HOLD" | null;
  confidence: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
}

/**
 * Build the DB row for one stock at JOB CREATION (= date of posting): the
 * screener snapshot + price baseline. AI levels are null here — they're
 * patched by patchSwingSignalAnalysis when the background analysis completes.
 * PURE.
 */
export function swingSignalDraft(stock: SwingStock, jobId: string): SwingSignalDraft {
  return {
    jobId,
    symbol: stock.symbol,
    name: stock.name ?? null,
    price: stock.price,
    change: stock.change ?? null,
    changePercent: stock.changePercent ?? null,
    volume: stock.volume ?? null,
    marketCap: stock.marketCap ?? null,
    screenerNames: stock.screenerNames ?? [],
    screenerCount: stock.screenerCount ?? 0,
    families: stock.families ?? [],
    templateIds: stock.templateIds ?? [],
    source: stock.source ?? "chartink",
    indicators: (stock.indicators ?? null) as unknown as Prisma.InputJsonValue | null,
    momentumScore: stock.momentumScore ?? 0,
    analysis: null,
    aiRecommendation: null,
    confidence: null,
    targetPrice: null,
    stopLoss: null,
  };
}

/** Analysis patch fields for one completed swing stock. */
export interface SwingSignalAnalysisPatch {
  analysis: Prisma.InputJsonValue;
  aiRecommendation: "BUY" | "SELL" | "HOLD";
  confidence: number;
  targetPrice: number;
  stopLoss: number;
}

/** Analysis patch for one stock (null when it carries no analysis). PURE. */
export function swingSignalAnalysisPatch(stock: SwingStock): SwingSignalAnalysisPatch | null {
  const a = stock.analysis;
  if (!a) return null;
  return {
    analysis: a as unknown as Prisma.InputJsonValue,
    aiRecommendation: swingActionToRecommendation(a.action),
    confidence: a.confidence,
    targetPrice: a.targetPrice,
    stopLoss: a.stopLoss,
  };
}

/** Minimal DB surface swing signal persistence needs (override for tests). */
export interface SwingSignalDb {
  swingSignal: {
    createMany: (args: {
      data: SwingSignalDraft[];
      skipDuplicates?: boolean;
    }) => Promise<{ count: number }>;
    updateMany: (args: {
      where: { jobId: string; symbol: string };
      data: Partial<SwingSignalAnalysisPatch> & { updatedAt?: Date };
    }) => Promise<{ count: number }>;
  };
}

/**
 * Persist the posted feed into SwingSignal at JOB CREATION — the durable
 * "date of posting" snapshot the swing performance check tracks. Idempotent
 * via the @@unique([jobId, symbol]) constraint + skipDuplicates. Non-fatal —
 * callers catch; the pipeline must never fail because persistence hiccuped.
 */
export async function persistSwingSignals(
  jobId: string,
  stocks: SwingStock[],
  db?: SwingSignalDb,
): Promise<{ created: number }> {
  if (stocks.length === 0) return { created: 0 };
  const prisma = db ?? ((await import("@/lib/prisma")).default as unknown as SwingSignalDb);
  const res = await prisma.swingSignal.createMany({
    data: stocks.map((s) => swingSignalDraft(s, jobId)),
    skipDuplicates: true,
  });
  return { created: res.count };
}

/**
 * Patch the AI levels into the posted signals when the job completes. Only
 * stocks that actually carried analysis are patched (analysisStatus "done");
 * the levels become the predictions the performance check evaluates. A signal
 * that never gets patched (job failed, partial batch) simply has no levels and
 * can only expire. Non-fatal — callers catch.
 */
export async function patchSwingSignalAnalysis(
  jobId: string,
  stocks: SwingStock[],
  db?: SwingSignalDb,
): Promise<{ patched: number }> {
  const prisma = db ?? ((await import("@/lib/prisma")).default as unknown as SwingSignalDb);
  let patched = 0;
  for (const stock of stocks) {
    const patch = swingSignalAnalysisPatch(stock);
    if (!patch) continue;
    const res = await prisma.swingSignal.updateMany({
      where: { jobId, symbol: stock.symbol },
      data: { ...patch, updatedAt: new Date() },
    });
    patched += res.count;
  }
  return { patched };
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
 * In-flight processor guard. The AI analysis (4 batches × 5 stocks, bounded
 * concurrency, model retry/fallback) takes minutes — the processor must never
 * run twice in one process (the atomic claim handles multi-instance). The
 * daemon tick and the request path both kick it; `flushSwingAnalysis` awaits.
 */
let swingProcessorInFlight: Promise<void> | null = null;

/** Test hook — await the in-flight background processor (no-op when idle). */
export function flushSwingAnalysis(): Promise<void> {
  return swingProcessorInFlight ?? Promise.resolve();
}

/**
 * A stale running job (instance died/recycled mid-batch) is retried up to
 * SWING_JOB_MAX_ATTEMPTS before being marked failed. Pending jobs survive
 * forever in the DB (they're claimed by the next tick), so the tab never hangs
 * on "generating" — unlike v3.12.0's cache-only pending payload.
 */
export const SWING_JOB_STALE_MS = 45 * 60 * 1000;
export const SWING_JOB_MAX_ATTEMPTS = 2;

/** Normalize a job row into the public SwingResponse the tab renders. */
export function jobToResponse(job: {
  status: string;
  payload: unknown;
  error?: string | null;
  templateCount: number;
  totalRaw: number;
}): SwingResponse {
  const payload = (job.payload ?? {}) as Partial<SwingResponse>;
  const base: SwingResponse = {
    success: true,
    generatedAt: payload.generatedAt ?? new Date().toISOString(),
    templateCount: job.templateCount,
    totalRaw: job.totalRaw,
    topN: payload.stocks?.length ?? 0,
    segregation: payload.segregation ?? countSegregation([]),
    analysisStatus: "pending",
    analysisError: null,
    stocks: payload.stocks ?? [],
  };
  if (job.status === "done") {
    return { ...base, analysisStatus: "done", analysisError: payload.analysisError ?? null };
  }
  if (job.status === "failed") {
    return {
      ...base,
      analysisStatus: "failed",
      analysisError: job.error ?? payload.analysisError ?? "AI analysis failed",
    };
  }
  // pending | running → the frozen screener feed; the tab polls until done.
  return base;
}

/**
 * Claim + process one analysis job. The atomic updateMany (pending→running,
 * attemptCount++) is the multi-instance lock — count 0 means another instance
 * already claimed it (or it was superseded). Never throws to the caller.
 */
export async function processSwingAnalysisJob(job: {
  id: string;
  payload: unknown;
  templateCount: number;
  totalRaw: number;
}): Promise<void> {
  const prisma = (await import("@/lib/prisma")).default;

  const claimed = await prisma.swingAnalysisJob.updateMany({
    where: { id: job.id, status: "pending" },
    data: { status: "running", startedAt: new Date(), attemptCount: { increment: 1 } },
  });
  if (claimed.count === 0) return; // another instance won the claim

  const stocks = ((job.payload ?? {}) as Partial<SwingResponse>).stocks ?? [];
  const templateCount = job.templateCount;
  const totalRaw = job.totalRaw;

  createAuditLog({
    action: "SWING_ANALYSIS_START",
    resource: "swing_analysis",
    resourceId: job.id,
    path: "/api/recommendations/swing",
    metadata: { stocks: stocks.length, jobId: job.id },
  }).catch(() => undefined);

  let analysisStatus: "done" | "failed" = "failed";
  let analysisError: string | null = null;

  try {
    const config = await loadConfig();
    const analyzed = await analyzeSwingStocks(stocks.map(toAnalysisInput), config);
    const bySymbol = new Map(analyzed.map((a) => [a.symbol.toUpperCase(), a]));
    for (const s of stocks) {
      const a = bySymbol.get(s.symbol);
      if (a && a.success && a.analysis) {
        s.analysis = a.analysis;
      } else {
        s.analysisError = a?.error ?? "Analysis failed";
      }
    }
    analysisStatus = analysisStatusAfterBatch(stocks) as "done" | "failed";
    const succeeded = stocks.filter((s) => s.analysis).length;

    if (analysisStatus === "failed") {
      analysisError =
        stocks.find((s) => s.analysisError)?.analysisError ?? "AI analysis failed";
      createAuditLog({
        action: "SWING_ANALYSIS_FAILED",
        resource: "swing_analysis",
        resourceId: job.id,
        path: "/api/recommendations/swing",
        errorMessage: analysisError,
        metadata: { stocks: stocks.length, succeeded, failed: stocks.length - succeeded, jobId: job.id },
      }).catch(() => undefined);
    } else {
      createAuditLog({
        action: "SWING_ANALYSIS_COMPLETE",
        resource: "swing_analysis",
        resourceId: job.id,
        path: "/api/recommendations/swing",
        metadata: { stocks: stocks.length, succeeded, jobId: job.id },
      }).catch(() => undefined);
    }
  } catch (e) {
    analysisError = e instanceof Error ? e.message : String(e);
    logger.error({
      msg: "Swing AI analysis failed — marking job failed",
      error: analysisError,
      jobId: job.id,
    });
    analysisStatus = "failed";
    createAuditLog({
      action: "SWING_ANALYSIS_FAILED",
      resource: "swing_analysis",
      resourceId: job.id,
      path: "/api/recommendations/swing",
      errorMessage: analysisError,
      metadata: { stocks: stocks.length, jobId: job.id },
    }).catch(() => undefined);
  }

  // v3.10.1: persist AI-analyzed picks as RecommendationTracker rows
  // (timeHorizon "swing") so they surface in the Performance tab's Swing
  // filter and the daily perf-check cron tracks them. Non-fatal — the feed
  // must never fail because persistence hiccuped.
  if (analysisStatus === "done") {
    try {
      const { created, updated } = await persistSwingTrackers(stocks);
      logger.info({ msg: "Swing trackers persisted", created, updated, symbols: stocks.length });
    } catch (e) {
      logger.warn({
        msg: "Swing tracker persistence failed — feed continues",
        error: e instanceof Error ? e.message : String(e),
      });
    }
    // v3.14.0: patch the posted SwingSignal rows with the AI levels so the
    // swing performance check can evaluate targets/stops. Non-fatal — a
    // level-less signal can only expire (its date-of-posting price baseline
    // is already stored).
    try {
      const { patched } = await patchSwingSignalAnalysis(job.id, stocks);
      logger.info({ msg: "Swing signal analysis patched", patched, jobId: job.id });
    } catch (e) {
      logger.warn({
        msg: "Swing signal analysis patch failed — signals stay level-less",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // A force refresh may have superseded us mid-analysis — never overwrite the
  // newer job's payload. Re-read and bail when we're no longer running.
  const fresh = await prisma.swingAnalysisJob.findUnique({ where: { id: job.id } });
  if (!fresh || fresh.status !== "running") {
    logger.warn({
      msg: "Swing job superseded mid-analysis — discarding result",
      jobId: job.id,
      status: fresh?.status,
    });
    return;
  }

  const response: SwingResponse = {
    success: true,
    generatedAt: new Date().toISOString(),
    templateCount,
    totalRaw,
    topN: stocks.length,
    segregation: countSegregation(stocks),
    analysisStatus,
    analysisError,
    stocks,
  };

  await prisma.swingAnalysisJob.update({
    where: { id: job.id },
    data: {
      status: analysisStatus,
      payload: response as unknown as Prisma.InputJsonValue,
      completedAt: new Date(),
      analyzedCount: stocks.filter((s) => s.analysis).length,
      error: analysisError,
    },
  });

  createAuditLog({
    action: "SWING_RUN_COMPLETE",
    resource: "swing",
    resourceId: job.id,
    path: "/api/recommendations/swing",
    metadata: {
      templates: templateCount,
      analyze: true,
      totalRaw,
      topN: stocks.length,
      analysisStatus,
      error: analysisError ?? undefined,
      jobId: job.id,
    },
  }).catch(() => undefined);

  // Warm the cache with the final payload so steady-state polls skip the DB
  // (24h done-cache; the DB row remains the durable source of truth).
  staticCache.set(`${SWING_CACHE_KEY}:ai`, response, SWING_DONE_CACHE_TTL);

  // v3.16.0: broadcast actionable swing signals (LONG/SHORT) to Telegram
  // subscribers after successful analysis. Non-critical — notification
  // failures must never affect the feed or the DB job.
  if (analysisStatus === "done") {
    try {
      const { broadcastToSubscribers } = await import("./telegramBotService");
      const { buildSwingBroadcast } = await import("./recommendationBroadcast");
      const tgMessage = buildSwingBroadcast(stocks.map((s) => ({
        symbol: s.symbol,
        price: s.price,
        analysis: s.analysis,
      })));
      const sent = await broadcastToSubscribers("🌊 Swing Signals", tgMessage);
      logger.info({ msg: "Telegram broadcast for swing signals", sent, jobId: job.id });
    } catch (tgErr) {
      logger.warn({ msg: "Swing Telegram broadcast failed (non-critical)", error: tgErr });
    }
  }
}

/**
 * Drain the swing analysis queue. Recovery + claim:
 *   1. Stale running jobs (instance died mid-batch) → back to pending for a
 *      retry; exhausted attempts → failed with a readable error.
 *   2. Claim the OLDEST pending job and process it (multi-instance safe via
 *      the atomic updateMany claim).
 * Never throws — the daemon tick and the request path fire-and-forget.
 */
export async function maybeProcessSwingAnalysis(): Promise<void> {
  if (swingProcessorInFlight) return;

  const run = (async () => {
    try {
      const prisma = (await import("@/lib/prisma")).default;
      const staleBefore = new Date(Date.now() - SWING_JOB_STALE_MS);

      const retried = await prisma.swingAnalysisJob.updateMany({
        where: {
          status: "running",
          startedAt: { lt: staleBefore },
          attemptCount: { lt: SWING_JOB_MAX_ATTEMPTS },
        },
        data: { status: "pending", startedAt: null },
      });
      const exhausted = await prisma.swingAnalysisJob.updateMany({
        where: {
          status: "running",
          startedAt: { lt: staleBefore },
          attemptCount: { gte: SWING_JOB_MAX_ATTEMPTS },
        },
        data: {
          status: "failed",
          error: `Swing AI analysis timed out after ${SWING_JOB_MAX_ATTEMPTS} attempt(s)`,
          completedAt: new Date(),
        },
      });
      if (retried.count > 0 || exhausted.count > 0) {
        logger.warn({
          msg: "Swing analysis jobs recovered from stale running",
          retried: retried.count,
          exhausted: exhausted.count,
        });
      }

      const pending = await prisma.swingAnalysisJob.findFirst({
        where: { status: "pending" },
        orderBy: { createdAt: "asc" },
      });
      if (!pending) return;
      await processSwingAnalysisJob(pending);
    } catch (e) {
      logger.error({
        msg: "Swing analysis processor crashed — job stays pending for next tick",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  })();

  swingProcessorInFlight = run.finally(() => {
    swingProcessorInFlight = null;
  });
  return swingProcessorInFlight;
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

  // v3.23.x: during a plan-limit hold the Prisma account is unavailable —
  // the cached payload above is served on steady-state polls; below we avoid
  // EVERY Prisma read/write (job lookup, supersede, job create, signal
  // persistence, processor kick) and fall through to a screener-only feed.
  // The tab degrades gracefully (honest "pending" analysis) and Prisma is
  // only touched again on the 6h recovery sync or a manual force.
  const breakerOpen = isPlanLimitBreakerOpen();
  const templateIds = getSwingTemplateIds();
  const prisma = (await import("@/lib/prisma")).default;

  // Analyze=true fast path: a completed/pending DB job serves the response
  // WITHOUT re-running the screener — the job row is the durable source of
  // truth (survives cache LRU eviction + instance recycle), the cache is only
  // a 30-min accelerator for steady-state polls.
  if (analyze && !breakerOpen) {
    const latestJob = await prisma.swingAnalysisJob.findFirst({
      orderBy: { createdAt: "desc" },
    });
    if (latestJob && !forceRefresh) {
      const served = jobToResponse(latestJob);
      if (served.analysisStatus === "done" || served.analysisStatus === "failed") {
        staticCache.set(cacheKey, served, SWING_DONE_CACHE_TTL);
      } else {
        // pending/running — serve the frozen feed; the daemon (or the kick
        // below) settles it. The job stores the full screener feed, so no
        // scan is needed here.
        maybeProcessSwingAnalysis().catch(() => undefined);
      }
      logger.info({
        msg: "Swing served from DB job",
        status: latestJob.status,
        jobId: latestJob.id,
        analyze,
        forceRefresh,
      });
      return served;
    }

    // forceRefresh supersedes any in-flight work so the UI's "Refresh" always
    // wins: stale pending/running jobs are failed with a readable reason and
    // the new job takes over. The superseded processor aborts on its final
    // re-read (status !== running) and discards its result.
    if (forceRefresh) {
      const superseded = await prisma.swingAnalysisJob.updateMany({
        where: { status: { in: ["pending", "running"] } },
        data: {
          status: "failed",
          error: "Superseded by a newer force refresh",
          completedAt: new Date(),
        },
      });
      if (superseded.count > 0) {
        logger.warn({ msg: "Swing jobs superseded by force refresh", count: superseded.count });
      }
      // v3.14.0: drop any cached done/failed payload — the old run's targets
      // must never show once a newer run has started (a stale "ready" feed
      // while the new one analyzes is exactly the bug this feature fixes).
      staticCache.del(cacheKey);
    }
  }

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

  // Empty feed → synchronous skipped response (no job, no AI — nothing to
  // analyze). The tab renders its honest empty state.
  if (analyze && enriched.length === 0) {
    const empty: SwingResponse = {
      success: true,
      generatedAt: new Date().toISOString(),
      templateCount: templateIds.length,
      totalRaw: 0,
      topN: 0,
      segregation: countSegregation([]),
      analysisStatus: "skipped",
      analysisError: null,
      stocks: [],
    };
    staticCache.set(cacheKey, empty, SWING_DONE_CACHE_TTL);
    return empty;
  }

  // analyze=true → persist a durable job and return the pending feed
  // immediately; the processor (daemon tick + this kick) completes it in the
  // background. The DB row survives Netlify instance recycle and staticCache
  // LRU eviction — the tab can never hang on "generating".
  if (analyze && !breakerOpen) {
    const created = await prisma.swingAnalysisJob.create({
      data: {
        status: "pending",
        payload: {
          generatedAt: new Date().toISOString(),
          stocks: enriched,
          segregation: countSegregation(enriched),
        } as unknown as Prisma.InputJsonValue,
        stockCount: enriched.length,
        templateCount: templateIds.length,
        totalRaw: deduped.length,
      },
    });

    // v3.14.0: drop any cached done/failed payload from the previous run —
    // the tab must show THIS run's frozen pending feed, not the last run's
    // targets (the processor re-warms the cache when this run completes).
    staticCache.del(cacheKey);

    // v3.14.0: persist the durable SwingSignal rows at posting time (the
    // date-of-posting snapshot the swing performance check tracks; AI levels
    // are patched in when the background analysis completes). Non-fatal — a
    // persistence hiccup must not fail the feed.
    try {
      const { created: signalCount } = await persistSwingSignals(created.id, enriched);
      logger.info({ msg: "Swing signals persisted", created: signalCount, jobId: created.id });
    } catch (e) {
      logger.warn({
        msg: "Swing signal persistence failed — feed continues",
        error: e instanceof Error ? e.message : String(e),
      });
    }

    maybeProcessSwingAnalysis().catch(() => undefined);

    const pending: SwingResponse = {
      success: true,
      generatedAt: created.generatedAt.toISOString(),
      templateCount: created.templateCount,
      totalRaw: created.totalRaw,
      topN: created.stockCount,
      segregation: countSegregation(enriched),
      analysisStatus: "pending",
      analysisError: null,
      stocks: enriched,
    };
    return pending;
  }

  // v3.23.x: plan-limit breaker open + analyze=true — cannot persist a durable
  // job (Prisma writes are held). Return the fresh screener-only feed with an
  // honest "pending" analysis status (no AI, no job row); the tab's SWR poll
  // re-serves the cached payload once the breaker closes (6h recovery sync /
  // manual force) and a normal run can proceed then. The feed itself is still
  // served so the tab shows live data, not a freeze.
  if (analyze && breakerOpen) {
    recordRead("swing.breaker-open-feed", {
      source: "sqlite",
      latencyMs: 0,
      rows: enriched.length,
      hit: true,
    });
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

  staticCache.set(cacheKey, response, SWING_FEED_CACHE_TTL);
  return response;
}
