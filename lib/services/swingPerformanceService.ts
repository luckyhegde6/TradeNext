// lib/services/swingPerformanceService.ts
// Swing signal performance tracking (v3.14.0):
//   - Each SwingSignal row is created when the swing analysis job is created
//     (= "date of posting" — the screener snapshot + AI levels as-of posting).
//   - checkSwingPerformance() runs alongside the daily recommendation_performance
//     cron (15:30 IST) plus an admin button. It batch-fetches the latest close
//     from daily_prices (DISTINCT ON) AND each symbol's intraday HIGH/LOW window
//     since posting (touch semantics — a target/stop is hit when the price EVER
//     touched the level intraday, not only when the latest close crossed it),
//     bridges missing symbols with live quotes (mirroring
//     checkRecommendationPerformance's v3.12.0 fallback), refreshes
//     currentPrice/returnPercent, and flips status:
//       active → target_achieved  (price OR intraday range touched the AI target — direction-aware)
//       active → stop_loss_hit    (price OR intraday range touched the stop — direction-aware)
//       active → expired          (45 days since posting with no hit — user decision)
//   - Spec 43: bounded/idempotent prediction+mode backfill for eligible active/open
//     rows — missing targets/mode are generated/persisted so tracking is never blocked.
//   - Signals WITHOUT AI levels can now be backfilled to prediction targets (not only expire).
//   - Status transitions are audit-logged (SWING_SIGNAL_STATUS_CHANGED) and the
//     run itself records one SWING_PERFORMANCE_CHECK entry (design parity with
//     checkRecommendationPerformance §3/§8).

import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { createAuditLog } from "@/lib/audit";
import { recordSystemEvent } from "./unifiedEventService";
import { recordMetric } from "./systemHealthService";
import { isDbUnavailableError } from "@/lib/db-utils";
import { getSqliteFallback } from "@/lib/sqlite";
import {
  ANALYSIS_MODE_AI,
  ANALYSIS_MODE_PREDICTION,
  calculateFallbackSwingAnalysis,
} from "@/lib/services/ai/fallbackAnalysis";

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
  /**
   * Intraday HIGH since the signal was posted (excluding the latest close).
   * When provided, a target/stop is considered "touched" if the price EVER
   * crossed it intraday, not only if the latest close crossed it. Omit/null to
   * keep close-only behaviour.
   */
  maxHighSincePosting?: number | null;
  /** Intraday LOW since the signal was posted (see maxHighSincePosting). */
  minLowSincePosting?: number | null;
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
 * Touch semantics: when maxHighSincePosting/minLowSincePosting are provided,
 * a target/stop is hit as soon as the intraday range EVER touched it (the
 * signal is marked regardless of where the latest close sits) — this is what
 * caused BUY signals like PCJEWELLER (target ₹13.91, latest close ₹13.30) to
 * stay "Tracking" even though the intraday high had crossed the target.
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
  const maxHigh =
    typeof input.maxHighSincePosting === "number" && input.maxHighSincePosting > 0
      ? input.maxHighSincePosting
      : null;
  const minLow =
    typeof input.minLowSincePosting === "number" && input.minLowSincePosting > 0
      ? input.minLowSincePosting
      : null;

  let targetReached = false;
  let stopReached = false;
  if (target !== null && stop !== null) {
    const isSell = aiRecommendation === "SELL";
    targetReached = isSell
      ? currentPrice <= target || (minLow !== null && minLow <= target)
      : currentPrice >= target || (maxHigh !== null && maxHigh >= target);
    stopReached = isSell
      ? currentPrice >= stop || (maxHigh !== null && maxHigh >= stop)
      : currentPrice <= stop || (minLow !== null && minLow <= stop);

    if (targetReached) {
      const touched = isSell ? minLow : maxHigh;
      const reason =
        touched !== null && (isSell ? currentPrice > target : currentPrice < target)
          ? `Price touched target ${target} intraday (high/low ${touched}, close ${currentPrice})`
          : `Price ${currentPrice} crossed target ${target}`;
      return { status: "target_achieved", reason };
    }
    if (stopReached) {
      const touched = isSell ? maxHigh : minLow;
      const reason =
        touched !== null && (isSell ? currentPrice < stop : currentPrice > stop)
          ? `Price touched stop ${stop} intraday (high/low ${touched}, close ${currentPrice})`
          : `Price ${currentPrice} crossed stop ${stop}`;
      return { status: "stop_loss_hit", reason };
    }
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
 *
 * Spec 43: bounded/idempotent prediction+mode backfill for eligible active/open
 * rows — missing targets/mode are generated/persisted (no tracking blocked).
 */
export async function checkSwingPerformance(): Promise<SwingPerformanceCheckResult> {
  const startTime = Date.now();
  logger.info({ msg: "Swing performance check starting" });

  type ActiveSwingSignal = {
    id: string;
    symbol: string;
    postedAt: Date;
    status: string;
    jobId: string | null;
    aiRecommendation: string | null;
    targetPrice: number | null;
    stopLoss: number | null;
    price: number;
    analysisMode?: string | null;
    analysis?: unknown;
    reasoning?: string | null;
    riskFactors?: unknown;
    confidence?: number | null;
    entryPrice?: number | null;
  };

  let active: ActiveSwingSignal[];
  try {
    active = await prisma.swingSignal.findMany({
      where: { status: "active" },
      orderBy: { postedAt: "desc" },
      take: 500,
    });
  } catch (err) {
    if (isDbUnavailableError(err)) {
      logger.warn({
        msg: "Swing performance check: Accelerate unreachable, skipping — signals will be retried next cycle",
        error: err instanceof Error ? err.message : String(err),
      });
      return { checked: 0, targetAchieved: 0, stopLossHit: 0, expired: 0, updated: 0, executionTimeMs: Date.now() - startTime };
    }
    throw err;
  }

  // Spec 43: bounded/idempotent prediction+mode backfill before evaluation.
  const sqlite = getSqliteFallback();
  const PERF_BACKFILL_LIMIT = 200;
  let backfilled = 0;
  for (let i = 0; i < active.length && backfilled < PERF_BACKFILL_LIMIT; i++) {
    const s: any = active[i];
    const hasTargets = Number(s.targetPrice) > 0 && Number(s.stopLoss) > 0;
    const hasMode = typeof s.analysisMode === "string" && s.analysisMode.length > 0;
    const hasAnalysis = s.analysis != null || s.reasoning != null || s.aiRecommendation != null;
    if (hasTargets && hasMode) continue;

    try {
      let next: any = { ...s };
      // Legacy rows with targets/analysis but missing mode -> AI Targets.
      if (!hasMode && (hasTargets || hasAnalysis)) {
        next.analysisMode = ANALYSIS_MODE_AI;
      }
      // Missing targets -> generate deterministic prediction targets/mode.
      if (!hasTargets) {
        const indicators = (s.indicators as any) ?? {};
        const pred = calculateFallbackSwingAnalysis({
          symbol: s.symbol,
          price: Number(s.price ?? s.entryPrice ?? s.currentPrice ?? 0),
          changePercent: Number((s as any).changePercent ?? (s as any).change ?? 0),
          screenerNames: Array.isArray(s.screenerNames) ? s.screenerNames : [],
          families: Array.isArray(s.families) ? s.families : [],
          indicators: {
            momentum10: indicators.momentum10 ?? null,
            momentum20: indicators.momentum20 ?? null,
            volatility20: indicators.volatility20 ?? null,
            distanceFrom20dHigh: indicators.distanceFrom20dHigh ?? null,
          },
        } as any);
        next = {
          ...next,
          analysis: pred,
          analysisMode: ANALYSIS_MODE_PREDICTION,
          aiRecommendation:
            pred.action === "LONG" ? "BUY" : pred.action === "SHORT" ? "SELL" : "HOLD",
          confidence: pred.confidence,
          targetPrice: pred.targetPrice,
          stopLoss: pred.stopLoss,
          reasoning: next.reasoning ?? pred.logic,
          riskFactors: next.riskFactors ?? pred.riskFactors,
        };
      }
      if (!next.analysisMode) {
        next.analysisMode = hasTargets || hasAnalysis ? ANALYSIS_MODE_AI : ANALYSIS_MODE_PREDICTION;
      }

      active[i] = next as ActiveSwingSignal;
      backfilled++;

      // Persist to mirror (best-effort, idempotent).
      if (sqlite && s.jobId) {
        try {
          const rows = sqlite.getSwingSignals(String(s.jobId));
          const row = rows.find(
            (r) => String(r.symbol).toUpperCase() === String(s.symbol).toUpperCase(),
          );
          if (row) {
            sqlite.upsertSwingSignal({
              ...row,
              ...(next.analysis != null ? { analysis: next.analysis } : {}),
              aiRecommendation: next.aiRecommendation ?? row.aiRecommendation ?? null,
              confidence: next.confidence ?? row.confidence ?? null,
              targetPrice: next.targetPrice ?? row.targetPrice ?? null,
              stopLoss: next.stopLoss ?? row.stopLoss ?? null,
              analysisMode: next.analysisMode ?? row.analysisMode ?? null,
              updatedAt: new Date(),
            });
          }
        } catch (e) {
          logger.warn({
            msg: "Swing perf: mirror backfill failed (non-fatal)",
            symbol: s.symbol,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      // Persist to Prisma (best-effort, idempotent).
      try {
        await prisma.swingSignal.update({
          where: { id: s.id },
          data: {
            ...(next.analysis != null ? { analysis: next.analysis as any } : {}),
            aiRecommendation: next.aiRecommendation ?? undefined,
            confidence: next.confidence ?? undefined,
            targetPrice: next.targetPrice ?? undefined,
            stopLoss: next.stopLoss ?? undefined,
            analysisMode: next.analysisMode ?? undefined,
          },
        });
      } catch (e) {
        if (!isDbUnavailableError(e)) {
          logger.warn({
            msg: "Swing perf: Prisma backfill failed (non-fatal)",
            symbol: s.symbol,
            signalId: s.id,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    } catch (e) {
      logger.warn({
        msg: "Swing perf: prediction/mode backfill failed (non-fatal)",
        symbol: s.symbol,
        signalId: s.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

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
  let latestPrices: Array<{ ticker: string; close: number | null }> = [];
  try {
    latestPrices = await prisma.$queryRaw<{ ticker: string; close: number | null }[]>`
      SELECT DISTINCT ON (ticker) ticker, close
      FROM daily_prices
      WHERE ticker = ANY(${symbols})
      ORDER BY ticker, "tradeDate" DESC
    `;
  } catch (err) {
    if (isDbUnavailableError(err)) {
      logger.warn({
        msg: "Swing performance check: Accelerate unreachable for price query — using empty price map",
        error: err instanceof Error ? err.message : String(err),
      });
    } else {
      throw err;
    }
  }
  const priceMap = new Map(
    latestPrices.filter((p) => p.close !== null).map((p) => [p.ticker, Number(p.close)]),
  );

  // Touch semantics: fetch each symbol's intraday HIGH/LOW since the EARLIEST
  // signal posting, then compute per-signal windows in JS (a single global
  // MIN(tradeDate) cutoff would include bars posted BEFORE newer signals —
  // false positives). Signals without price rows (bridged live quotes below)
  // use the quote's day high/low instead.
  const minPostedAt = active.reduce(
    (min, s) => Math.min(min, s.postedAt.getTime()),
    active[0]?.postedAt.getTime() ?? Date.now(),
  );
  let windowBars: Array<{ ticker: string; tradeDate: Date; high: number | null; low: number | null }> = [];
  try {
    windowBars = await prisma.$queryRaw<
      { ticker: string; tradeDate: Date; high: number | null; low: number | null }[]
    >`
      SELECT ticker, "tradeDate", high, low
      FROM daily_prices
      WHERE ticker = ANY(${symbols}) AND "tradeDate" >= ${new Date(minPostedAt)}
      ORDER BY ticker, "tradeDate" ASC
    `;
  } catch (err) {
    if (isDbUnavailableError(err)) {
      logger.warn({
        msg: "Swing performance check: Accelerate unreachable for window query — using empty window map",
        error: err instanceof Error ? err.message : String(err),
      });
    } else {
      throw err;
    }
  }
  const windowByTicker = new Map<string, { tradeDate: Date; high: number; low: number }[]>();
  for (const row of windowBars) {
    if (!row.tradeDate) continue;
    const high = typeof row.high === "number" ? row.high : Number(row.high);
    const low = typeof row.low === "number" ? row.low : Number(row.low);
    if (!Number.isFinite(high) && !Number.isFinite(low)) continue;
    const list = windowByTicker.get(row.ticker) ?? [];
    list.push({ tradeDate: row.tradeDate, high: Number.isFinite(high) ? high : NaN, low: Number.isFinite(low) ? low : NaN });
    windowByTicker.set(row.ticker, list);
  }

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
      const bridged: { symbol: string; price: number; dayHigh: number | null; dayLow: number | null }[] = [];
      for (let i = 0; i < missingSymbols.length; i += 10) {
        const chunk = missingSymbols.slice(i, i + 10);
        const settled = await Promise.allSettled(
          chunk.map(async (symbol) => {
            const quote = await getStockQuote(symbol, false);
            const price = quote?.lastPrice ?? quote?.closePrice;
            const dayHigh = typeof quote?.dayHigh === "number" && quote.dayHigh > 0 ? Number(quote.dayHigh) : null;
            const dayLow = typeof quote?.dayLow === "number" && quote.dayLow > 0 ? Number(quote.dayLow) : null;
            return { symbol, price: typeof price === "number" && price > 0 ? price : null, dayHigh, dayLow };
          }),
        );
        for (const r of settled) {
          if (r.status === "fulfilled" && r.value.price != null) {
            bridged.push({ symbol: r.value.symbol, price: r.value.price, dayHigh: r.value.dayHigh, dayLow: r.value.dayLow });
          }
        }
      }
      let added = 0;
      for (const row of bridged) {
        if (!priceMap.has(row.symbol)) {
          priceMap.set(row.symbol, row.price);
          added++;
        }
        // Use the quote's day range for touch semantics when no daily_prices bars exist.
        if (!windowByTicker.has(row.symbol) && (row.dayHigh != null || row.dayLow != null)) {
          windowByTicker.set(row.symbol, [
            { tradeDate: new Date(), high: row.dayHigh ?? NaN, low: row.dayLow ?? NaN },
          ]);
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

    // Per-signal intraday window: only bars at/after THIS signal's posting.
    const bars = (windowByTicker.get(signal.symbol) ?? []).filter(
      (b) => b.tradeDate.getTime() >= signal.postedAt.getTime(),
    );
    let maxHighSincePosting: number | null = null;
    let minLowSincePosting: number | null = null;
    for (const b of bars) {
      if (Number.isFinite(b.high)) maxHighSincePosting = Math.max(maxHighSincePosting ?? b.high, b.high);
      if (Number.isFinite(b.low)) minLowSincePosting = Math.min(minLowSincePosting ?? b.low, b.low);
    }

    const evaluated = evaluateSwingSignalStatus({
      aiRecommendation: signal.aiRecommendation,
      targetPrice: signal.targetPrice,
      stopLoss: signal.stopLoss,
      currentPrice,
      maxHighSincePosting,
      minLowSincePosting,
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
            maxHighSincePosting,
            minLowSincePosting,
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
        maxHighSincePosting,
        minLowSincePosting,
        reason: evaluated.reason,
      });
    }

    // Refresh price + return for EVERY checked signal (status flips included).
    updates.push(
      (async () => {
        try {
          await prisma.swingSignal.update({
            where: { id: signal.id },
            data: {
              ...(evaluated.status !== "active" ? { status: evaluated.status } : {}),
              currentPrice,
              returnPercent,
              lastCheckedAt: new Date(),
            },
          });
        } catch (err) {
          if (isDbUnavailableError(err)) {
            logger.warn({
              msg: "Swing performance check: Accelerate unreachable on signal update — skipped",
              symbol: signal.symbol,
              signalId: signal.id,
              error: err instanceof Error ? err.message : String(err),
            });
          } else {
            throw err;
          }
        }
      })(),
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
