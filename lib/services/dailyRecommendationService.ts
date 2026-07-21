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

import { runDailyScreeners, type ScreenerResult } from "./chartinkService";
import {
  analyzeStocks,
  type StockAnalysisInput,
  type StockAnalysisResult,
} from "./ai/recommendation-agent";
import { getAICircuitBreaker, CircuitBreakerError } from "./ai/circuit-breaker";
import { getRecommendationMetrics } from "./ai/performance-monitor";
import { recordPrediction } from "./ai/prediction-tracker";
import {
  recordScreenerEvent,
  recordAIEvent,
} from "./unifiedEventService";
import { recordMetric } from "./systemHealthService";
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

/** Result of the performance check cron job. */
export interface PerformanceCheckResult {
  checked: number;
  targetAchieved: number;
  stopLossHit: number;
  expired: number;
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

/** Days after which an active recommendation expires. */
const EXPIRY_DAYS = 30;

/** Number of screeners in the daily pipeline. */
const TOTAL_SCREENER_COUNT = 7;

/** Maximum unique stocks to send through AI analysis per run. */
const MAX_AI_STOCKS = 100;

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
 */
export async function runDailyRecommendations(): Promise<DailyRunResult> {
  const startTime = Date.now();
  const todayMidnight = getTodayMidnight();

  logger.info({ msg: "Daily recommendation run starting" });

  // 1. Create run record
  const run = await prisma.dailyRecommendationRun.create({
    data: {
      status: "running",
      runDate: new Date(),
    },
  });

  try {
    // 2. Record start event
    await recordScreenerEvent(
      "run_start",
      `Daily recommendation run started [${run.id}]`,
      { runId: run.id },
    );

    // Audit: screener run started
    await createAuditLog({
      action: "SCREENER_RUN_START",
      resource: "daily_recommendation",
      resourceId: run.id,
      metadata: { runId: run.id, triggerSource: "cron_or_admin" },
    });

    // 3. Run all screeners
    const screenerResults = await runDailyScreeners({ forceRefresh: true });

    // 4. Compute screener stats
    const successfulScreenerNames = new Set(
      screenerResults.flatMap((s) => s.screenerNames),
    );
    const totalRawHits = screenerResults.reduce(
      (sum, s) => sum + s.screenerCount,
      0,
    );

    // 5 & 6. Batch upsert trackers and create stock entries
    // Instead of N individual upserts+creates, we batch:
    // 1 findMany for existing trackers, then batch create/update
    const stockEntries: StockAnalysisInput[] = [];
    const BATCH_SIZE = 100;

    // Pre-fetch existing trackers in one query
    const symbols = screenerResults.map(r => r.symbol);
    const existingTrackers = await prisma.recommendationTracker.findMany({
      where: { symbol: { in: symbols } },
      select: { id: true, symbol: true, status: true },
    });
    const trackerMap = new Map(existingTrackers.map(t => [t.symbol, t]));

    // Batch create new trackers
    const newTrackerData = screenerResults
      .filter(r => !trackerMap.has(r.symbol))
      .map(r => ({
        symbol: r.symbol,
        entryPrice: r.price,
        currentPrice: r.price,
        status: "active",
        timeHorizon: "medium" as const,
        screenerAttribution: r.screenerNames,
        screenerCount: r.screenerCount,
        firstSeenAt: todayMidnight,
        lastSeenAt: todayMidnight,
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

    // Update existing tracker in batch
    const existingToUpdate = screenerResults
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
      await prisma.$transaction(existingToUpdate.slice(0, 50)); // Transaction limit safety
    }

    // Batch create stock entries
    const stockCreateData = screenerResults.map(r => {
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
    for (const result of screenerResults) {
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
        uniqueStocks: screenerResults.length,
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

    try {
      const aiStart = Date.now();
      aiResults = await circuitBreaker.call(() => analyzeStocks(aiInput));
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
      await recordPrediction({
        agentType: "recommendation",
        symbol: aiResult.symbol,
        prediction: aiResult.aiRecommendation.recommendation,
        confidence: aiResult.aiRecommendation.confidence,
        entryPrice: aiResult.price,
        targetPrice: aiResult.aiRecommendation.targetPrice,
        stopLoss: aiResult.aiRecommendation.stopLoss,
        runId: run.id,
      });

      if (aiResult.success) {
        aiProcessed++;
      } else {
        aiFailed++;
      }
    }

    // Execute batched updates concurrently
    await Promise.all([...stockUpdates, ...trackerUpdates]);

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
        uniqueStocks: screenerResults.length,
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
        uniqueStocks: screenerResults.length,
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
        uniqueStocks: screenerResults.length,
        aiProcessed,
        aiFailed,
      },
    });

    // Invalidate cache so next API request gets fresh data
    invalidateRecommendationsCache();

    // Broadcast to Telegram subscribers will be wired in Phase 6

    logger.info({
      msg: "Daily recommendation run finished",
      runId: run.id,
      uniqueStocks: screenerResults.length,
      aiProcessed,
      aiFailed,
      executionTimeMs,
    });

    return {
      runId: run.id,
      totalScreeners: TOTAL_SCREENER_COUNT,
      successfulScreeners: successfulScreenerNames.size,
      totalStocks: totalRawHits,
      uniqueStocks: screenerResults.length,
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
 * Check all active recommendations against current market prices.
 *
 * Called by the cron job at 3:30 PM IST daily.
 *
 * For each active {@link RecommendationTracker}:
 * 1. Fetch current price from daily_prices
 * 2. Check if targetPrice or stopLoss has been hit
 * 3. Check if the recommendation has expired (30+ days)
 * 4. If status changed, update tracker and create RecommendationStatusHistory
 * 5. Record events for status changes
 */
export async function checkRecommendationPerformance(): Promise<PerformanceCheckResult> {
  const startTime = Date.now();

  logger.info({ msg: "Performance check starting" });

  // Batch fetch all active trackers and their latest prices in one query each
  // Instead of N individual price queries, we do 1 query with DISTINCT ON
  const activeTrackers = await prisma.recommendationTracker.findMany({
    where: { status: "active" },
  });

  if (activeTrackers.length === 0) {
    return { checked: 0, targetAchieved: 0, stopLossHit: 0, expired: 0, executionTimeMs: 0 };
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
  let expired = 0;

  // Batch status updates and history creation
  const statusUpdates: Promise<any>[] = [];
  const historyCreates: Promise<any>[] = [];

  for (const tracker of activeTrackers) {
    checked++;

    const currentPrice = priceMap.get(tracker.symbol);
    if (currentPrice === undefined) {
      logger.warn({ msg: "No price data found for tracker symbol", symbol: tracker.symbol, trackerId: tracker.id });
      continue;
    }

    let newStatus: string | null = null;

    // Check conditions in priority order
    if (currentPrice >= tracker.targetPrice) {
      newStatus = "target_achieved";
      targetAchieved++;
    } else if (currentPrice <= tracker.stopLoss) {
      newStatus = "stop_loss_hit";
      stopLossHit++;
    } else {
      const daysSinceCreation = Math.floor(
        (Date.now() - tracker.createdAt.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysSinceCreation >= EXPIRY_DAYS) {
        newStatus = "expired";
        expired++;
      }
    }

    if (newStatus) {
      const previousStatus = tracker.status;

      // Batch update tracker
      statusUpdates.push(
        prisma.recommendationTracker.update({
          where: { id: tracker.id },
          data: { status: newStatus, currentPrice, lastCheckedAt: new Date() },
        })
      );

      // Batch create status history
      historyCreates.push(
        prisma.recommendationStatusHistory.create({
          data: {
            trackerId: tracker.id,
            previousStatus,
            newStatus,
            triggerSource: "cron_check",
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
      const emoji = newStatus === "target_achieved" ? "TARGET" : newStatus === "stop_loss_hit" ? "STOP_LOSS" : "EXPIRED";
      await recordAIEvent("status_change", `[${emoji}] ${tracker.symbol}: ${previousStatus} -> ${newStatus} at price ${currentPrice}`, {
        symbol: tracker.symbol, currentPrice, previousStatus, newStatus,
        entryPrice: tracker.entryPrice, targetPrice: tracker.targetPrice, stopLoss: tracker.stopLoss,
      });

      logger.info({ msg: "Recommendation status changed", symbol: tracker.symbol, previousStatus, newStatus, currentPrice });
    }
  }

  // Execute batched updates
  await Promise.all([...statusUpdates, ...historyCreates]);

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
      expired,
    },
  });

  logger.info({
    msg: "Performance check completed",
    checked,
    targetAchieved,
    stopLossHit,
    expired,
    executionMs,
  });

  return { checked, targetAchieved, stopLossHit, expired, executionTimeMs: executionMs };
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

  // 1. Try latest completed run first
  let latestRun = await prisma.dailyRecommendationRun.findFirst({
    where: { status: { in: ["completed", "failed"] }, uniqueStocks: { gt: 0 } },
    orderBy: { runDate: "desc" },
    include: {
      stocks: {
        orderBy: { screenerCount: "desc" },
        include: { tracker: true },
      },
    },
  });

  // 2. Fallback: any run that has stocks
  if (!latestRun || !latestRun.stocks || latestRun.stocks.length === 0) {
    latestRun = await prisma.dailyRecommendationRun.findFirst({
      where: { uniqueStocks: { gt: 0 } },
      orderBy: { runDate: "desc" },
      include: {
        stocks: {
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
