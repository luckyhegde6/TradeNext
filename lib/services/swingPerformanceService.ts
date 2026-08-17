// lib/services/swingPerformanceService.ts
// Swing signal performance tracking (v3.14.0):
//   - Each SwingSignal row is created when the swing analysis job is created
//     (= "date of posting" — the screener snapshot + AI levels as-of posting).
//   - checkSwingPerformance() runs alongside the daily recommendation_performance
//     cron (15:30 IST) plus an admin button. It batch-fetches the latest close
//     from daily_prices (DISTINCT ON), bridges missing symbols with live quotes
//     (mirroring checkRecommendationPerformance's v3.12.0 fallback), refreshes
//     currentPrice/returnPercent, and flips status:
//       active → target_achieved  (price crossed the AI target — direction-aware)
//       active → stop_loss_hit    (price crossed the stop — direction-aware)
//       active → expired          (45 days since posting with no hit — user decision)
//   - Signals WITHOUT AI levels (no target/stop) can only expire.
//   - Status transitions are audit-logged (SWING_SIGNAL_STATUS_CHANGED) and the
//     run itself records one SWING_PERFORMANCE_CHECK entry (design parity with
//     checkRecommendationPerformance §3/§8).

import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { createAuditLog } from "@/lib/audit";
import { recordSystemEvent } from "./unifiedEventService";
import { recordMetric } from "./systemHealthService";

// ---------------------------------------------------------------------------
// Constants & types
// ---------------------------------------------------------------------------

/** No-hit expiry window (user decision): 45 days from posting. */
export const SWING_EXPIRY_DAYS = 45;

export type SwingSignalStatus = "active" | "target_achieved" | "stop_loss_hit" | "expired";

export interface SwingPerformanceCheckResult {
  checked: number;
  targetAchieved: number;
  stopLossHit: number;
  expired: number;
  updated: number; // rows written (checked signals with a price)
  executionTimeMs: number;
}

// ---------------------------------------------------------------------------
// Pure status evaluator (exported for tests)
// ---------------------------------------------------------------------------

export interface SwingSignalStatusInput {
  /** Tracker vocabulary — "BUY" | "SELL" | "HOLD" (derived from the AI action). */
  aiRecommendation?: string | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  currentPrice: number;
  /** Days since the signal was posted (job creation). */
  postedDaysAgo: number;
  /** Overridable expiry window (default SWING_EXPIRY_DAYS). */
  expiryDays?: number;
}

export interface SwingSignalStatusEvaluation {
  status: SwingSignalStatus;
  reason: string;
}

/**
 * Decide the next status for ONE swing signal. Direction-aware: a SELL signal's
 * target sits BELOW the posting price and its stop ABOVE — the crossing
 * comparisons invert (mirrors the daily-tracker convention since v3.6.3).
 * Priority: target wins on a tie, then stop, then expiry as fallback. Signals
 * without levels can only expire.
 */
export function evaluateSwingSignalStatus(
  input: SwingSignalStatusInput,
): SwingSignalStatusEvaluation {
  const { aiRecommendation, currentPrice, postedDaysAgo } = input;
  const expiryDays = input.expiryDays ?? SWING_EXPIRY_DAYS;

  const target = typeof input.targetPrice === "number" && input.targetPrice > 0 ? input.targetPrice : null;
  const stop = typeof input.stopLoss === "number" && input.stopLoss > 0 ? input.stopLoss : null;

  let targetReached = false;
  let stopReached = false;
  if (target !== null && stop !== null) {
    const isSell = aiRecommendation === "SELL";
    targetReached = isSell ? currentPrice <= target : currentPrice >= target;
    stopReached = isSell ? currentPrice >= stop : currentPrice <= stop;
  }

  if (targetReached) {
    return {
      status: "target_achieved",
      reason: `Price ${currentPrice} crossed target ${target}`,
    };
  }
  if (stopReached) {
    return {
      status: "stop_loss_hit",
      reason: `Price ${currentPrice} crossed stop ${stop}`,
    };
  }
  if (postedDaysAgo >= expiryDays) {
    return {
      status: "expired",
      reason: `No target/stop hit within ${expiryDays} days (posted ${postedDaysAgo}d ago)`,
    };
  }
  return { status: "active", reason: "Still within target window" };
}

// ---------------------------------------------------------------------------
// Bounded concurrency (mirrors dailyRecommendationService / perf service)
// ---------------------------------------------------------------------------

async function runInChunks<T>(
  items: T[],
  chunkSize: number,
  fn: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    await fn(chunk);
  }
}

// ---------------------------------------------------------------------------
// Swing performance check
// ---------------------------------------------------------------------------

/**
 * Check every ACTIVE swing signal against the latest price and flip statuses.
 * Mirrors checkRecommendationPerformance: ONE batch DISTINCT ON query for all
 * latest closes, a capped live-quote bridge for symbols missing daily_prices
 * rows (v3.12.0 parity), per-signal updates with bounded concurrency, and a
 * single run-level audit + system event + metric. Data-level failures are
 * contained (missing prices skip, quote failures log) and callers wrap the
 * whole call in try/catch (cron hook + admin button) so the daily
 * recommendation_performance run is never blocked.
 */
export async function checkSwingPerformance(): Promise<SwingPerformanceCheckResult> {
  const startTime = Date.now();
  logger.info({ msg: "Swing performance check starting" });

  const active = await prisma.swingSignal.findMany({
    where: { status: "active" },
  });

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  if (active.length === 0) {
    // Run-level audit parity with the main path.
    await Promise.allSettled([
      createAuditLog({
        action: "SWING_PERFORMANCE_CHECK",
        resource: "swing_signal",
        method: "SYSTEM",
        path: "system:checkSwingPerformance",
        responseStatus: 200,
        responseTime: 0,
        metadata: { checked: 0, targetAchieved: 0, stopLossHit: 0, expired: 0, updated: 0 },
      }),
      recordSystemEvent(
        "swing_performance_check",
        "Swing performance check completed: 0 active signals",
        "info",
        { checked: 0, targetAchieved: 0, stopLossHit: 0, expired: 0, updated: 0 },
      ).catch((e) => {
        logger.warn({
          msg: "Swing performance check system event failed",
          error: e instanceof Error ? e.message : String(e),
        });
      }),
    ]);
    return { checked: 0, targetAchieved: 0, stopLossHit: 0, expired: 0, updated: 0, executionTimeMs: 0 };
  }

  const symbols = active.map((s) => s.symbol);

  // Batch fetch latest closes for ALL signals in ONE query.
  const latestPrices = await prisma.$queryRaw<{ ticker: string; close: number | null }[]>`
    SELECT DISTINCT ON (ticker) ticker, close
    FROM daily_prices
    WHERE ticker = ANY(${symbols})
    ORDER BY ticker, "tradeDate" DESC
  `;
  const priceMap = new Map(
    latestPrices.filter((p) => p.close !== null).map((p) => [p.ticker, Number(p.close)]),
  );

  // Live-quote bridge for symbols with no daily_prices rows (v3.12.0 parity —
  // prod had 130 tracking trackers but only 8 with price rows). Capped +
  // chunked + never throws.
  const MAX_LIVE_FALLBACK_SYMBOLS = 50;
  const missingSymbols = [...new Set(symbols.filter((s) => !priceMap.has(s)))].slice(
    0,
    MAX_LIVE_FALLBACK_SYMBOLS,
  );
  if (missingSymbols.length > 0) {
    try {
      const { getStockQuote } = await import("@/lib/stock-service");
      const bridged: { symbol: string; price: number }[] = [];
      for (let i = 0; i < missingSymbols.length; i += 10) {
        const chunk = missingSymbols.slice(i, i + 10);
        const settled = await Promise.allSettled(
          chunk.map(async (symbol) => {
            const quote = await getStockQuote(symbol, false);
            const price = quote?.lastPrice ?? quote?.closePrice;
            return { symbol, price: typeof price === "number" && price > 0 ? price : null };
          }),
        );
        for (const r of settled) {
          if (r.status === "fulfilled" && r.value.price != null) {
            bridged.push({ symbol: r.value.symbol, price: r.value.price });
          }
        }
      }
      let added = 0;
      for (const row of bridged) {
        if (!priceMap.has(row.symbol)) {
          priceMap.set(row.symbol, row.price);
          added++;
        }
      }
      logger.info({ msg: "Swing perf check: live-price fallback", missing: missingSymbols.length, bridged: added });
    } catch (error) {
      logger.warn({
        msg: "Swing perf check: live-price fallback failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let checked = 0;
  let targetAchieved = 0;
  let stopLossHit = 0;
  let expired = 0;

  const updates: Promise<unknown>[] = [];
  const auditLogs: Promise<unknown>[] = [];

  for (const signal of active) {
    const currentPrice = priceMap.get(signal.symbol);
    if (currentPrice === undefined) {
      logger.warn({ msg: "No price data found for swing signal", symbol: signal.symbol, signalId: signal.id });
      continue;
    }
    checked++;

    const postedDaysAgo = Math.max(0, Math.floor((now - signal.postedAt.getTime()) / dayMs));
    const evaluated = evaluateSwingSignalStatus({
      aiRecommendation: signal.aiRecommendation,
      targetPrice: signal.targetPrice,
      stopLoss: signal.stopLoss,
      currentPrice,
      postedDaysAgo,
    });

    const returnPercent = signal.price > 0 ? ((currentPrice - signal.price) / signal.price) * 100 : null;

    if (evaluated.status !== "active") {
      if (evaluated.status === "target_achieved") targetAchieved++;
      else if (evaluated.status === "stop_loss_hit") stopLossHit++;
      else expired++;

      auditLogs.push(
        createAuditLog({
          action: "SWING_SIGNAL_STATUS_CHANGED",
          resource: "swing_signal",
          resourceId: signal.id,
          method: "SYSTEM",
          path: "system:checkSwingPerformance",
          responseStatus: 200,
          metadata: {
            symbol: signal.symbol,
            jobId: signal.jobId,
            previousStatus: "active",
            newStatus: evaluated.status,
            currentPrice,
            postedDaysAgo,
            targetPrice: signal.targetPrice,
            stopLoss: signal.stopLoss,
            reason: evaluated.reason,
          },
        }).catch(() => undefined),
      );

      logger.info({
        msg: "Swing signal status changed",
        symbol: signal.symbol,
        previousStatus: "active",
        newStatus: evaluated.status,
        currentPrice,
        reason: evaluated.reason,
      });
    }

    // Refresh price + return for EVERY checked signal (status flips included).
    updates.push(
      prisma.swingSignal.update({
        where: { id: signal.id },
        data: {
          ...(evaluated.status !== "active" ? { status: evaluated.status } : {}),
          currentPrice,
          returnPercent,
          lastCheckedAt: new Date(),
        },
      }),
    );
  }

  await runInChunks(updates, 10, (chunk) => Promise.all(chunk));
  await Promise.allSettled(auditLogs);

  const executionMs = Date.now() - startTime;
  const runMeta = { checked, targetAchieved, stopLossHit, expired, updated: updates.length, executionMs };

  await Promise.allSettled([
    createAuditLog({
      action: "SWING_PERFORMANCE_CHECK",
      resource: "swing_signal",
      method: "SYSTEM",
      path: "system:checkSwingPerformance",
      responseStatus: 200,
      responseTime: executionMs,
      metadata: runMeta,
    }),
    recordSystemEvent(
      "swing_performance_check",
      `Swing performance check completed: ${checked} checked, ${targetAchieved} target, ${stopLossHit} stop, ${expired} expired`,
      "info",
      runMeta,
    ).catch((e) => {
      logger.warn({
        msg: "Swing performance check system event failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }),
    recordMetric({
      metricType: "ai_response_time",
      metricName: "swing_performance_check",
      value: executionMs,
      unit: "ms",
      source: "swing_performance",
      metadata: runMeta,
    }).catch((e) => {
      logger.warn({
        msg: "Swing performance check metric failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }),
  ]);

  logger.info({ msg: "Swing performance check completed", ...runMeta });
  return { checked, targetAchieved, stopLossHit, expired, updated: updates.length, executionTimeMs: executionMs };
}
