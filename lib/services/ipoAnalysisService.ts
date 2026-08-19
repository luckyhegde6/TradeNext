// lib/services/ipoAnalysisService.ts
//
// IPO AI analysis: runs the 14-step equity-research template against the
// OpenRouter LLM for a single IPO issue and caches the result so repeated
// "Analyze" clicks (by any logged-in user) reuse the SAME AI output within
// a 12-hour window instead of re-hitting the (paid/free-quota) model.
//
// Cache layout (mirrors the syncedDataService pattern):
//   memory : cache key `ipo_analysis_<SYMBOL>` (TTL 12h)
//   DB     : MarketCache row `cacheKey = ipo_analysis_<SYMBOL>`,
//            `dataType = "ipo_analysis"`, `data = { symbol, companyName,
//            content, verdict, recommendation, generatedAt }`
//   source : "cache" (memory/DB fresh) | "ai" (fresh generation + persist)
//            | "db" (stale/expired row served only when the AI call fails)
//
// The template below is the product-defined 14-step analyst brief (do NOT
// trim sections — the model is instructed to answer every step).

import { directPrompt, getPromptTimeoutMs, isQuotaExhausted, QUOTA_EXHAUSTED_MESSAGE } from "@/lib/services/ai/llm-provider";
import { loadConfig, hasValidConfig, type AIConfig } from "@/lib/services/ai/config";
import { modelFallbackChain } from "@/lib/services/ai/modelChain";
import { trackAiCall } from "@/lib/services/ai/ai-monitoring";
import cache from "@/lib/cache";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { createAuditLog } from "@/lib/audit";
import type { IpoIssue } from "@/lib/services/nseIpoService";
import { getUpcomingIpoIssues } from "@/lib/services/nseIpoService";
import {
  buildIpoReportPrompt,
  parseIpoReportJson,
  normalizeReport,
  type IpoReport,
} from "@/lib/services/ipoReport";

/* ─── Types ─── */

export interface IpoAnalysis {
  symbol: string;
  companyName: string;
  /** Full 14-step analysis markdown as returned by the model. */
  content: string;
  /** Best-effort extraction of the closing "Investment Verdict" section. */
  verdict: string;
  /** Best-effort extraction of the final recommendation label (A/B/C/D wording). */
  recommendation: string;
  generatedAt: string;
  /** v2 structured JSON report (parsed from the model reply) — absent for
   *  legacy markdown rows cached before the v2 roll-out. */
  report?: IpoReport | null;
}

export interface IpoAnalysisResult extends IpoAnalysis {
  source: "cache" | "ai" | "db";
  /** When served from a persisted row — the row's lastSyncedAt. */
  cachedAt: string | null;
}

/* ─── Constants ─── */

export const IPO_ANALYSIS_CACHE_TTL_SECONDS = 12 * 60 * 60; // 12h reuse window
const IPO_ANALYSIS_DATATYPE = "ipo_analysis";
/** Generous token ceiling — the 14-step output is long (maxTokens from admin
 *  config defaults to 2048 which would truncate it). */
const IPO_ANALYSIS_MAX_TOKENS = 8192;

/* ─── The 14-step product template ─── */

/** Parse "Rs.92 to Rs.97" / "Rs.1,200" into [lower, upper] numbers (₹). */
export function parsePriceBand(priceText: string | undefined | null): number[] {
  if (!priceText) return [];
  const matches = priceText.match(/\d[\d,]*\.?\d*/g) || [];
  return matches.map((m) => parseFloat(m.replace(/,/g, ""))).filter((n) => !Number.isNaN(n) && n > 0);
}

/**
 * Minimum investment for ROI calculations — the product rule is
 * LOT SIZE = 1 share, so minimum investment = 1 × price band lower end.
 * Returns a human string like "₹92 (1 lot × ₹92)" or "Not yet announced".
 */
export function minimumInvestmentLabel(issue: IpoIssue): string {
  const vals = parsePriceBand(issue.issuePrice || issue.priceBand);
  const lower = vals.length > 0 ? vals[0] : null;
  if (lower === null || !Number.isFinite(lower)) return "Not yet announced";
  return `₹${lower.toLocaleString("en-IN")} (1 lot × price band low ₹${lower.toLocaleString("en-IN")})`;
}

export function buildIpoAnalysisPrompt(issue: IpoIssue): string {
  const name = issue.companyName || issue.symbol;
  const price = issue.issuePrice || issue.priceBand || "Not yet announced";
  const shares = "1 lot (1 share)"; // product rule — fixed lot size for ROI math
  const minInvestment = minimumInvestmentLabel(issue);
  const listingDate =
    issue.issueEndDate ||
    issue.issueStartDate ||
    "Not yet announced (typically T+3 after issue close)";

  return `You are an experienced equity research analyst specializing in IPOs.

Your task is to determine whether I should:

1. Hold the IPO for the long term
2. Exit completely on listing day
3. Partially book profits and hold the remaining shares

Do NOT give generic advice.
Make a conviction-based recommendation backed by evidence.

------------------------------------
INPUT
------------------------------------

IPO Name:
${name}

Purchase Price:
${price}

Quantity:
${shares}

Minimum Investment (for ROI calculations):
${minInvestment}

Listing Date:
${listingDate}

------------------------------------
STEP 1 - Company Overview
------------------------------------

Provide:

- Business model
- Industry
- Revenue sources
- Competitive advantage
- Promoters
- Major institutional investors
- Market share
- Key products/services

------------------------------------
STEP 2 - Financial Analysis
------------------------------------

Analyze at least the last 3 years.

Include:

Revenue Growth
PAT Growth
EBITDA Margin
ROE
ROCE
Debt to Equity
Operating Cash Flow
Free Cash Flow
EPS
Valuation (P/E, EV/EBITDA if available)

State whether the company is:

Excellent
Good
Average
Poor

Explain why.

------------------------------------
STEP 3 - IPO Details
------------------------------------

Summarize:

Issue Size
Fresh Issue
Offer For Sale
Price Band
Objects of Issue
Anchor Investors
Subscription Numbers

Break subscription into:

QIB
NII
Retail
Employees

Explain what these numbers indicate.

------------------------------------
STEP 4 - Grey Market Analysis
------------------------------------

Find the latest GMP.

Include:

Current GMP
Estimated Listing Price
Expected Listing Gain %

Also mention:

GMP trend over the last week

Increasing
Stable
Declining

Explain whether GMP looks healthy or speculative.

Do NOT rely solely on GMP.

------------------------------------
STEP 5 - Latest News
------------------------------------

Collect news from reliable financial sources.

Look for:

Expansion
Government approvals
Large contracts
Legal issues
Regulatory actions
Management changes
Industry developments
Competitor news

Summarize only meaningful news.

Ignore clickbait.

------------------------------------
STEP 6 - Social & Market Sentiment
------------------------------------

Analyze current market sentiment from:

Financial news
Broker reports
Investor discussions
Social media (only if credible)

Summarize:

Bullish points

Bearish points

Mention if sentiment is hype-driven.

------------------------------------
STEP 7 - Peer Comparison
------------------------------------

Compare with listed peers.

Include:

Revenue
PAT Margin
ROE
ROCE
P/E
Market Cap
Growth Rate

State whether the IPO is:

Undervalued
Fairly Valued
Overvalued

------------------------------------
STEP 8 - Future Growth
------------------------------------

Analyze:

Industry growth
Expansion plans
Capex
Government policy
New products
Exports
Competitive moat
Technology
Management quality

Estimate growth potential over:

1 year

3 years

5 years

------------------------------------
STEP 9 - Risks
------------------------------------

Identify:

Business risks
Customer concentration
Debt
Promoter risks
Regulatory risks
Competition
Margin pressure
Supply chain issues
Economic slowdown

Rank each as:

Low
Medium
High

------------------------------------
STEP 10 - Listing Day Strategy
------------------------------------

Estimate probability of:

Strong Listing (>30%)

Moderate Listing (10-30%)

Flat Listing

Negative Listing

Give confidence percentage.

------------------------------------
STEP 11 - Long-Term Investment Score
------------------------------------

Score each category out of 10.

Business Quality

Financial Strength

Management

Valuation

Industry Outlook

Growth Potential

Risk

Competitive Advantage

Institutional Interest

Overall Score

Provide a total score out of 100.

------------------------------------
STEP 12 - Final Recommendation
------------------------------------

Choose ONLY ONE.

A)
SELL 100% ON LISTING DAY

B)
SELL 50% AND HOLD 50%

C)
HOLD FOR 1-3 YEARS

D)
STRONG LONG-TERM HOLD (3-5+ YEARS)

Then explain WHY in plain English.

------------------------------------
STEP 13 - Exit Strategy
------------------------------------

If holding:

Provide:

Target Price (1 Year)

Target Price (3 Years)

Target Price (5 Years)

Key events to monitor

Conditions that would make you SELL early

------------------------------------
STEP 14 - Confidence
------------------------------------

Provide confidence level.

Example:

Recommendation Confidence: 84%

Explain why it is not 100%.

------------------------------------
RULES
------------------------------------

• Use the latest available information.
• Cross-check facts from multiple reliable financial sources.
• Distinguish facts from opinions.
• Do not use GMP alone as a reason to buy or sell.
• Base recommendations primarily on business quality, valuation, financials, and long-term growth.
• Mention any missing or uncertain information explicitly.
• End with a concise "Investment Verdict" section that states the recommended action and the top three reasons supporting it.`;
}

/* ─── Helpers ─── */

function memKey(symbol: string): string {
  return `ipo_analysis_${symbol.toUpperCase()}`;
}

/** Best-effort extraction of the closing "Investment Verdict" block. */
export function extractVerdict(content: string): string {
  const idx = content.lastIndexOf("Investment Verdict");
  if (idx === -1) return content.trim().slice(-600);
  const after = content.slice(idx + "Investment Verdict".length).trim();
  return after || content.trim().slice(-600);
}

/** Best-effort extraction of the final recommendation wording (A/B/C/D). */
export function extractRecommendation(content: string): string {
  const options = [
    "SELL 100% ON LISTING DAY",
    "SELL 50% AND HOLD 50%",
    "HOLD FOR 1-3 YEARS",
    "STRONG LONG-TERM HOLD (3-5+ YEARS)",
  ];
  const upper = content.toUpperCase();
  const found = options.find((o) => upper.includes(o));
  if (found) return found;
  // Fallback: last "A) / B) / C) / D)" letter followed by text
  const match = content.match(/[A-D]\)\s*([^\n]{2,80})/g);
  return match && match.length > 0 ? match[match.length - 1] : "";
}

/** Locate the IPO issue row for a symbol (source-agnostic; cheap cache hit). */
async function findIssue(symbol: string): Promise<IpoIssue | undefined> {
  const { data } = await getUpcomingIpoIssues();
  const upper = symbol.toUpperCase();
  return data.find((i) => i.symbol.toUpperCase() === upper);
}

function toAnalysis(data: unknown): IpoAnalysis | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.symbol !== "string" || typeof d.content !== "string") return null;
  return {
    symbol: d.symbol,
    companyName: typeof d.companyName === "string" ? d.companyName : d.symbol,
    content: d.content,
    verdict: typeof d.verdict === "string" ? d.verdict : "",
    recommendation: typeof d.recommendation === "string" ? d.recommendation : "",
    generatedAt: typeof d.generatedAt === "string" ? d.generatedAt : new Date().toISOString(),
    // Legacy rows (cached pre-v2) have no report — that's fine, the client
    // falls back to rendering `content` as markdown.
    report: d.report && typeof d.report === "object" ? (d.report as IpoReport) : null,
  };
}

/* ─── Service ─── */

/**
 * Run (or reuse) the 14-step AI analysis for one IPO symbol.
 *
 * Semantics:
 *  - memory hit (fresh)            → source "cache"
 *  - DB row fresh (≤12h)           → source "cache" (memory repopulated)
 *  - no fresh row                  → generate via OpenRouter, persist DB +
 *                                    memory, source "ai"
 *  - generation throws but a stale
 *    DB row exists                 → source "db" (degraded, logged)
 *  - generation throws, no row     → rethrows (caller → 502)
 *
 * forceRefresh skips the memory + fresh-DB check and regenerates (the stale
 * row still becomes the fallback if the new call fails).
 */
export async function getIpoAnalysis(
  symbol: string,
  options: { forceRefresh?: boolean } = {}
): Promise<IpoAnalysisResult> {
  const upper = symbol.toUpperCase();
  const key = memKey(upper);
  const force = options.forceRefresh === true;

  // 1) Memory front layer.
  if (!force) {
    const mem = cache.get<IpoAnalysis>(key);
    if (mem && mem.symbol === upper) {
      logger.debug({ msg: "IPO analysis: memory cache hit", symbol: upper });
      // v3.14.1: make cache hits visible in AI monitoring so the admin
      // dashboard always shows IPO analysis activity (not just fresh gens).
      trackAiCall({
        timestamp: new Date().toISOString(),
        action: "ipo_analysis_served",
        model: "cache",
        status: "success",
        tokensUsed: 0,
        responseTimeMs: 0,
        analysisType: "ipo",
      }).catch(() => undefined);
      return { ...mem, source: "cache", cachedAt: mem.generatedAt };
    }
  }

  // 2) Persisted row — fresh enough to reuse?
  let dbRow:
    | { data: unknown; lastSyncedAt: Date | null; generatedAt: string }
    | undefined;
  try {
    const row = await prisma.marketCache.findUnique({ where: { cacheKey: key } });
    if (row) {
      const generatedAt = (row.data as Record<string, unknown> | null)?.generatedAt as
        | string
        | undefined;
      dbRow = {
        data: row.data,
        lastSyncedAt: row.lastSyncedAt,
        generatedAt: generatedAt ?? row.lastSyncedAt?.toISOString() ?? "",
      };
    }
  } catch (err) {
    logger.warn({
      msg: "IPO analysis: DB read failed",
      symbol: upper,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const fresh =
    dbRow &&
    dbRow.lastSyncedAt &&
    Date.now() - dbRow.lastSyncedAt.getTime() < IPO_ANALYSIS_CACHE_TTL_SECONDS * 1000;

  if (!force && fresh && dbRow) {
    const analysis = toAnalysis(dbRow.data);
    if (analysis) {
      logger.debug({ msg: "IPO analysis: DB cache hit", symbol: upper });
      createAuditLog({
        action: "IPO_ANALYSIS_SERVED_CACHE",
        resource: "ipo_analysis",
        resourceId: upper,
        path: `/api/recommendations/ipos/${upper}/analysis`,
        responseStatus: 200,
        metadata: { symbol: upper, source: "cache" },
      }).catch(() => undefined);
      // v3.14.1: make cache hits visible in AI monitoring.
      trackAiCall({
        timestamp: new Date().toISOString(),
        action: "ipo_analysis_served",
        model: "cache",
        status: "success",
        tokensUsed: 0,
        responseTimeMs: 0,
        analysisType: "ipo",
      }).catch(() => undefined);
      const out: IpoAnalysisResult = {
        ...analysis,
        source: "cache",
        cachedAt: dbRow.generatedAt,
      };
      cache.set(key, out, IPO_ANALYSIS_CACHE_TTL_SECONDS);
      return out;
    }
  }

  // 3) Generate.
  const config = await loadConfig();
  if (!hasValidConfig(config)) {
    throw new Error("AI is not configured. Admin must set OPENROUTERKEY and enable AI.");
  }

  let content: string | undefined;
  let issue: IpoIssue | undefined;
  let report: IpoReport | null | undefined;
  const genStart = Date.now();
  try {
    issue = await findIssue(upper);
    if (!issue) {
      throw new Error(`IPO issue not found for symbol ${upper}`);
    }

    const analysisConfig: AIConfig = { ...config, maxTokens: IPO_ANALYSIS_MAX_TOKENS };
    const issueInput: import("@/lib/services/ipoReport").IpoPromptInput = {
      companyName: issue.companyName,
      symbol: issue.symbol,
      priceRange: issue.issuePrice || issue.priceBand || "Not yet announced",
      minimumInvestment: minimumInvestmentLabel(issue),
      issueStartDate: issue.issueStartDate,
      issueEndDate: issue.issueEndDate,
    };
    const prompt = buildIpoReportPrompt(issueInput);

    // Model fallback chain (v3.10.1): primary first, then the shared fallback
    // routes — a dead primary model must not fail the whole IPO analysis
    // (degraded mode then serves a stale row). Each model gets one attempt,
    // capped by getPromptTimeoutMs like the batch agents.
    // 429/402 early-exit: quota exhausted → stop immediately (no fallback).
    for (const model of modelFallbackChain(analysisConfig.model)) {
      const modelConfig =
        model === analysisConfig.model ? analysisConfig : { ...analysisConfig, model };
      let attempt: string;
      try {
        attempt = await directPrompt(prompt, modelConfig, getPromptTimeoutMs());
      } catch (e) {
        logger.warn({
          msg: "IPO analysis model attempt threw",
          model,
          error: e instanceof Error ? e.message : String(e),
        });
        continue;
      }
      // 429/402: quota exhausted — stop all fallback models immediately
      if (isQuotaExhausted(attempt)) {
        logger.warn({
          msg: "IPO analysis: quota exhausted, stopping fallback chain",
          model,
          preview: (attempt ?? "").slice(0, 200),
        });
        throw new Error(QUOTA_EXHAUSTED_MESSAGE);
      }
      if (
        !attempt ||
        attempt.startsWith("AI is not configured") ||
        attempt.startsWith("AI request failed")
      ) {
        logger.warn({
          msg: "IPO analysis model attempt failed",
          model,
          preview: (attempt ?? "").slice(0, 200),
        });
        continue; // try next model
      }
      content = attempt;
      break;
    }
    if (!content) {
      throw new Error("AI analysis failed — all models returned errors");
    }

    // v2: parse the structured JSON report. On failure we still render the
    // markdown content (legacy fallback) rather than surfacing a 502.
    try {
      const parsed = parseIpoReportJson(content);
      report = parsed ? normalizeReport(parsed) : null;
    } catch {
      report = null;
    }

    // Observability — makes the IPO analysis call visible in Admin AI monitoring.
    await trackAiCall({
      timestamp: new Date().toISOString(),
      action: "ipo_analysis",
      model: config?.model || "unknown",
      status: "success",
      tokensUsed: 0, // directPrompt does not expose token counts
      responseTimeMs: Date.now() - genStart,
      analysisType: "ipo",
      prompt: prompt.slice(0, 500),
      result: content.slice(0, 1000),
    });
  } catch (err) {
    // Observability — record the failed generation attempt.
    try {
      await trackAiCall({
        timestamp: new Date().toISOString(),
        action: "ipo_analysis",
        model: config?.model || "unknown",
        status: "error",
        tokensUsed: 0,
        responseTimeMs: Date.now() - genStart,
        analysisType: "ipo",
        error: err instanceof Error ? err.message : String(err),
      });
    } catch {
      // monitoring must never mask the real error
    }

    // Degraded mode: generation failed but a persisted (stale) row exists —
    // serve it rather than a 502 so the user still gets something.
    if (dbRow) {
      const analysis = toAnalysis(dbRow.data);
      if (analysis) {
        logger.warn({
          msg: "IPO analysis: AI call failed, serving stale row",
          symbol: upper,
          error: err instanceof Error ? err.message : String(err),
        });
        createAuditLog({
          action: "IPO_ANALYSIS_SERVED_STALE",
          resource: "ipo_analysis",
          resourceId: upper,
          path: `/api/recommendations/ipos/${upper}/analysis`,
          responseStatus: 200,
          metadata: { symbol: upper, error: err instanceof Error ? err.message : String(err) },
        }).catch(() => undefined);
        const out: IpoAnalysisResult = {
          ...analysis,
          source: "db",
          cachedAt: dbRow.generatedAt,
        };
        cache.set(key, out, IPO_ANALYSIS_CACHE_TTL_SECONDS);
        return out;
      }
    }

    // No stale row — surface the real error + audit the failure so admin
    // monitoring shows why IPO analysis keeps failing (provider, model,
    // timeout, …).
    const failMessage = err instanceof Error ? err.message : String(err);
    createAuditLog({
      action: "IPO_ANALYSIS_FAILED",
      resource: "ipo_analysis",
      resourceId: upper,
      path: `/api/recommendations/ipos/${upper}/analysis`,
      responseStatus: 502,
      errorMessage: failMessage,
      metadata: { symbol: upper, model: config?.model ?? "unknown" },
    }).catch(() => undefined);
    throw err;
  }

  // Control only reaches here when the try completed (the catch re-throws).
  // TS resets narrowing for variables assigned inside loops — re-assert.
  if (!content) {
    throw new Error("AI analysis failed — please try again.");
  }

  // Derive verdict/recommendation from the structured report when present,
  // else fall back to the legacy markdown extractors (pre-v2 rows).
  const recommendation = report?.verdict ? report.verdict.label : extractRecommendation(content);
  const verdict = report
    ? [
        report.verdict.headline,
        ...(report.verdict.reasons ?? []).map((r) => `• ${r}`),
      ].join("\n")
    : extractVerdict(content);

  const analysis: IpoAnalysis = {
    symbol: upper,
    companyName: issue.companyName || upper,
    content,
    verdict,
    recommendation,
    generatedAt: new Date().toISOString(),
    report: report ?? null,
  };

  // 4) Persist + short-circuit the next 12h of duplicate calls.
  try {
    const syncedAt = new Date();
    await prisma.marketCache.upsert({
      where: { cacheKey: key },
      create: {
        cacheKey: key,
        dataType: IPO_ANALYSIS_DATATYPE,
        data: analysis as unknown as object,
        recordCount: 1,
        lastSyncedAt: syncedAt,
        nextSyncAt: new Date(syncedAt.getTime() + IPO_ANALYSIS_CACHE_TTL_SECONDS * 1000),
        marketStatus: "closed",
        syncStatus: "idle",
        syncError: null,
      },
      update: {
        data: analysis as unknown as object,
        lastSyncedAt: syncedAt,
        nextSyncAt: new Date(syncedAt.getTime() + IPO_ANALYSIS_CACHE_TTL_SECONDS * 1000),
        syncStatus: "idle",
        syncError: null,
      },
    });
    logger.info({ msg: "IPO analysis generated + cached", symbol: upper, model: config.model });
    createAuditLog({
      action: "IPO_ANALYSIS_GENERATED",
      resource: "ipo_analysis",
      resourceId: upper,
      path: `/api/recommendations/ipos/${upper}/analysis`,
      responseStatus: 200,
      responseTime: Date.now() - genStart,
      metadata: { symbol: upper, model: config.model, source: "ai" },
    }).catch(() => undefined);
  } catch (err) {
    logger.warn({
      msg: "IPO analysis: DB persist failed",
      symbol: upper,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const result: IpoAnalysisResult = { ...analysis, source: "ai", cachedAt: null };
  cache.set(key, result, IPO_ANALYSIS_CACHE_TTL_SECONDS);
  return result;
}

/* ─── TTL Cleanup ─── */

/** Default retention: 90 days — IPO analysis has long-term value. */
const IPO_ANALYSIS_RETENTION_DAYS = 90;

/**
 * Delete stale IPO analysis rows from MarketCache.
 * Rows with `dataType = "ipo_analysis"` and `lastSyncedAt` older than
 * `retentionDays` are hard-deleted.  Returns the count of deleted rows.
 *
 * Non-fatal on DB errors — returns 0 and logs a warning.
 */
export async function cleanStaleIpoAnalysisRows(
  retentionDays: number = IPO_ANALYSIS_RETENTION_DAYS
): Promise<number> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    const { count } = await prisma.marketCache.deleteMany({
      where: {
        dataType: IPO_ANALYSIS_DATATYPE,
        lastSyncedAt: { lt: cutoff },
      },
    });

    if (count > 0) {
      logger.info({
        msg: "Stale IPO analysis rows cleaned",
        deleted: count,
        retentionDays,
        cutoff: cutoff.toISOString(),
      });
    }

    return count;
  } catch (err) {
    logger.warn({
      msg: "IPO analysis cleanup failed (non-fatal)",
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}