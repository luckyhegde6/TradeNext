// lib/services/swingAutoSeedService.ts
// Plan 15 — Swing AI auto-generate ONCE (empty-state / watchlist-add seed).
//
// Breaker-open serve-first contract (Plan 09 Phase 08):
//   - The swing feed is cached + serve-first. A plain poll ALWAYS serves
//     stored targets when they exist and NEVER fires AI.
//   - This module is the ONE-TIME auto-generate guard + bounded generator.
//     First trigger (empty-state OR watchlist-add) fires a SINGLE bounded
//     scan + one AI pass and persists the targets; every later trigger for
//     that user is an audited NO-OP (no double AI, no double scan).
//
// Keep it greenfield + dependency-light: imports the existing serve
// function plus the audit/logger helpers; no new Prisma model, no migration.
import { getSwingRecommendations } from "@/lib/services/swingRecommendationService";
import { createAuditLog } from "@/lib/audit";
import logger from "@/lib/logger";

/** Public no-auth swing feed user id. */
export const PUBLIC_SWING_USER_ID = 0;

/** Process-level seeded guard — user has already had the one-time seed. */
const seededUserIds = new Set<number>();

/** Process-level check: has the seed already run for this user? (no AI, no DB) */
export function isSwingSeededForUser(userId: number): boolean {
  return seededUserIds.has(userId);
}

/**
 * Durable probe — are stored swing targets already persisted for this user?
 * Serves the STORED feed (analyze=false → serve-first path, NO AI, NO force,
 * NO refresh). A non-empty stored feed means "already seeded" so we never
 * double the AI. Returns false on any error (treated as unseeded).
 */
export async function hasStoredSwingTargetsForUser(
  userId: number = PUBLIC_SWING_USER_ID,
): Promise<boolean> {
  // Process guard short-circuits (no DB read at all when already seeded).
  if (seededUserIds.has(userId)) return true;
  try {
    // serve-first: analyze=false never runs AI; forceRefresh=false never
    // triggers a scan. Reads stored targets only.
    const data = await getSwingRecommendations({ forceRefresh: false, analyze: false });
    return (
      data !== null &&
      typeof data === "object" &&
      "stocks" in data &&
      Array.isArray((data as { stocks?: unknown[] }).stocks) &&
      ((data as { stocks: unknown[] }).stocks).length > 0
    );
  } catch (error) {
    logger.warn({
      msg: "Swing stored-targets probe failed; treated as unseeded",
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export interface SwingAutoSeedOptions {
  /** empty-state poll OR watchlist-add. */
  trigger: "empty-state" | "watchlist-add";
  /** Present when trigger="watchlist-add". */
  symbol?: string;
  userId?: number;
}

/**
 * One-time auto-generate dispatch. Idempotent: the FIRST trigger for a user
 * runs a single bounded generate (one scan + one AI pass, persisted). Every
 * later trigger is a process-level NO-OP with an audit "skipped" tag — never
 * double AI / double scan. Fire-and-forget at the call site; never awaited.
 */
export async function autoTriggerOnce(
  options: SwingAutoSeedOptions,
): Promise<{ seeded: boolean; skipped: boolean }> {
  const userId = options.userId ?? PUBLIC_SWING_USER_ID;
  const trigger = options.trigger;

  // Guard: already seeded → no-op (no double AI), audit as skipped.
  if (isSwingSeededForUser(userId) || (await hasStoredSwingTargetsForUser(userId))) {
    seededUserIds.add(userId);
    await createAuditLog({
      action: "SWING_AUTO_SEED_SKIPPED",
      resource: "swing",
      path: "/api/recommendations/swing",
      metadata: { trigger, symbol: options.symbol, reason: "already-seeded" },
    }).catch(() => undefined);
    logger.info({ msg: "Swing auto-seed skipped (already seeded)", trigger, userId });
    return { seeded: true, skipped: true };
  }

  // Bounded single pass: one full scan + one AI pass, persisted by the
  // service as stored targets. From here on the serve path returns them.
  logger.info({ msg: "Swing auto-seed triggered (seed-once)", trigger, userId });
  try {
    await getSwingRecommendations({ forceRefresh: true, analyze: true });
    seededUserIds.add(userId);
    await createAuditLog({
      action: "SWING_AUTO_SEED_TRIGGERED",
      resource: "swing",
      path: "/api/recommendations/swing",
      metadata: { trigger, symbol: options.symbol },
    }).catch(() => undefined);
    return { seeded: true, skipped: false };
  } catch (error) {
    logger.error({
      msg: "Swing auto-seed generation failed",
      trigger,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { seeded: false, skipped: false };
  }
}

/**
 * Single-symbol variant used by the watchlist-add trigger. Same seed-once
 * guard; when not yet seeded it runs ONE bounded generate for the added
 * symbol (the scan covers the feed, the AI pass persists targets). Never
 * runs AI when already seeded.
 */
export async function generateSwingTargetForSymbol(
  symbol: string,
  userId: number = PUBLIC_SWING_USER_ID,
): Promise<{ seeded: boolean; skipped: boolean }> {
  return autoTriggerOnce({ trigger: "watchlist-add", symbol, userId });
}
