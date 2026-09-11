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

import { randomUUID } from "crypto";
import { getSqliteFallback } from "@/lib/sqlite";
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

/**
 * Persist AI-analyzed swing picks as active RecommendationTracker rows
 * (timeHorizon "swing") in the local SQLite mirror. New symbols are created;
 * existing active swing trackers get currentPrice/lastCheckedAt refreshed
 * (targets stay as-of creation — matching the daily pipeline's tracker
 * convention). The mirror's 6h push sink promotes rows to Prisma; the upserts
 * are recorded in `_sync_outbox` for cross-instance reconcile. Non-fatal —
 * callers must catch; a null mirror degrades to a no-op.
 */
export async function persistSwingTrackers(
  stocks: SwingStock[],
): Promise<{ created: number; updated: number }> {
  const analyzed = stocks.filter((s) => s.analysis);
  if (analyzed.length === 0) return { created: 0, updated: 0 };

  const sqlite = getSqliteFallback();
  if (!sqlite) return { created: 0, updated: 0 };

  const symbols = analyzed.map((s) => s.symbol);
  const existing = sqlite.getRecommendationTrackers({
    symbolIn: symbols.map((s) => s.toUpperCase()),
    status: ["active"],
    limit: 500,
  });
  // The mirror query has no timeHorizon filter — swing rows are filtered in
  // memory (rehydrated rows are camelCase, e.g. `timeHorizon`).
  const existingSwing = existing.filter(
    (r) => String(r.timeHorizon ?? "") === SWING_TIME_HORIZON,
  );
  const existingSymbols = new Set(existingSwing.map((r) => String(r.symbol).toUpperCase()));

  let created = 0;
  const now = new Date();
  for (const s of analyzed) {
    if (existingSymbols.has(s.symbol.toUpperCase())) continue;
    const draft = swingTrackerDraft(s);
    if (!draft) continue;
    sqlite.upsertRecommendationTracker({
      id: randomUUID(),
      symbol: s.symbol.toUpperCase(),
      status: "active",
      entryPrice: draft.entryPrice,
      currentPrice: draft.currentPrice,
      targetPrice: draft.targetPrice,
      stopLoss: draft.stopLoss,
      timeHorizon: draft.timeHorizon,
      confidence: draft.confidence,
      aiRecommendation: draft.aiRecommendation,
      reasoning: draft.reasoning,
      riskFactors: draft.riskFactors,
      screenerAttribution: draft.screenerAttribution,
      createdAt: now,
      updatedAt: now,
    });
    created++;
    existingSymbols.add(s.symbol.toUpperCase());
  }

  const priceBySymbol = new Map(analyzed.map((s) => [s.symbol.toUpperCase(), s.price]));
  let updated = 0;
  for (const row of existingSwing) {
    const price = priceBySymbol.get(String(row.symbol).toUpperCase());
    if (price == null) continue;
    sqlite.upsertRecommendationTracker({ ...row, currentPrice: Number(price), updatedAt: now });
    updated++;
  }

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
  indicators: unknown | null;
  momentumScore: number;
  analysis: unknown | null;
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
    indicators: stock.indicators ?? null,
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
  analysis: unknown;
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
    analysis: a,
    aiRecommendation: swingActionToRecommendation(a.action),
    confidence: a.confidence,
    targetPrice: a.targetPrice,
    stopLoss: a.stopLoss,
  };
}

/**
 * Persist the posted feed into SwingSignal at JOB CREATION — the durable
 * "date of posting" snapshot the swing performance check tracks, landed in the
 * local SQLite mirror (6h push sink promotes to Prisma). Idempotent — signals
 * already posted for this job (deduped by symbol) are skipped. Non-fatal —
 * callers catch; the pipeline must never fail because persistence hiccuped.
 */
export async function persistSwingSignals(
  jobId: string,
  stocks: SwingStock[],
): Promise<{ created: number }> {
  if (stocks.length === 0) return { created: 0 };
  const sqlite = getSqliteFallback();
  if (!sqlite) return { created: 0 };

  const existing = new Set(
    sqlite.getSwingSignals(jobId).map((r) => String(r.symbol).toUpperCase()),
  );
  const now = new Date();
  let created = 0;
  for (const s of stocks) {
    if (existing.has(s.symbol.toUpperCase())) continue;
    const draft = swingSignalDraft(s, jobId);
    sqlite.upsertSwingSignal({
      id: randomUUID(),
      jobId: draft.jobId,
      symbol: draft.symbol.toUpperCase(),
      name: draft.name,
      price: draft.price,
      change: draft.change,
      changePercent: draft.changePercent,
      volume: draft.volume,
      marketCap: draft.marketCap,
      screenerNames: draft.screenerNames,
      screenerCount: draft.screenerCount,
      families: draft.families,
      templateIds: draft.templateIds,
      source: draft.source,
      indicators: draft.indicators,
      momentumScore: draft.momentumScore,
      analysis: null,
      aiRecommendation: null,
      confidence: null,
      targetPrice: null,
      stopLoss: null,
      currentPrice: s.price,
      returnPercent: null,
      status: "tracking",
      postedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    created++;
    existing.add(draft.symbol.toUpperCase());
  }
  return { created };
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
): Promise<{ patched: number }> {
  const sqlite = getSqliteFallback();
  if (!sqlite) return { patched: 0 };

  const rows = sqlite.getSwingSignals(jobId);
  let patched = 0;
  for (const stock of stocks) {
    const patch = swingSignalAnalysisPatch(stock);
    if (!patch) continue;
    const row = rows.find(
      (r) => String(r.symbol).toUpperCase() === stock.symbol.toUpperCase(),
    );
    if (!row) continue;
    sqlite.upsertSwingSignal({
      ...row,
      analysis: patch.analysis,
      aiRecommendation: patch.aiRecommendation,
      confidence: patch.confidence,
      targetPrice: patch.targetPrice,
      stopLoss: patch.stopLoss,
      updatedAt: new Date(),
    });
    patched++;
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
export function jobToResponse(job: Record<string, unknown>): SwingResponse {
  const payload = (job.payload ?? {}) as Partial<SwingResponse>;
  const status = String(job.status ?? "");
  const templateCount = Number(job.templateCount ?? 0);
  const totalRaw = Number(job.totalRaw ?? 0);
  const errorFromJob = job.error != null ? String(job.error) : null;
  const base: SwingResponse = {
    success: true,
    generatedAt: payload.generatedAt ?? new Date().toISOString(),
    templateCount,
    totalRaw,
    topN: payload.stocks?.length ?? 0,
    segregation: payload.segregation ?? countSegregation([]),
    analysisStatus: "pending",
    analysisError: null,
    stocks: payload.stocks ?? [],
  };
  if (status === "done") {
    return { ...base, analysisStatus: "done", analysisError: payload.analysisError ?? null };
  }
  if (status === "failed") {
    return {
      ...base,
      analysisStatus: "failed",
      analysisError: errorFromJob ?? payload.analysisError ?? "AI analysis failed",
    };
  }
  // pending | running → the frozen screener feed; the tab polls until done.
  return base;
}

/**
 * Claim + process one analysis job. Under the SQLite-primary model the claim
 * is a per-instance mirror read-then-upsert (the v3.13.0 cross-instance
 * atomic updateMany is intentionally abandoned — each instance owns its own
 * mirror): re-read the job and bail unless it's still pending, then re-upsert
 * as running with attemptCount++. The supersede-abort guard below still
 * protects against a force refresh landing mid-analysis. Never throws.
 */
export async function processSwingAnalysisJob(job: Record<string, unknown>): Promise<void> {
  const jobId = String(job.id ?? "");
  const sqlite = getSqliteFallback();
  if (!sqlite) return; // no mirror — cannot persist job state

  const claimed = sqlite.getSwingAnalysisJob(jobId);
  if (!claimed || String(claimed.status) !== "pending") return; // not claimable
  sqlite.upsertSwingAnalysisJob({
    ...claimed,
    status: "running",
    startedAt: new Date(),
    attemptCount: Number(claimed.attemptCount ?? 0) + 1,
  });

  const stocks = ((job.payload ?? {}) as Partial<SwingResponse>).stocks ?? [];
  const templateCount = Number(job.templateCount ?? 0);
  const totalRaw = Number(job.totalRaw ?? 0);

  createAuditLog({
    action: "SWING_ANALYSIS_START",
    resource: "swing_analysis",
    resourceId: jobId,
    path: "/api/recommendations/swing",
    metadata: { stocks: stocks.length, jobId: jobId },
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
        resourceId: jobId,
        path: "/api/recommendations/swing",
        errorMessage: analysisError,
        metadata: { stocks: stocks.length, succeeded, failed: stocks.length - succeeded, jobId: jobId },
      }).catch(() => undefined);
    } else {
      createAuditLog({
        action: "SWING_ANALYSIS_COMPLETE",
        resource: "swing_analysis",
        resourceId: jobId,
        path: "/api/recommendations/swing",
        metadata: { stocks: stocks.length, succeeded, jobId: jobId },
      }).catch(() => undefined);
    }
  } catch (e) {
    analysisError = e instanceof Error ? e.message : String(e);
    logger.error({
      msg: "Swing AI analysis failed — marking job failed",
      error: analysisError,
      jobId: jobId,
    });
    analysisStatus = "failed";
    createAuditLog({
      action: "SWING_ANALYSIS_FAILED",
      resource: "swing_analysis",
      resourceId: jobId,
      path: "/api/recommendations/swing",
      errorMessage: analysisError,
      metadata: { stocks: stocks.length, jobId: jobId },
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
      const { patched } = await patchSwingSignalAnalysis(jobId, stocks);
      logger.info({ msg: "Swing signal analysis patched", patched, jobId: jobId });
    } catch (e) {
      logger.warn({
        msg: "Swing signal analysis patch failed — signals stay level-less",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // A force refresh may have superseded us mid-analysis — never overwrite the
  // newer job's payload. Re-read the mirror and bail when we're no longer
  // running.
  const fresh = sqlite.getSwingAnalysisJob(jobId);
  if (!fresh || String(fresh.status) !== "running") {
    logger.warn({
      msg: "Swing job superseded mid-analysis — discarding result",
      jobId: jobId,
      status: fresh ? String(fresh.status) : undefined,
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

  sqlite.upsertSwingAnalysisJob({
    ...fresh,
    status: analysisStatus,
    payload: response,
    completedAt: new Date(),
    analyzedCount: stocks.filter((s) => s.analysis).length,
    error: analysisError,
    updatedAt: new Date(),
  });

  createAuditLog({
    action: "SWING_RUN_COMPLETE",
    resource: "swing",
    resourceId: jobId,
    path: "/api/recommendations/swing",
    metadata: {
      templates: templateCount,
      analyze: true,
      totalRaw,
      topN: stocks.length,
      analysisStatus,
      error: analysisError ?? undefined,
      jobId: jobId,
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
      logger.info({ msg: "Telegram broadcast for swing signals", sent, jobId: jobId });
    } catch (tgErr) {
      logger.warn({ msg: "Swing Telegram broadcast failed (non-critical)", error: tgErr });
    }
  }
}

/**
 * Drain the swing analysis queue. Recovery + claim:
 *   1. Stale running jobs (instance died mid-batch) → back to pending for a
 *      retry; exhausted attempts → failed with a readable error.
 *   2. Claim the OLDEST pending job (mirror read, ordered by created_at) and
 *      process it. Per-instance mirror: no cross-instance atomicity.
 * Never throws — the daemon tick and the request path fire-and-forget.
 */
export async function maybeProcessSwingAnalysis(): Promise<void> {
  if (swingProcessorInFlight) return;

  const run = (async () => {
    try {
      const sqlite = getSqliteFallback();
      if (!sqlite) return;
      const staleBefore = new Date(Date.now() - SWING_JOB_STALE_MS);

      let retried = 0;
      let exhausted = 0;
      for (const row of sqlite.getSwingAnalysisJobs({ status: "running", limit: 100 })) {
        const startedAt =
          row.startedAt instanceof Date ? row.startedAt : new Date(String(row.startedAt ?? ""));
        if (startedAt.getTime() >= staleBefore.getTime()) continue;
        const attemptCount = Number(row.attemptCount ?? 0);
        if (attemptCount < SWING_JOB_MAX_ATTEMPTS) {
          sqlite.upsertSwingAnalysisJob({
            ...row,
            status: "pending",
            startedAt: null,
            updatedAt: new Date(),
          });
          retried++;
        } else {
          sqlite.upsertSwingAnalysisJob({
            ...row,
            status: "failed",
            error: `Swing AI analysis timed out after ${SWING_JOB_MAX_ATTEMPTS} attempt(s)`,
            completedAt: new Date(),
            updatedAt: new Date(),
          });
          exhausted++;
        }
      }
      if (retried > 0 || exhausted > 0) {
        logger.warn({
          msg: "Swing analysis jobs recovered from stale running",
          retried,
          exhausted,
        });
      }

      const pending = sqlite.getSwingAnalysisJobs({ status: "pending", limit: 1 })[0];
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
  const sqlite = getSqliteFallback();

  // Analyze=true fast path: a completed/pending DB job serves the response
  // WITHOUT re-running the screener — the job row is the durable source of
  // truth (survives cache LRU eviction + instance recycle), the cache is only
  // a 30-min accelerator for steady-state polls.
  if (analyze && !breakerOpen) {
    const jobs =
      sqlite?.getSwingAnalysisJobs({
        status: ["pending", "running", "done", "failed"],
        limit: 500,
      }) ?? [];
    // Mirror orders created_at ASC — the LAST row is the newest job.
    const latestJob = jobs.length > 0 ? jobs[jobs.length - 1] : null;
    if (latestJob && !forceRefresh) {
      // Strict manual-only generation: an existing done/failed result is served
      // INDEFINITELY — no age gate, no auto-regeneration on a plain load. A
      // manual refresh (force=1) is the ONLY trigger for a new generation.
      const status = String(latestJob.status ?? "");

      // Liveness for pending/running rows: a job abandoned mid-flight (dead
      // instance, stuck force refresh) must never hide an older terminal result.
      const staleBefore = Date.now() - SWING_JOB_STALE_MS;
      const staleTime =
        status === "pending"
          ? latestJob.createdAt instanceof Date
            ? latestJob.createdAt.getTime()
            : new Date(String(latestJob.createdAt ?? "")).getTime()
          : status === "running"
            ? latestJob.startedAt instanceof Date
              ? latestJob.startedAt.getTime()
              : new Date(String(latestJob.startedAt ?? "")).getTime()
            : Number.NaN;
      const stale = !Number.isNaN(staleTime) && staleTime < staleBefore;

      // Newest TERMINAL (done/failed) row — the feed the tab should render
      // when the newest job is fresh in-flight or stale/abandoned.
      let terminal: Record<string, unknown> | null = null;
      for (let i = jobs.length - 1; i >= 0; i--) {
        const s = String(jobs[i].status ?? "");
        if (s === "done" || s === "failed") {
          terminal = jobs[i];
          break;
        }
      }

      if (status === "done" || status === "failed") {
        // Prior run's AI verdicts — cache 24h as a steady-state accelerator.
        const served = jobToResponse(latestJob);
        staticCache.set(cacheKey, served, SWING_DONE_CACHE_TTL);
        logger.info({
          msg: "Swing served from DB job",
          status,
          jobId: String(latestJob.id ?? ""),
          analyze,
          forceRefresh,
        });
        return served;
      }
      if (!stale && (status === "pending" || status === "running")) {
        // Fresh generation in flight — serve its frozen feed; the daemon (or
        // the kick below) settles it. The job stores the full screener feed,
        // so no scan is needed here.
        const served = jobToResponse(latestJob);
        maybeProcessSwingAnalysis().catch(() => undefined);
        logger.info({
          msg: "Swing served from DB job (in flight)",
          status,
          jobId: String(latestJob.id ?? ""),
          analyze,
          forceRefresh,
        });
        return served;
      }
      if (stale && terminal) {
        // Abandoned job hiding an older result — surface the terminal feed and
        // keep the drain ticking so recovery settles the stale row.
        const served = jobToResponse(terminal);
        staticCache.set(cacheKey, served, SWING_DONE_CACHE_TTL);
        maybeProcessSwingAnalysis().catch(() => undefined);
        logger.warn({
          msg: "Swing stale pending/running job — serving newest terminal result",
          staleStatus: status,
          staleJobId: String(latestJob.id ?? ""),
          terminalStatus: String(terminal.status ?? ""),
          terminalJobId: String(terminal.id ?? ""),
        });
        return served;
      }
      // stale && !terminal — abandoned first/only run: nothing better exists,
      // so keep serving its frozen feed while recovery retries it.
      const served = jobToResponse(latestJob);
      maybeProcessSwingAnalysis().catch(() => undefined);
      logger.warn({
        msg: "Swing stale pending/running job — no terminal result, serving frozen feed",
        status,
        jobId: String(latestJob.id ?? ""),
      });
      return served;
    }

    // Mirror EMPTY — the local sql.js mirror may be unavailable or never synced
    // while Prisma (the promoted source of truth) still holds the latest job.
    // One lazy fallback read prevents a spurious brand-new job from being
    // created on every plain load.
    if (!forceRefresh && jobs.length === 0) {
      let prismaRow: Record<string, unknown> | null = null;
      try {
        const prisma = (await import("@/lib/prisma")).default;
        prismaRow = (await prisma.swingAnalysisJob.findFirst({
          orderBy: { createdAt: "desc" },
        })) as Record<string, unknown> | null;
      } catch (e) {
        logger.warn({
          msg: "Swing Prisma fallback lookup failed — proceeding with fresh run",
          error: e instanceof Error ? e.message : String(e),
        });
      }
      if (prismaRow) {
        const served = jobToResponse(prismaRow);
        if (served.analysisStatus === "done" || served.analysisStatus === "failed") {
          staticCache.set(cacheKey, served, SWING_DONE_CACHE_TTL);
        } else {
          // pending/running — frozen feed; the processor settles it.
          maybeProcessSwingAnalysis().catch(() => undefined);
        }
        logger.info({
          msg: "Swing served from Prisma job (mirror empty)",
          status: String(prismaRow.status ?? ""),
          jobId: String(prismaRow.id ?? ""),
          analyze,
          forceRefresh,
        });
        return served;
      }
    }

    // forceRefresh supersedes any in-flight work so the UI's "Refresh" always
    // wins: stale pending/running jobs are failed with a readable reason and
    // the new job takes over. The superseded processor aborts on its final
    // re-read (status !== running) and discards its result.
    if (forceRefresh) {
      let superseded = 0;
      // Manual refresh = the moment to settle the PREVIOUS results' status:
      // any prior terminal (done/failed) job's posted swing signals get a
      // performance check (target/stop/expiry) before the new generation
      // supersedes them. Fire-and-forget — a failure never blocks the refresh.
      if (jobs.some((j) => ["done", "failed"].includes(String(j.status ?? "")))) {
        import("./swingPerformanceService")
          .then(({ checkSwingPerformance }) => checkSwingPerformance())
          .catch((e) => {
            logger.warn({
              msg: "Swing performance check kick failed (non-critical)",
              error: e instanceof Error ? e.message : String(e),
            });
          });
      }
      for (const row of
        sqlite?.getSwingAnalysisJobs({ status: ["pending", "running"], limit: 500 }) ?? []) {
        sqlite?.upsertSwingAnalysisJob({
          ...row,
          status: "failed",
          error: "Superseded by a newer force refresh",
          completedAt: new Date(),
          updatedAt: new Date(),
        });
        superseded++;
      }
      if (superseded > 0) {
        logger.warn({ msg: "Swing jobs superseded by force refresh", count: superseded });
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
    // SQLite-primary: the job row lives in the local mirror + sync outbox
    // (the 6h push sink promotes it to Prisma). Same-server reads of the
    // just-written row must come from the mirror, never Prisma.
    const jobId = randomUUID();
    sqlite?.upsertSwingAnalysisJob({
      id: jobId,
      status: "pending",
      payload: {
        generatedAt: new Date().toISOString(),
        stocks: enriched,
        segregation: countSegregation(enriched),
      },
      stockCount: enriched.length,
      templateCount: templateIds.length,
      totalRaw: deduped.length,
      attemptCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // Read back the just-written row (mirror-first guarantee).
    const created = sqlite?.getSwingAnalysisJob(jobId);

    // v3.14.0: drop any cached done/failed payload from the previous run —
    // the tab must show THIS run's frozen pending feed, not the last run's
    // targets (the processor re-warms the cache when this run completes).
    staticCache.del(cacheKey);

    // v3.14.0: persist the durable SwingSignal rows at posting time (the
    // date-of-posting snapshot the swing performance check tracks; AI levels
    // are patched in when the background analysis completes). Non-fatal — a
    // persistence hiccup must not fail the feed.
    if (created) {
      try {
        const { created: signalCount } = await persistSwingSignals(jobId, enriched);
        logger.info({ msg: "Swing signals persisted", created: signalCount, jobId });
      } catch (e) {
        logger.warn({
          msg: "Swing signal persistence failed — feed continues",
          error: e instanceof Error ? e.message : String(e),
        });
      }

      // Kick the processor so the very first poll settles the pending feed.
      maybeProcessSwingAnalysis().catch(() => undefined);
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
