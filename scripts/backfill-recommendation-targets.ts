/**
 * scripts/backfill-recommendation-targets.ts
 *
 * One-time v3.5.0-followup backfill (idempotent — safe to re-run):
 *
 * Fixes trackers whose `targetPrice` / `stopLoss` are 0 (or null) — caused by
 * the AI recommendation fallback persisting literal zeros before the
 * price-based-default fix (see lib/services/ai/recommendation-agent.ts).
 *
 * Where the AI actually returned a target but the tracker was overwritten with
 * the HOLD fallback, we cannot recover the model's original value — so we apply
 * the same price-based defaults the pipeline now uses:
 *   - targetPrice = entryPrice * 1.1 (DEFAULT_TARGET_MULTIPLIER)
 *   - stopLoss   = entryPrice * 0.95 (DEFAULT_STOP_LOSS_MULTIPLIER)
 * Only rows with entryPrice > 0 are touched (no price → nothing to base on).
 *
 * Run: `npx tsx scripts/backfill-recommendation-targets.ts`
 */

import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

const TARGET_MULTIPLIER = 1.1;
const STOP_LOSS_MULTIPLIER = 0.95;

async function backfill() {
  logger.info({ msg: "Backfill started: recommendation target/SL zeros" });

  const rows = await prisma.recommendationTracker.findMany({
    where: {
      entryPrice: { gt: 0 },
      OR: [{ targetPrice: { lte: 0 } }, { stopLoss: { lte: 0 } }],
    },
    select: { id: true, symbol: true, entryPrice: true, targetPrice: true, stopLoss: true, status: true },
  });

  logger.info({ msg: "Rows with zero/missing target or stopLoss", count: rows.length });

  let updated = 0;
  for (const row of rows) {
    const round = (n: number) => Math.round(n * 100) / 100;
    const targetPrice = row.targetPrice && row.targetPrice > 0 ? row.targetPrice : round(row.entryPrice * TARGET_MULTIPLIER);
    const stopLoss = row.stopLoss && row.stopLoss > 0 ? row.stopLoss : round(row.entryPrice * STOP_LOSS_MULTIPLIER);

    // Skip rows already fixed (both non-zero)
    if (targetPrice === row.targetPrice && stopLoss === row.stopLoss) continue;

    await prisma.recommendationTracker.update({
      where: { id: row.id },
      data: { targetPrice, stopLoss },
    });
    updated++;
  }

  logger.info({ msg: "Backfill complete", rowsScanned: rows.length, updated });
}

backfill()
  .catch((e) => {
    logger.error({ msg: "Backfill failed", error: e instanceof Error ? e.message : String(e) });
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
