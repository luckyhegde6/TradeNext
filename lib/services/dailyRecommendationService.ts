/**
 * Daily Recommendations Engine — Main orchestration service.
 *
 * Ties together the screener pipeline, AI analysis agent, circuit breaker,
 * performance monitoring, prediction tracking, and audit logging into a
 * single end-to-end daily recommendation flow.
 *
 * @module dailyRecommendationService
 * @version 3.3.0
 */

import { runChartinkUnifiedScreeners } from "./chartinkUnifiedScreenerService";
import type { ScreenerResult } from "./chartinkService";
import {
  analyzeStocks,
  type StockAnalysisInput,
  type StockAnalysisResult,
} from "./ai/recommendation-agent";
import { loadConfig } from "./ai/config";
import { getRecommendationContext } from "./ai/recommendation-context";
import { getAICircuitBreaker, CircuitBreakerError } from "./ai/circuit-breaker";
import { getRecommendationMetrics } from "./ai/performance-monitor";
import { recordPrediction } from "./ai/prediction-tracker";
import {
  recordScreenerEvent,
  recordAIEvent,
  recordSystemEvent,
} from "./unifiedEventService";
import { recordMetric } from "./systemHealthService";
import { archiveRecommendations } from "./recommendationPerformanceService";
import { createAuditLog } from "@/lib/audit";
import { recommendationsCache } from "@/lib/cache";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

// ─── Types ───────────────────────────────────────────────────────────────

/** Summary returned after a daily recommendation run completes. */
export interface DailyRunResult {
  runId: string;
  totalScreeners: number;
  successfulScreeners: number;
  totalStocks: number;
  uniqueStocks: number;
  aiProcessed: number;
  aiFailed: number;
  executionTimeMs: number;
  stocks: { symbol: string; aiRecommendation: string; confidence: number }[];
}

/**
 * Result of the performance check cron job.
 *
 * Lifecycle (v3.5.0): tracking → target_achieved / stop_loss_hit → archived.
 * There is NO 30-day expiry anymore; target/SL hits are flags, not deletion
 * triggers. Aged trackers (≥ ARCHIVE_AFTER_DAYS) are snapshotted to
 * RecommendationArchive and hard-deleted inside this same run.
 */
export interface PerformanceCheckResult {
  checked: number;
  targetAchieved: number;
  stopLossHit: number;
  archived: number;
  executionTimeMs: number;
}

/** The latest run with its stocks. */
export interface LatestRecommendations {
  run: RunWithStocks | null;
  stocks: StockWithTracker[];
}

/** Prisma DailyRecommendationRun with nested stocks. */
type RunWithStocks = Awaited<
  ReturnType<typeof prisma.dailyRecommendationRun.findFirst>
> & {
  stocks: StockWithTracker[];
};

/** Prisma DailyRecommendationStock with nested tracker. */
type StockWithTracker = Awaited<
  ReturnType<typeof prisma.dailyRecommendationStock.findFirst>
> & {
  tracker: Awaited<
    ReturnType<typeof prisma.recommendationTracker.findFirst>
  >;
};

// ─── Constants ───────────────────────────────────────────────────────────

/** Default target price multiplier (10% above entry). */
const DEFAULT_TARGET_MULTIPLIER = 1.1;

/** Default stop loss multiplier (5% below entry). */
const DEFAULT_STOP_LOSS_MULTIPLIER = 0.95;

/** Number of screeners in the daily pipeline. */
const TOTAL_SCREENER_COUNT = 7;

/**
 * Maximum unique stocks kept for a daily run.
 *
 * The screeners can flag 600+ symbols; we rank by a composite score
 * (screener agreement → market cap → momentum) and keep only the top
 * MAX_RECOMMENDED_STOCKS to keep AI cost/time bounded and the feed clean.
 */
const MAX_RECOMMENDED_STOCKS = 50;

/**
 * Maximum unique stocks to send through AI analysis per run.
 * Mirrors MAX_RECOMMENDED_STOCKS — after ranking we never exceed this.
 */
const MAX_AI_STOCKS = 50;

// ─── Main Orchestration ─────────────────────────────────────────────────

/**
 * Run the full daily recommendation pipeline.
 *
 * Steps:
 * 1. Create a {@link DailyRecommendationRun} record (status: running)
 * 2. Record start event via unifiedEventService
 * 3. Run all 7 screeners via chartinkService
 * 4. Deduplicate results by symbol
 * 5. For each unique stock, upsert RecommendationTracker
 * 6. Create DailyRecommendationStock entries
 * 7. Analyze stocks via AI (with circuit breaker protection)
 * 8. Update DailyRecommendationStock with AI results
 * 9. Update RecommendationTracker with latest AI analysis
 * 10. Record prediction for tracking
 * 11. Record completion event + metrics
 * 12. Return run summary
 *
 * @param options.triggeredBy Source of this run: "system" (cron/scheduler) or "admin" (manual Run Now). Defaults to "system".
 */
export async function runDailyRecommendations(options: { triggeredBy?: string } = {}): Promise<DailyRunResult> {
  const startTime = Date.now();
  const todayMidnight = getTodayMidnight();
  const triggeredBy = options.triggeredBy ?? "system";

  logger.info({ msg: "Daily recommendation run starting", triggeredBy });

  // 1. Create run record
  const run = await prisma.dailyRecommendationRun.create({
    data: {
      status: "running",
      runDate: new Date(),
      triggeredBy,
    },
  });

  try {
    // 2. Record start event
    await recordScreenerEvent(
      "run_start",
      `Daily recommendation run started [${run.id}]`,
      { runId: run.id, triggeredBy },
    );

    // Audit: screener run started
    await createAuditLog({
      action: "SCREENER_RUN_START",
      resource: "daily_recommendation",
      resourceId: run.id,
      metadata: { runId: run.id, triggerSource: triggeredBy },
    });

    // 3. Run all screeners (Chartink 117 registry primary → TradingView fallback)
    const screenerResults = await runChartinkUnifiedScreeners({ forceRefresh: true });

    // 4. Compute screener stats (from the FULL result set, before capping)
    const successfulScreenerNames = new Set(
      screenerResults.flatMap((s) => s.screenerNames),
    );
    const totalRawHits = screenerResults.reduce(
      (sum, s) => sum + (s.screenerCount || 0),
      0,
    );

    // 5. Rank by composite score (screener agreement → market cap → momentum)
    //    and cap to the top MAX_RECOMMENDED_STOCKS so AI cost/time stays bounded.
    const rankedResults = rankAndCapRecommendations(screenerResults);

    // 6 & 7. Batch upsert trackers and create stock entries
    // Instead of N individual upserts+creates, we batch:
    // 1 findMany for existing trackers, then batch create/update
    const stockEntries: StockAnalysisInput[] = [];
    const BATCH_SIZE = 100;

    // Pre-fetch existing trackers in one query
    const symbols = rankedResults.map(r => r.symbol);
    const existingTrackers = await prisma.recommendationTracker.findMany({
      where: { symbol: { in: symbols } },
      select: { id: true, symbol: true, status: true },
    });
    const trackerMap = new Map(existingTrackers.map(t => [t.symbol, t]));

    // Batch create new trackers
    const newTrackerData = rankedResults
      .filter(r => !trackerMap.has(r.symbol))
      .map(r => ({
        symbol: r.symbol,
        entryPrice: r.price,
        currentPrice: r.price,
        status: "active",
        timeHorizon: "medium" as const,
        screenerAttribution: r.screenerNames,
        targetPrice: r.price * 1.2, // Default 20% target
        stopLoss: r.price * 0.95, // Default 5% stop loss
        confidence: 0,
        aiRecommendation: "HOLD" as const,
      }));

    if (newTrackerData.length > 0) {
      for (let i = 0; i < newTrackerData.length; i += BATCH_SIZE) {
        const batch = newTrackerData.slice(i, i + BATCH_SIZE);
        await prisma.recommendationTracker.createMany({ data: batch, skipDuplicates: true });
      }
      // Re-fetch to get IDs for new trackers
      const refreshed = await prisma.recommendationTracker.findMany({
        where: { symbol: { in: symbols } },
        select: { id: true, symbol: true, status: true },
      });
      refreshed.forEach(t => trackerMap.set(t.symbol, t));
    }

    // Update existing trackers in batch.
    // NOTE: We intentionally do NOT wrap these in an interactive $transaction.
    // On production (Prisma Accelerate) the 5s default interactive transaction
    // timeout was exceeded because each updateMany round-trips to the remote DB.
    // Each updateMany is atomic on its own, so we run them in small concurrent
    // chunks instead (bounded concurrency, no transaction timeout risk).
    const existingToUpdate = rankedResults
      .filter(r => trackerMap.has(r.symbol))
      .map(r =>
        prisma.recommendationTracker.updateMany({
          where: { symbol: r.symbol, status: "active" },
          data: {
            currentPrice: r.price,
            screenerAttribution: r.screenerNames,
            lastCheckedAt: new Date(),
          },
        })
      );
    if (existingToUpdate.length > 0) {
      await runInChunks(existingToUpdate, 10, (updates) => Promise.all(updates));
    }

    // Batch create stock entries
    const stockCreateData = rankedResults.map(r => {
      const tracker = trackerMap.get(r.symbol);
      if (!tracker) return null;
      return {
        runId: run.id,
        trackerId: tracker.id,
        symbol: r.symbol,
        price: r.price,
        change: r.change,
        changePercent: r.changePercent,
        volume: BigInt(Math.round(r.volume)),
        screenerAttribution: r.screenerNames,
        screenerCount: r.screenerCount,
      };
    }).filter((d): d is NonNullable<typeof d> => d !== null);

    for (let i = 0; i < stockCreateData.length; i += BATCH_SIZE) {
      const batch = stockCreateData.slice(i, i + BATCH_SIZE);
      await prisma.dailyRecommendationStock.createMany({ data: batch });
    }

    // Build stockEntries for AI analysis
    for (const result of rankedResults) {
      stockEntries.push({
        symbol: result.symbol,
        price: result.price,
        change: result.change,
        changePercent: result.changePercent,
        volume: result.volume,
        screenerNames: result.screenerNames,
      });
    }

    // Update run with screener stats
    await prisma.dailyRecommendationRun.update({
      where: { id: run.id },
      data: {
        totalScreeners: TOTAL_SCREENER_COUNT,
        successfulScreeners: successfulScreenerNames.size,
        totalStocks: totalRawHits,
        uniqueStocks: rankedResults.length,
      },
    });

    // 7. AI Analysis with circuit breaker protection
    // Cap at MAX_AI_STOCKS to avoid overwhelming the AI provider
    const aiInput = stockEntries.slice(0, MAX_AI_STOCKS);
    const cappedCount = stockEntries.length - aiInput.length;
    if (cappedCount > 0) {
      logger.info({
        msg: "Capped stocks for AI analysis",
        total: stockEntries.length,
        processing: aiInput.length,
        skipped: cappedCount,
      });
    }

    // Enrich each stock's AI input with fundamental context (corp actions,
    // announcements, quarterly results) — batched once per run, best-effort:
    // a context failure drops the context, never the pipeline.
    const stockContextMap = await getRecommendationContext(
      aiInput.map((s) => s.symbol),
    );
    for (const entry of aiInput) {
      const ctx = stockContextMap[entry.symbol];
      if (ctx) entry.context = ctx;
    }
    const enrichedCount = Object.keys(stockContextMap).length;
    if (enrichedCount > 0) {
      logger.info({
        msg: "AI context enriched",
        enriched: enrichedCount,
        total: aiInput.length,
      });
    }

    // Audit: AI agent trigger
    await createAuditLog({
      action: "AI_AGENT_TRIGGER",
      resource: "recommendation_agent",
      resourceId: run.id,
      metadata: {
        runId: run.id,
        stocksToAnalyze: aiInput.length,
        totalStocks: stockEntries.length,
        triggerSource: "daily_recommendation_pipeline",
      },
    });

    const circuitBreaker = getAICircuitBreaker();
    let aiResults: StockAnalysisResult[] = [];

    // Resolve the effective AI config (DB `ai_config` Secret > env) so the admin's
    // saved model selection actually reaches the recommendation pipeline. Without
    // this, the pipeline fell back to the env-only default model and every run
    // defaulted to HOLD when that model 404'd on OpenRouter.
    const aiConfig = await loadConfig();

    try {
      const aiStart = Date.now();
      aiResults = await circuitBreaker.call(() => analyzeStocks(aiInput, aiConfig));
      const aiMs = Date.now() - aiStart;

      // Record AI performance metrics
      const metrics = getRecommendationMetrics();
      for (const result of aiResults) {
        metrics.record({
          success: result.success,
          responseTimeMs: result.executionMs,
          tokensUsed: result.tokensUsed,
        });
      }

      logger.info({
        msg: "AI analysis completed",
        total: aiResults.length,
        succeeded: aiResults.filter((r) => r.success).length,
        aiMs,
      });
    } catch (e) {
      const isCircuitOpen = e instanceof CircuitBreakerError;
      logger.warn({
        msg: isCircuitOpen
          ? "AI analysis blocked by circuit breaker"
          : "AI analysis failed, using defaults",
        error: e instanceof Error ? e.message : String(e),
      });

      // Record failure in performance monitor
      const metrics = getRecommendationMetrics();
      metrics.record({
        success: false,
        responseTimeMs: Date.now() - startTime,
        tokensUsed: 0,
      });

      // Fall back to default HOLD recommendations
      aiResults = aiInput.map((s) => ({
        ...s,
        aiRecommendation: {
          recommendation: "HOLD" as const,
          confidence: 50,
          targetPrice: s.price * DEFAULT_TARGET_MULTIPLIER,
          stopLoss: s.price * DEFAULT_STOP_LOSS_MULTIPLIER,
          timeHorizon: "medium" as const,
          reasoning: isCircuitOpen
            ? "AI circuit breaker open — defaulting to HOLD"
            : "AI analysis failed — defaulting to HOLD",
          riskFactors: ["AI analysis unavailable"],
        },
        tokensUsed: 0,
        executionMs: 0,
        success: false,
        error: isCircuitOpen
          ? "Circuit breaker open"
          : e instanceof Error
            ? e.message
            : String(e),
      }));
    }

    // 8 & 9 & 10. Batch update stock entries, trackers, and record predictions
    let aiProcessed = 0;
    let aiFailed = 0;

    // Pre-fetch all stock entries for this run in one query (instead of N findFirst)
    const allStockEntries = await prisma.dailyRecommendationStock.findMany({
      where: { runId: run.id },
      select: { id: true, symbol: true },
    });
    const stockEntryMap = new Map(allStockEntries.map(e => [e.symbol, e.id]));

    // Batch update stock entries and trackers concurrently
    const stockUpdates: Promise<any>[] = [];
    const trackerUpdates: Promise<any>[] = [];
    const predictionUpdates: Promise<unknown>[] = [];

    for (const aiResult of aiResults) {
      const stockEntryId = stockEntryMap.get(aiResult.symbol);
      if (!stockEntryId) {
        aiFailed++;
        continue;
      }

      // 8. Update DailyRecommendationStock with AI results
      stockUpdates.push(
        prisma.dailyRecommendationStock.update({
          where: { id: stockEntryId },
          data: {
            aiRecommendation: aiResult.aiRecommendation.recommendation,
            confidence: aiResult.aiRecommendation.confidence,
            targetPrice: aiResult.aiRecommendation.targetPrice,
            stopLoss: aiResult.aiRecommendation.stopLoss,
            timeHorizon: aiResult.aiRecommendation.timeHorizon,
            reasoning: aiResult.aiRecommendation.reasoning,
            riskFactors: aiResult.aiRecommendation.riskFactors,
            aiTokensUsed: aiResult.tokensUsed,
            aiExecutionMs: aiResult.executionMs,
            aiSuccess: aiResult.success,
            aiError: aiResult.error ?? null,
          },
        })
      );

      // 9. Update RecommendationTracker with latest AI analysis
      trackerUpdates.push(
        prisma.recommendationTracker.updateMany({
          where: { symbol: aiResult.symbol, status: "active" },
          data: {
            aiRecommendation: aiResult.aiRecommendation.recommendation,
            confidence: aiResult.aiRecommendation.confidence,
            targetPrice: aiResult.aiRecommendation.targetPrice,
            stopLoss: aiResult.aiRecommendation.stopLoss,
            timeHorizon: aiResult.aiRecommendation.timeHorizon,
            reasoning: aiResult.aiRecommendation.reasoning,
            riskFactors: aiResult.aiRecommendation.riskFactors,
            currentPrice: aiResult.price,
          },
        })
      );

      // 10. Record prediction for outcome tracking
      predictionUpdates.push(
        recordPrediction({
          agentType: "recommendation",
          symbol: aiResult.symbol,
          prediction: aiResult.aiRecommendation.recommendation,
          confidence: aiResult.aiRecommendation.confidence,
          entryPrice: aiResult.price,
          targetPrice: aiResult.aiRecommendation.targetPrice,
          stopLoss: aiResult.aiRecommendation.stopLoss,
          runId: run.id,
        }).catch((e) => {
          // Non-critical — prediction tracking must never break the run
          logger.warn({
            msg: "Prediction tracking failed",
            symbol: aiResult.symbol,
            error: e instanceof Error ? e.message : String(e),
          });
        }),
      );

      if (aiResult.success) {
        aiProcessed++;
      } else {
        aiFailed++;
      }
    }

    // Execute batched updates concurrently (chunked to bound concurrency)
    await runInChunks(
      [...stockUpdates, ...trackerUpdates, ...predictionUpdates],
      10,
      (chunk) => Promise.all(chunk),
    );

    // 11. Complete run
    const executionTimeMs = Date.now() - startTime;

    await prisma.dailyRecommendationRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        aiProcessed,
        aiFailed,
        executionTimeMs,
        completedAt: new Date(),
        metadata: {
          screenerNames: Array.from(successfulScreenerNames),
          totalRawHits,
        },
      },
    });

    // Record completion event
    await recordScreenerEvent(
      "run_complete",
      `Daily run completed: ${aiProcessed}/${stockEntries.length} stocks analyzed in ${executionTimeMs}ms`,
      {
        runId: run.id,
        uniqueStocks: rankedResults.length,
        aiProcessed,
        aiFailed,
        executionTimeMs,
      },
    );

    // Audit: run completed
    await createAuditLog({
      action: "SCREENER_RUN_COMPLETE",
      resource: "daily_recommendation",
      resourceId: run.id,
      metadata: {
        runId: run.id,
        uniqueStocks: rankedResults.length,
        aiProcessed,
        aiFailed,
        executionTimeMs,
      },
    });

    // Record health metrics
    await recordMetric({
      metricType: "screener_duration",
      metricName: "daily_recommendation_run",
      value: executionTimeMs,
      unit: "ms",
      source: "recommendation_service",
      metadata: {
        runId: run.id,
        uniqueStocks: rankedResults.length,
        aiProcessed,
        aiFailed,
      },
    });

    // Invalidate cache so next API request gets fresh data
    invalidateRecommendationsCache();

    // Broadcast to Telegram subscribers.
    // Suggestions = actionable picks only (BUY/SELL). HOLDs are never listed
    // as suggestions — an all-HOLD day sends a short notice instead (see
    // buildRecommendationBroadcast in recommendationBroadcast.ts).
    try {
      const { broadcastToSubscribers } = await import("./telegramBotService");
      const { buildRecommendationBroadcast } = await import("./recommendationBroadcast");

      const tgMessage = buildRecommendationBroadcast(aiResults);

      const sent = await broadcastToSubscribers("📈 Daily Recommendations", tgMessage);
      logger.info({ msg: "Telegram broadcast for recommendations", sent });
    } catch (tgErr) {
      // Non-critical: log but don't fail the run
      logger.warn({ msg: "Telegram broadcast failed (non-critical)", error: tgErr });
    }

    logger.info({
      msg: "Daily recommendation run finished",
      runId: run.id,
      uniqueStocks: rankedResults.length,
      aiProcessed,
      aiFailed,
      executionTimeMs,
    });

    return {
      runId: run.id,
      totalScreeners: TOTAL_SCREENER_COUNT,
      successfulScreeners: successfulScreenerNames.size,
      totalStocks: totalRawHits,
      uniqueStocks: rankedResults.length,
      aiProcessed,
      aiFailed,
      executionTimeMs,
      stocks: aiResults.map((r) => ({
        symbol: r.symbol,
        aiRecommendation: r.aiRecommendation.recommendation,
        confidence: r.aiRecommendation.confidence,
      })),
    };
  } catch (error) {
    // Mark run as failed
    const executionTimeMs = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    await prisma.dailyRecommendationRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        errorMessage,
        executionTimeMs,
        completedAt: new Date(),
      },
    });

    await recordScreenerEvent(
      "run_failed",
      `Daily run failed after ${executionTimeMs}ms: ${errorMessage}`,
      { runId: run.id, error: errorMessage },
    );

    // Audit: run failed
    await createAuditLog({
      action: "SCREENER_RUN_FAILED",
      resource: "daily_recommendation",
      resourceId: run.id,
      errorMessage,
      metadata: { runId: run.id, executionTimeMs, error: errorMessage },
    });

    await recordMetric({
      metricType: "screener_duration",
      metricName: "daily_recommendation_run",
      value: executionTimeMs,
      unit: "ms",
      source: "recommendation_service",
      metadata: { runId: run.id, error: errorMessage },
    });

    logger.error({
      msg: "Daily recommendation run failed",
      runId: run.id,
      executionTimeMs,
      error: errorMessage,
    });

    throw error;
  }
}

// ─── Performance Tracking ────────────────────────────────────────────────

/**
 * Check all tracking recommendations against current market prices.
 *
 * Called by the SYSTEM cron job at 4:00 PM IST Mon–Fri (worker task with
 * `triggeredBy: "system"`).
 *
 * For each {@link RecommendationTracker} in `tracking`:
 * 1. Fetch current price from daily_prices (single batch query)
 * 2. Update currentPrice + lastCheckedAt for EVERY tracker (keeps the
 *    Performance tab's return % fresh even when status is unchanged)
 * 3. If targetPrice hit → `target_achieved`; if stopLoss hit → `stop_loss_hit`
 * 4. Status changes are recorded in RecommendationStatusHistory with
 *    `triggerSource: "system"`
 * 5. At the end, run the 360-day archival sweep and invalidate all caches
 *
 * v3.5.0: removed the 30-day expiry path (EXPIRY_DAYS). Trackers stay in
 * `tracking` indefinitely until they hit target/SL or age past 360 days.
 */
export async function checkRecommendationPerformance(): Promise<PerformanceCheckResult> {
  const startTime = Date.now();

  logger.info({ msg: "Performance check starting" });

  // Batch fetch all tracking trackers and their latest prices in one query each
  // Instead of N individual price queries, we do 1 query with DISTINCT ON
  const activeTrackers = await prisma.recommendationTracker.findMany({
    where: { status: "tracking" },
  });

  if (activeTrackers.length === 0) {
    // Still run the archival sweep — aged trackers of ANY status need cleanup.
    const archive = await archiveRecommendations();
    // Run-level audit parity with the main path (design §3/§8)
    await Promise.allSettled([
      createAuditLog({
        action: "RECOMMENDATION_PERFORMANCE_CHECK",
        resource: "recommendation-tracker",
        method: "SYSTEM",
        path: "system:checkRecommendationPerformance",
        responseStatus: 200,
        responseTime: 0,
        metadata: { checked: 0, targetAchieved: 0, stopLossHit: 0, archived: archive.archived },
      }),
      recordSystemEvent("performance_check", `Performance check completed: 0 tracked, ${archive.archived} archived`, "info", {
        checked: 0,
        targetAchieved: 0,
        stopLossHit: 0,
        archived: archive.archived,
      }).catch((e) => {
        logger.warn({ msg: "Performance check system event failed", error: e instanceof Error ? String(e) : String(e) });
      }),
    ]);
    return {
      checked: 0,
      targetAchieved: 0,
      stopLossHit: 0,
      archived: archive.archived,
      executionTimeMs: 0,
    };
  }

  // Get all unique symbols
  const trackerSymbols = activeTrackers.map(t => t.symbol);

  // Batch fetch latest prices for ALL trackers in ONE query
  const latestPrices = await prisma.$queryRaw<{ ticker: string; close: number | null }[]>`
    SELECT DISTINCT ON (ticker) ticker, close
    FROM daily_prices
    WHERE ticker = ANY(${trackerSymbols})
    ORDER BY ticker, "tradeDate" DESC
  `;

  // Build price lookup map
  const priceMap = new Map(latestPrices.filter(p => p.close !== null).map(p => [p.ticker, Number(p.close)]));

  let checked = 0;
  let targetAchieved = 0;
  let stopLossHit = 0;

  // Batch status updates and history creation
  const statusUpdates: Promise<any>[] = [];
  const historyCreates: Promise<any>[] = [];
  const eventLogs: Promise<unknown>[] = [];

  for (const tracker of activeTrackers) {
    checked++;

    const currentPrice = priceMap.get(tracker.symbol);
    if (currentPrice === undefined) {
      logger.warn({ msg: "No price data found for tracker symbol", symbol: tracker.symbol, trackerId: tracker.id });
      continue;
    }

    let newStatus: string | null = null;

    // Check target/SL conditions in priority order (target wins on tie).
    // Direction-aware since v3.6.3: for SELL recommendations the levels are
    // inverted (target below entry, stop above), so the price crossing check
    // must flip too. BUY/HOLD: price >= target → achieved; price <= stop → hit.
    // SELL: price <= target → achieved; price >= stop → hit.
    const isSell = tracker.aiRecommendation === "SELL";
    const targetReached = isSell
      ? currentPrice <= tracker.targetPrice
      : currentPrice >= tracker.targetPrice;
    const stopReached = isSell
      ? currentPrice >= tracker.stopLoss
      : currentPrice <= tracker.stopLoss;

    if (targetReached) {
      newStatus = "target_achieved";
      targetAchieved++;
    } else if (stopReached) {
      newStatus = "stop_loss_hit";
      stopLossHit++;
    }

    // Update currentPrice + lastCheckedAt for EVERY tracker — the Performance
    // tab computes return % from currentPrice, so even unchanged trackers must
    // get the freshest close. (There is no stored changePercent column.)
    statusUpdates.push(
      prisma.recommendationTracker.update({
        where: { id: tracker.id },
        data: {
          ...(newStatus ? { status: newStatus } : {}),
          currentPrice,
          lastCheckedAt: new Date(),
        },
      })
    );

    if (newStatus) {
      const previousStatus = tracker.status;

      // Batch create status history (triggerSource: system)
      historyCreates.push(
        prisma.recommendationStatusHistory.create({
          data: {
            trackerId: tracker.id,
            previousStatus,
            newStatus,
            triggerSource: "system",
            metadata: {
              currentPrice,
              entryPrice: tracker.entryPrice,
              targetPrice: tracker.targetPrice,
              stopLoss: tracker.stopLoss,
              daysSinceCreation: Math.floor(
                (Date.now() - tracker.createdAt.getTime()) / (1000 * 60 * 60 * 24),
              ),
            },
          },
        })
      );

      // Record event
      const emoji = newStatus === "target_achieved" ? "TARGET" : "STOP_LOSS";
      eventLogs.push(
        recordAIEvent("status_change", `[${emoji}] ${tracker.symbol}: ${previousStatus} -> ${newStatus} at price ${currentPrice}`, {
          symbol: tracker.symbol, currentPrice, previousStatus, newStatus,
          entryPrice: tracker.entryPrice, targetPrice: tracker.targetPrice, stopLoss: tracker.stopLoss,
        }).catch((e) => {
          logger.warn({
            msg: "Status change event logging failed",
            symbol: tracker.symbol,
            error: e instanceof Error ? e.message : String(e),
          });
        }),
      );

      logger.info({ msg: "Recommendation status changed", symbol: tracker.symbol, previousStatus, newStatus, currentPrice });
    }
  }

  // Execute batched updates concurrently (chunked to bound concurrency)
  await runInChunks(
    [...statusUpdates, ...historyCreates, ...eventLogs],
    10,
    (chunk) => Promise.all(chunk),
  );

  // Run the 360-day archival sweep (any status) — snapshots + hard-deletes
  // aged trackers. Idempotent; safe to run every day.
  const archive = await archiveRecommendations();

  // Invalidate the recommendations cache so the web UI and Telegram
  // /recommendations commands reflect updated prices/statuses immediately
  // (otherwise they serve the stale snapshot for up to 23 hours).
  invalidateRecommendationsCache();

  const executionMs = Date.now() - startTime;

  // Record health metric
  await recordMetric({
    metricType: "ai_response_time",
    metricName: "performance_check",
    value: executionMs,
    unit: "ms",
    source: "recommendation_service",
    metadata: {
      checked,
      targetAchieved,
      stopLossHit,
      archived: archive.archived,
    },
  });

  // Run-level audit + unified event (design §3/§8): one RECOMMENDATION_PERFORMANCE_CHECK
  // entry per run so monitoring tabs show the sweep ran even with zero status changes.
  const runMeta = {
    checked,
    targetAchieved,
    stopLossHit,
    archived: archive.archived,
    executionMs,
  };
  await Promise.allSettled([
    createAuditLog({
      action: "RECOMMENDATION_PERFORMANCE_CHECK",
      resource: "recommendation-tracker",
      method: "SYSTEM",
      path: "system:checkRecommendationPerformance",
      responseStatus: 200,
      responseTime: executionMs,
      metadata: runMeta,
    }),
    recordSystemEvent(
      "performance_check",
      `Performance check completed: ${checked} tracked, ${targetAchieved} target, ${stopLossHit} stop-loss, ${archive.archived} archived`,
      "info",
      runMeta,
    ).catch((e) => {
      logger.warn({
        msg: "Performance check system event failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }),
  ]);

  logger.info({
    msg: "Performance check completed",
    checked,
    targetAchieved,
    stopLossHit,
    archived: archive.archived,
    executionMs,
  });

  return {
    checked,
    targetAchieved,
    stopLossHit,
    archived: archive.archived,
    executionTimeMs: executionMs,
  };
}

// ─── Query Helpers ───────────────────────────────────────────────────────

/**
 * Get the latest recommendations for the UI (Today's Picks tab).
 *
 * Returns the most recent completed/failed run with stocks, sorted by screenerCount
 * (stronger signal = more screeners agree). Falls back to any run with stocks > 0
 * if no completed run exists.
 *
 * BigInt fields (volume) are converted to Number for JSON serialization.
 *
 * Results are cached for 23 hours. Call {@link invalidateRecommendationsCache}
 * after a new run completes to force a refresh.
 */
const LATEST_KEY = "recommendations:latest";

export async function getLatestRecommendations(): Promise<LatestRecommendations> {
  // Check cache first
  const cached = recommendationsCache.get<LatestRecommendations>(LATEST_KEY);
  if (cached) {
    logger.debug({ msg: "Latest recommendations served from cache" });
    return cached;
  }

  // Today's Picks shows actionable recommendations only (BUY/SELL).
  // HOLD (and null) stocks are filtered out at the source so the public API,
  // UI, and Telegram /recommendations all surface only BUY/SELL picks.
  // Runs with zero actionable stocks are skipped entirely (empty state).
  const actionable = { aiRecommendation: { in: ["BUY", "SELL"] } };

  // 1. Try latest completed run that has actionable stocks
  let latestRun = await prisma.dailyRecommendationRun.findFirst({
    where: {
      status: { in: ["completed", "failed"] },
      uniqueStocks: { gt: 0 },
      stocks: { some: actionable },
    },
    orderBy: { runDate: "desc" },
    include: {
      stocks: {
        where: actionable,
        orderBy: { screenerCount: "desc" },
        include: { tracker: true },
      },
    },
  });

  // 2. Fallback: any run that has actionable stocks
  if (!latestRun || !latestRun.stocks || latestRun.stocks.length === 0) {
    latestRun = await prisma.dailyRecommendationRun.findFirst({
      where: {
        uniqueStocks: { gt: 0 },
        stocks: { some: actionable },
      },
      orderBy: { runDate: "desc" },
      include: {
        stocks: {
          where: actionable,
          orderBy: { screenerCount: "desc" },
          include: { tracker: true },
        },
      },
    });
  }

  // Convert BigInt fields to Number for JSON serialization
  const serializedStocks = (latestRun?.stocks ?? []).map((s) => ({
    ...s,
    volume: s.volume != null ? Number(s.volume) : null,
  }));

  const result: LatestRecommendations = {
    run: latestRun as RunWithStocks | null,
    stocks: serializedStocks as unknown as StockWithTracker[],
  };

  // Store in cache (23hr TTL)
  if (result.run) {
    recommendationsCache.set(LATEST_KEY, result);
    logger.debug({ msg: "Latest recommendations cached", stockCount: result.stocks.length });
  }

  return result;
}

/**
 * Get historical recommendation runs with pagination.
 * Includes individual stocks per run for the History tab.
 * BigInt fields (volume) are converted to Number for JSON serialization.
 *
 * Results are cached. Call {@link invalidateRecommendationsCache} after a
 * new run completes to force a refresh.
 *
 * @param options.limit   Max runs to return (default 30)
 * @param options.offset  Skip N runs (default 0)
 */
function historyCacheKey(limit: number, offset: number) {
  return `recommendations:history:${limit}:${offset}`;
}

export async function getRecommendationHistory(options: {
  limit?: number;
  offset?: number;
} = {}): Promise<
  Awaited<ReturnType<typeof prisma.dailyRecommendationRun.findMany>>
> {
  const limit = options.limit ?? 30;
  const offset = options.offset ?? 0;
  const key = historyCacheKey(limit, offset);

  const cached = recommendationsCache.get(key);
  if (cached) {
    logger.debug({ msg: "Recommendation history served from cache", key });
    return cached as Awaited<ReturnType<typeof prisma.dailyRecommendationRun.findMany>>;
  }

  const runs = await prisma.dailyRecommendationRun.findMany({
    orderBy: { runDate: "desc" },
    take: limit,
    skip: offset,
    include: {
      stocks: {
        orderBy: { screenerCount: "desc" },
      },
    },
  });

  // Convert BigInt fields to Number for JSON serialization
  const result = runs.map((run) => ({
    ...run,
    stocks: run.stocks.map((s) => ({
      ...s,
      volume: s.volume != null ? Number(s.volume) : null,
    })),
  })) as typeof runs;

  // Cache (shorter TTL — 6hr for history since it's updated less frequently)
  recommendationsCache.set(key, result, 21600);

  return result;
}

/**
 * Invalidate the recommendations cache.
 * Call this after a new daily run completes so the next API request
 * fetches fresh data from the database.
 */
export function invalidateRecommendationsCache(): void {
  recommendationsCache.flushAll();
  logger.info({ msg: "Recommendations cache invalidated" });
}

/**
 * Get detailed recommendation history for a specific stock.
 *
 * Includes the long-lived tracker, all per-run stock entries, and
 * status change history.
 *
 * @param symbol  NSE stock symbol (e.g. "RELIANCE")
 */
export async function getStockRecommendationDetail(symbol: string): Promise<{
  tracker: Awaited<ReturnType<typeof prisma.recommendationTracker.findFirst>>;
  history: Awaited<
    ReturnType<typeof prisma.dailyRecommendationStock.findMany>
  >;
}> {
  const normalizedSymbol = symbol.toUpperCase();

  const tracker = await prisma.recommendationTracker.findFirst({
    where: { symbol: normalizedSymbol },
    orderBy: { createdAt: "desc" },
    include: {
      dailyStocks: {
        orderBy: { createdAt: "desc" },
        take: 30,
      },
      statusHistory: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  return {
    tracker,
    history: tracker?.dailyStocks ?? [],
  };
}

// ─── Internal Helpers ────────────────────────────────────────────────────

/**
 * Upsert a RecommendationTracker for a stock found by screeners.
 *
 * Uses the unique constraint [symbol, createdAt] to avoid duplicates
 * within the same day. If a tracker already exists for today, updates
 * its price and screener attribution.
 */
async function upsertTracker(
  result: ScreenerResult,
  todayMidnight: Date,
): Promise<{ id: string; entryPrice: number }> {
  try {
    // Try to find an existing tracker for today
    const existing = await prisma.recommendationTracker.findFirst({
      where: {
        symbol: result.symbol,
        createdAt: { gte: todayMidnight },
      },
    });

    if (existing) {
      // Update existing tracker for today
      return prisma.recommendationTracker.update({
        where: { id: existing.id },
        data: {
          currentPrice: result.price,
          screenerAttribution: result.screenerNames,
        },
        select: { id: true, entryPrice: true },
      });
    }

    // Create new tracker
    return prisma.recommendationTracker.create({
      data: {
        symbol: result.symbol,
        entryPrice: result.price,
        currentPrice: result.price,
        targetPrice: Math.round(result.price * DEFAULT_TARGET_MULTIPLIER * 100) / 100,
        stopLoss: Math.round(result.price * DEFAULT_STOP_LOSS_MULTIPLIER * 100) / 100,
        timeHorizon: "medium",
        confidence: Math.min(50 + result.screenerCount * 10, 100),
        aiRecommendation: "HOLD",
        screenerAttribution: result.screenerNames,
      },
      select: { id: true, entryPrice: true },
    });
  } catch (e) {
    // Handle race condition: if create fails due to unique constraint,
    // try to find and return the existing record
    logger.warn({
      msg: "Tracker upsert failed, retrying lookup",
      symbol: result.symbol,
      error: e instanceof Error ? e.message : String(e),
    });

    const fallback = await prisma.recommendationTracker.findFirst({
      where: {
        symbol: result.symbol,
        createdAt: { gte: todayMidnight },
      },
    });

    if (fallback) {
      return { id: fallback.id, entryPrice: fallback.entryPrice };
    }

    throw e;
  }
}

/**
 * Get midnight UTC for today (start of day for date-based queries).
 */
function getTodayMidnight(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
}

/**
 * Rank screener results by a composite score and cap to the top
 * {@link MAX_RECOMMENDED_STOCKS}.
 *
 * Score is weighted:
 * - **Screener agreement** (primary): more screeners flagging a stock is a
 *   stronger signal → `screenerCount * 10`.
 * - **Market cap** (secondary): prefer liquid, established names so the feed
 *   stays actionable → banded `0..3` (₹100Cr+, ₹1,000Cr+, ₹10,000Cr+).
 * - **Momentum** (tertiary): positive `changePercent` for bullish screeners →
 *   normalized `0..1` from a clamped [-5, +5] band.
 *
 * Ties break by screenerCount. Stocks without market cap data are not
 * penalized (marketCapScore 0 but still ranked by agreement + momentum).
 *
 * @param results Full de-duplicated screener results (can be 600+).
 * @returns Top {@link MAX_RECOMMENDED_STOCKS} entries by composite score.
 */
function rankAndCapRecommendations(
  results: ScreenerResult[],
): ScreenerResult[] {
  if (results.length <= MAX_RECOMMENDED_STOCKS) {
    return results;
  }

  const scored = results.map((r) => {
    const marketCap = r.marketCap ?? 0;
    // Market cap bands in ₹ crore (1 Cr = 10,000,000)
    const marketCapScore =
      marketCap >= 100_000_000_000
        ? 3 // ≥ ₹10,000 Cr (large cap)
        : marketCap >= 10_000_000_000
          ? 2 // ≥ ₹1,000 Cr (mid/large cap)
          : marketCap >= 1_000_000_000
            ? 1 // ≥ ₹100 Cr (small/mid cap)
            : 0;
    // Clamp changePercent to [-5, 5] then normalize to [0, 1]
    const momentumScore = Math.max(
      0,
      Math.min(1, (r.changePercent + 5) / 10),
    );
    return {
      result: r,
      score: r.screenerCount * 10 + marketCapScore * 2 + momentumScore,
    };
  });

  scored.sort(
    (a, b) => b.score - a.score || b.result.screenerCount - a.result.screenerCount,
  );

  const ranked = scored.map((s) => s.result);
  const kept = ranked.slice(0, MAX_RECOMMENDED_STOCKS);

  logger.info({
    msg: "Capped daily recommendations to top MAX_RECOMMENDED_STOCKS",
    total: ranked.length,
    kept: kept.length,
    dropped: ranked.length - kept.length,
  });

  return kept;
}

/**
 * Run async operations in bounded-concurrency chunks.
 *
 * Splits `items` into chunks of at most `chunkSize` and awaits each chunk
 * sequentially. This replaces interactive $transaction() blocks for batches
 * of independent writes — each write stays atomic, concurrency is bounded
 * (so we don't overwhelm the DB / Prisma Accelerate), and there is no
 * interactive-transaction timeout to exceed.
 *
 * @param items The operations to run (as Promises or thunks).
 * @param chunkSize Max number of operations to run concurrently.
 * @param executor Optional per-chunk executor (defaults to Promise.all).
 */
async function runInChunks<T>(
  items: T[],
  chunkSize: number,
  executor: (chunk: T[]) => Promise<unknown> = (chunk) => Promise.all(chunk),
): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    await executor(chunk);
  }
}
