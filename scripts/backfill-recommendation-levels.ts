/**
 * scripts/backfill-recommendation-levels.ts
 *
 * One-time v3.6.3 backfill (idempotent — safe to re-run):
 *
 * Fixes RecommendationTracker rows whose `targetPrice` / `stopLoss` contradict
 * the recommendation direction — the pre-evaluator AI output could return
 * BUY-style levels on a SELL call (e.g. ITC SELL ₹279 → target ₹306.9 above
 * price, stop ₹265.05 below price). See:
 *   lib/services/recommendationLevelEvaluator.ts (evaluateRecommendationLevels)
 *
 * Semantics corrected here:
 *   - BUY  : target >  entryPrice > stop
 *   - SELL : target <  entryPrice < stop
 *   - HOLD : target >  entryPrice > stop (tight band, defaults applied when absent)
 *
 * Only rows with entryPrice > 0 are touched (no price anchor → skipped).
 * Approved levels (already direction-consistent) are left untouched.
 *
 * Run: `npx tsx scripts/backfill-recommendation-levels.ts`
 */

import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { evaluateRecommendationLevels } from "@/lib/services/recommendationLevelEvaluator";

async function backfill() {
  logger.info({ msg: "Backfill started: direction-consistent target/SL" });

  const rows = await prisma.recommendationTracker.findMany({
    where: { entryPrice: { gt: 0 } },
    select: {
      id: true,
      symbol: true,
      entryPrice: true,
      targetPrice: true,
      stopLoss: true,
      status: true,
      aiRecommendation: true,
    },
  });

  logger.info({ msg: "Trackers scanned", count: rows.length });

  let updated = 0;
  let corrected = 0;
  for (const row of rows) {
    const direction = (row.aiRecommendation || "HOLD").toUpperCase() as "BUY" | "SELL" | "HOLD";
    const result = evaluateRecommendationLevels({
      direction,
      price: row.entryPrice,
      targetPrice: row.targetPrice ?? undefined,
      stopLoss: row.stopLoss ?? undefined,
    });

    // Only rewrite when the evaluator had to change something
    if (result.targetPrice === row.targetPrice && result.stopLoss === row.stopLoss) continue;

    await prisma.recommendationTracker.update({
      where: { id: row.id },
      data: { targetPrice: result.targetPrice, stopLoss: result.stopLoss },
    });
    updated++;
    if (result.corrections.length > 0) corrected++;

    logger.info({
      msg: "Tracker levels corrected",
      symbol: row.symbol,
      direction,
      old: { targetPrice: row.targetPrice, stopLoss: row.stopLoss },
      updated: { targetPrice: result.targetPrice, stopLoss: result.stopLoss },
      corrections: result.corrections,
    });
  }

  logger.info({ msg: "Backfill complete", rowsScanned: rows.length, updated, corrected });
}

backfill()
  .catch((e) => {
    logger.error({ msg: "Backfill failed", error: e instanceof Error ? e.message : String(e) });
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());