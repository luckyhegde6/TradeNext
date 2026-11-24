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

/** @internal test-only: reset in-memory seed guard between tests. */
export function _resetSeedStateForTests(): void {
  seededUserIds.clear();
}

/**
 * Durable probe — are swing AI targets stored, in progress, or already
 * attempted for this user?
 *
 * "Stored targets" means actual AI-generated analysis (LONG/SHORT/OBSERVE with
 * entry/target/stop), NOT a screener-only feed. A screener-only response
 * (`analysisStatus: "skipped"` with no per-stock analysis) must NOT count as
 * seeded, otherwise the one-time auto-seed never runs and the Swing tab stays
 * stuck on "AI targets off / screener signals only".
 *
 * Read-only: inspects the durable swing-analysis job state (mirror/Prisma) and
 * the serve-first feed; never triggers a scan or AI generation. Returns false on
 * any error (treated as unseeded so the single bounded seed can attempt once).
 */
export async function hasStoredSwingTargetsForUser(
  userId: number = PUBLIC_SWING_USER_ID,
): Promise<boolean> {
  // Process guard short-circuits (no DB read at all when already seeded).
  if (seededUserIds.has(userId)) return true;
  try {
    // 1) Durable job state — side-effect free. A pending/running job means AI
    // generation is already in flight; done/failed means a generation attempt
    // completed (seed-once must not loop). This catches cases where the
    // analyze=false serve path returns a screener-only cache miss.
    const { getSqliteFallback } = await import("@/lib/sqlite");
    const sqlite = getSqliteFallback();
    const mirrorLatest =
      sqlite?.getSwingAnalysisJobs({
        status: ["pending", "running", "done", "failed"],
        limit: 1,
        order: "desc",
      })?.[0] ?? null;

    let latestJob: Record<string, unknown> | null = mirrorLatest;
    if (!latestJob) {
      try {
        const prisma = (await import("@/lib/prisma")).default;
        latestJob = (await prisma.swingAnalysisJob.findFirst({
          where: { status: { in: ["pending", "running", "done", "failed"] } },
          orderBy: { createdAt: "desc" },
        })) as Record<string, unknown> | null;
      } catch {
        // Prisma unavailable — fall through to serve-first probe.
      }
    }

    if (latestJob) {
      const status = String(latestJob.status ?? "");
      if (status === "pending" || status === "running") return true;
      if (status === "done" || status === "failed") {
        const payload = (latestJob.payload ?? {}) as {
          stocks?: Array<{ analysis?: unknown }>;
        };
        const hasAnalysis =
          Array.isArray(payload.stocks) &&
          payload.stocks.some((s) => s && s.analysis != null);
        // Treat a completed attempt as "seeded" (no auto-retry loop). A done job
        // with analysis is stored targets; a failed/empty-analysis job is still a
        // terminal once-attempt — manual Refresh remains available.
        if (status === "done" ? true : hasAnalysis || true) return true;
      }
    }

    // 2) Serve-first feed probe (NO AI, NO force). Covers in-memory/cached states
    // not reflected in job lookup.
    const data = await getSwingRecommendations({ forceRefresh: false, analyze: false });
    if (!data || typeof data !== "object") return false;

    const status = (data as { analysisStatus?: string }).analysisStatus;
    if (status === "pending" || status === "done" || status === "failed") return true;

    const stocks = (data as { stocks?: Array<{ analysis?: unknown }> }).stocks;
    if (Array.isArray(stocks) && stocks.some((s) => s && s.analysis != null)) return true;

    // Screener-only / skipped feed (even with picks) has no AI targets yet.
    return false;
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

// ---------------------------------------------------------------------------
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

    // The decision engine (v3.41) is removed — no gate. The one-time
    // auto-generate fires unconditionally on the first trigger (seed-once).
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
