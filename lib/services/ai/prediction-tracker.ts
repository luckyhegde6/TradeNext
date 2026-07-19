import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

export interface PredictionOutcome {
  id: string;
  symbol: string;
  prediction: string;
  entryPrice: number;
  currentPrice: number;
  returnPercent: number;
  outcome: "win" | "loss" | "breakeven" | "pending";
  checkInterval: "1w" | "1m" | "3m";
}

interface CheckIntervals {
  interval: "1w" | "1m" | "3m";
  daysAgo: number;
}

const CHECK_INTERVALS: CheckIntervals[] = [
  { interval: "1w", daysAgo: 7 },
  { interval: "1m", daysAgo: 30 },
  { interval: "3m", daysAgo: 90 },
];

const WIN_THRESHOLD = 5;
const LOSS_THRESHOLD = -5;
const ACCURACY_ALERT_THRESHOLD = 40;
const CONSECUTIVE_LOSS_THRESHOLD = 5;
const ADJUSTMENT_COOLDOWN_DAYS = 30;

/**
 * Record a new prediction for tracking.
 * Returns the created record ID.
 */
export async function recordPrediction(data: {
  agentType: string;
  symbol: string;
  prediction: string;
  confidence: number;
  entryPrice: number;
  targetPrice?: number;
  stopLoss?: number;
  promptVersion?: string;
  modelUsed?: string;
  runId?: string;
}): Promise<string> {
  const record = await prisma.agentPerformanceLog.create({
    data: {
      agentType: data.agentType,
      symbol: data.symbol,
      prediction: data.prediction,
      confidence: data.confidence,
      entryPrice: data.entryPrice,
      targetPrice: data.targetPrice ?? null,
      stopLoss: data.stopLoss ?? null,
      outcome: "pending",
      promptVersion: data.promptVersion ?? null,
      modelUsed: data.modelUsed ?? null,
      runId: data.runId ?? null,
    },
  });

  logger.info({
    msg: "Recorded prediction for tracking",
    id: record.id,
    symbol: data.symbol,
    prediction: data.prediction,
    entryPrice: data.entryPrice,
    agentType: data.agentType,
  });

  return record.id;
}

/**
 * Check pending predictions at intervals (1w, 1m, 3m).
 * Fetches current prices, computes returns, classifies outcomes, and updates DB.
 * Returns all predictions that were checked this run.
 */
export async function checkPredictions(): Promise<PredictionOutcome[]> {
  const now = new Date();
  const results: PredictionOutcome[] = [];

  for (const { interval, daysAgo } of CHECK_INTERVALS) {
    const cutoffDate = new Date(now);
    cutoffDate.setDate(cutoffDate.getDate() - daysAgo);

    const pendingPredictions = await prisma.agentPerformanceLog.findMany({
      where: {
        outcome: "pending",
        createdAt: { lte: cutoffDate },
        symbol: { not: null },
      },
      orderBy: { createdAt: "asc" },
    });

    if (pendingPredictions.length === 0) continue;

    logger.info({
      msg: "Checking pending predictions",
      interval,
      count: pendingPredictions.length,
    });

    for (const pred of pendingPredictions) {
      try {
        const currentPrice = await getLatestPrice(pred.symbol!);
        if (currentPrice === null) {
          logger.warn({
            msg: "No price data found for symbol, skipping",
            symbol: pred.symbol,
            predictionId: pred.id,
          });
          continue;
        }

        const returnPercent =
          ((currentPrice - pred.entryPrice) / pred.entryPrice) * 100;
        const outcome = classifyOutcome(returnPercent);

        await prisma.agentPerformanceLog.update({
          where: { id: pred.id },
          data: {
            currentPrice,
            returnPercent: Math.round(returnPercent * 100) / 100,
            outcome,
            checkInterval: interval,
            checkedAt: now,
          },
        });

        results.push({
          id: pred.id,
          symbol: pred.symbol!,
          prediction: pred.prediction,
          entryPrice: pred.entryPrice,
          currentPrice,
          returnPercent: Math.round(returnPercent * 100) / 100,
          outcome,
          checkInterval: interval,
        });

        logger.info({
          msg: "Prediction outcome classified",
          id: pred.id,
          symbol: pred.symbol,
          outcome,
          returnPercent: Math.round(returnPercent * 100) / 100,
          interval,
        });
      } catch (error) {
        logger.error({
          msg: "Failed to check prediction",
          id: pred.id,
          symbol: pred.symbol,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (results.length > 0) {
    const accuracy = await calculateOverallAccuracy();
    if (accuracy !== null && accuracy < ACCURACY_ALERT_THRESHOLD) {
      logger.warn({
        msg: "Prediction accuracy below threshold, alert triggered",
        accuracy,
        threshold: ACCURACY_ALERT_THRESHOLD,
      });
    }
  }

  return results;
}

/**
 * Classify a return percentage into win/breakeven/loss.
 */
function classifyOutcome(
  returnPercent: number
): "win" | "loss" | "breakeven" {
  if (returnPercent > WIN_THRESHOLD) return "win";
  if (returnPercent < LOSS_THRESHOLD) return "loss";
  return "breakeven";
}

/**
 * Get the latest closing price for a symbol from daily_prices.
 */
async function getLatestPrice(symbol: string): Promise<number | null> {
  const result = await prisma.$queryRaw<
    Array<{ close: number | null }>
  >`SELECT close FROM daily_prices WHERE ticker = ${symbol} ORDER BY "tradeDate" DESC LIMIT 1`;

  if (result.length === 0 || result[0].close === null) return null;
  return Number(result[0].close);
}

/**
 * Calculate overall accuracy across all outcome-checked predictions.
 */
async function calculateOverallAccuracy(): Promise<number | null> {
  const stats = await prisma.agentPerformanceLog.groupBy({
    by: ["outcome"],
    where: {
      outcome: { in: ["win", "loss", "breakeven"] },
    },
    _count: { id: true },
  });

  const counts = Object.fromEntries(
    stats.map((s) => [s.outcome, s._count.id])
  );

  const completed =
    (counts["win"] ?? 0) + (counts["loss"] ?? 0) + (counts["breakeven"] ?? 0);
  if (completed === 0) return null;

  return ((counts["win"] ?? 0) / completed) * 100;
}

/**
 * Calculate overall accuracy for a specific agent type.
 */
export async function calculateAccuracy(
  agentType: string,
  days?: number
): Promise<{
  total: number;
  wins: number;
  losses: number;
  breakeven: number;
  pending: number;
  accuracy: number;
}> {
  const where: Record<string, unknown> = { agentType };
  if (days) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    where.createdAt = { gte: since };
  }

  const stats = await prisma.agentPerformanceLog.groupBy({
    by: ["outcome"],
    where,
    _count: { id: true },
  });

  const counts = Object.fromEntries(
    stats.map((s) => [s.outcome ?? "pending", s._count.id])
  );

  const wins = counts["win"] ?? 0;
  const losses = counts["loss"] ?? 0;
  const breakeven = counts["breakeven"] ?? 0;
  const pending = counts["pending"] ?? 0;
  const completed = wins + losses + breakeven;
  const total = completed + pending;
  const accuracy = completed > 0 ? (wins / completed) * 100 : 0;

  return {
    total,
    wins,
    losses,
    breakeven,
    pending,
    accuracy: Math.round(accuracy * 100) / 100,
  };
}

/**
 * Get accuracy trend over time, grouped by day.
 */
export async function getAccuracyTrend(
  agentType: string,
  days?: number
): Promise<
  Array<{
    date: string;
    accuracy: number;
    totalPredictions: number;
  }>
> {
  const since = new Date();
  since.setDate(since.getDate() - (days ?? 90));

  const records = await prisma.agentPerformanceLog.findMany({
    where: {
      agentType,
      outcome: { in: ["win", "loss", "breakeven"] },
      checkedAt: { not: null, gte: since },
    },
    select: {
      checkedAt: true,
      outcome: true,
    },
    orderBy: { checkedAt: "asc" },
  });

  const byDay = new Map<
    string,
    { wins: number; total: number }
  >();

  for (const rec of records) {
    const day = rec.checkedAt!.toISOString().slice(0, 10);
    const entry = byDay.get(day) ?? { wins: 0, total: 0 };
    entry.total += 1;
    if (rec.outcome === "win") entry.wins += 1;
    byDay.set(day, entry);
  }

  return Array.from(byDay.entries()).map(([date, { wins, total }]) => ({
    date,
    accuracy: Math.round((wins / total) * 10000) / 100,
    totalPredictions: total,
  }));
}

/**
 * Check if prompt adjustment is needed based on accuracy signals.
 */
export async function shouldAdjustPrompt(
  agentType: string
): Promise<{
  shouldAdjust: boolean;
  reason?: string;
  currentAccuracy: number;
}> {
  const accuracy = await calculateAccuracy(agentType);
  if (accuracy.accuracy > 0 || accuracy.total > 0) {
    if (accuracy.accuracy < ACCURACY_ALERT_THRESHOLD) {
      return {
        shouldAdjust: true,
        reason: `Accuracy ${accuracy.accuracy}% is below ${ACCURACY_ALERT_THRESHOLD}% threshold`,
        currentAccuracy: accuracy.accuracy,
      };
    }
  }

  const recentLosses = await prisma.agentPerformanceLog.findMany({
    where: {
      agentType,
      outcome: "loss",
    },
    orderBy: { checkedAt: "desc" },
    take: CONSECUTIVE_LOSS_THRESHOLD,
    select: { checkedAt: true },
  });

  if (recentLosses.length >= CONSECUTIVE_LOSS_THRESHOLD) {
    const allRecent = recentLosses.every((r) => {
      if (!r.checkedAt) return false;
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 14);
      return r.checkedAt >= sevenDaysAgo;
    });

    if (allRecent) {
      return {
        shouldAdjust: true,
        reason: `${CONSECUTIVE_LOSS_THRESHOLD} consecutive losses in recent predictions`,
        currentAccuracy: accuracy.accuracy,
      };
    }
  }

  const lastAdjustment = await prisma.agentPerformanceLog.findFirst({
    where: {
      agentType,
      promptVersion: { not: null },
    },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });

  if (lastAdjustment) {
    const cooldownMs =
      ADJUSTMENT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    const timeSinceAdjustment =
      Date.now() - lastAdjustment.updatedAt.getTime();
    if (timeSinceAdjustment > cooldownMs) {
      return {
        shouldAdjust: true,
        reason: `${ADJUSTMENT_COOLDOWN_DAYS}+ days since last prompt adjustment`,
        currentAccuracy: accuracy.accuracy,
      };
    }
  }

  return {
    shouldAdjust: false,
    currentAccuracy: accuracy.accuracy,
  };
}
