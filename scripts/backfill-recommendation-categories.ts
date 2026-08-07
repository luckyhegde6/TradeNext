/**
 * scripts/backfill-recommendation-categories.ts
 *
 * One-time v3.5.0 backfill (idempotent — safe to re-run):
 *
 * 1. Status migration:
 *    - `active`  → `tracking`
 *    - `expired` → `tracking` (30-day expiry is REMOVED in v3.5.0; aged
 *      trackers are archived by age ≥ 360d, not by expiry)
 * 2. Category mapping (only where the tracker still holds the legacy
 *    `medium` default from pre-AI runs — explicit AI `short`/`long` kept):
 *    - 15-min screeners ("Bullish Marubozu 15min", "First 15min Breakout",
 *      "BOSS Scanner BTST") → `btst`
 *    - "Short Term Breakouts" → `short`
 *    - momentum/breakout screeners ("Bullish Momentum", "Potential
 *      Breakouts", "RSI Overbought / Oversold") → `swing`
 * 3. Then run the standard archival sweep: any tracker now ≥ 360 days old
 *    (including legacy `expired` rows that just became `tracking`) is
 *    snapshotted into RecommendationArchive and hard-deleted.
 *
 * Run: `npx tsx scripts/backfill-recommendation-categories.ts`
 * (or `npx ts-node --transpile-only scripts/backfill-recommendation-categories.ts`)
 */

import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { archiveRecommendations } from "@/lib/services/recommendationPerformanceService";

/** Display-name → category. 15-min screeners are BTST; short-term + RSI are short; momentum/breakout swing. */
const SCREENER_CATEGORY_RULES: { match: string; category: "btst" | "short" | "swing" }[] = [
  { match: "15min", category: "btst" },
  { match: "BTST", category: "btst" },
  { match: "Short Term", category: "short" },
  { match: "RSI Overbought", category: "short" },
  { match: "Bullish Momentum", category: "swing" },
  { match: "Potential Breakouts", category: "swing" },
];

function categoryForAttribution(attribution: unknown): "btst" | "short" | "swing" | null {
  if (!Array.isArray(attribution)) return null;
  const names = attribution.map((s) => String(s));
  for (const rule of SCREENER_CATEGORY_RULES) {
    if (names.some((n) => n.toLowerCase().includes(rule.match.toLowerCase()))) {
      return rule.category;
    }
  }
  return null;
}

async function backfill() {
  logger.info({ msg: "Backfill started: recommendation statuses + categories" });

  // ── 1. Status migration ────────────────────────────────────────────────
  const activeRows = await prisma.recommendationTracker.updateMany({
    where: { status: "active" },
    data: { status: "tracking" },
  });
  const expiredRows = await prisma.recommendationTracker.updateMany({
    where: { status: "expired" },
    data: { status: "tracking" },
  });
  logger.info({
    msg: "Status migration applied",
    activeToTracking: activeRows.count,
    expiredToTracking: expiredRows.count,
  });

  // ── 2. Category mapping (legacy `medium` default only) ─────────────────
  const legacyMedium = await prisma.recommendationTracker.findMany({
    where: { timeHorizon: "medium" },
    select: { id: true, symbol: true, screenerAttribution: true },
    take: 2000,
  });

  const categoryUpdates: { id: string; category: string }[] = [];
  for (const t of legacyMedium) {
    const category = categoryForAttribution(t.screenerAttribution);
    if (category) categoryUpdates.push({ id: t.id, category });
  }

  // updateMany is atomic per row — bounded concurrency, no interactive txn
  for (let i = 0; i < categoryUpdates.length; i += 100) {
    const batch = categoryUpdates.slice(i, i + 100);
    await Promise.all(
      batch.map((u) =>
        prisma.recommendationTracker.updateMany({
          where: { id: u.id, timeHorizon: "medium" },
          data: { timeHorizon: u.category },
        })
      )
    );
  }
  logger.info({
    msg: "Category mapping applied",
    mapped: categoryUpdates.length,
    sample: categoryUpdates.slice(0, 5),
  });

  // ── 3. Archival sweep (handles legacy expired ≥ 360d) ──────────────────
  const archive = await archiveRecommendations();
  logger.info({
    msg: "Backfill complete",
    archived: archive.archived,
    failed: archive.failed,
    executionTimeMs: archive.executionTimeMs,
  });
}

backfill()
  .then(() => {
    logger.info({ msg: "Backfill finished" });
    process.exit(0);
  })
  .catch((e) => {
    logger.error({
      msg: "Backfill failed",
      error: e instanceof Error ? e.message : String(e),
    });
    process.exit(1);
  });
