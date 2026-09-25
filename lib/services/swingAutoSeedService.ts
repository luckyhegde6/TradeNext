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
import { getDecisionClient } from "@/lib/services/decision/client";
import { trackDecisionTrace } from "@/lib/services/decision/monitoring";
import type { Gate } from "@/lib/services/decision/types";

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

// ---------------------------------------------------------------------------
// POC B — decision-engine gateAutoGenerate (spec 16 §4.F, §6)
// ---------------------------------------------------------------------------

/** Answer keys used by gateAutoGenerate (stable for tests/watchpoints). */
export const AUTOSEED_NOUL = "auto-seed-valid";
export const AUTOSEED_REGIME = "market-regime";
/** Noul validity threshold — below this the gate refuses to auto-act. */
const AUTO_SEED_NOUL_MIN = 0.75;

export interface AutoGenerateGateResult {
  allowed: boolean;
  gate: Gate;
  /** Why: engine-off | trending | engine-unavailable | not-trending | low-validity. */
  reason: "engine-off" | "trending" | "engine-unavailable" | "not-trending" | "low-validity";
}

/**
 * Decision-engine gate for the ONE-TIME auto-generate (POC B).
 *
 *  - flag OFF (DECISION_POC_ENABLED !== "true") → unconditional allow, NO
 *    provider call (production behavior is exactly as before — zero cost).
 *  - flag ON: asks the engine a noul (is auto-seed valid now?) + a choice
 *    (market regime). noul ≥ 0.75 AND regime=trending → allow (act).
 *    Anything else → refuse (review) so the next trigger can re-attempt.
 *  - engine unavailable (provider none / evaluate null / throw) → graceful
 *    allow + audit (seed-once behavior must never be blocked by the engine).
 * Every decision is audited DECISION_GATE.
 */
export async function gateAutoGenerate(
  options: SwingAutoSeedOptions,
): Promise<AutoGenerateGateResult> {
  // Flag OFF is the production default — unconditional allow with NO client
  // call (zero cost, byte-identical behavior). Trace records the outcome only.
  if (process.env.DECISION_POC_ENABLED !== "true") {
    trackDecisionTrace({
      timestamp: new Date().toISOString(),
      kind: "poc-b-autoseed-gate",
      mode: "none",
      status: "success",
      latencyMs: 0,
      gate: "act",
      reason: "engine-off",
      allowed: true,
    });
    return { allowed: true, gate: "act", reason: "engine-off" };
  }

  const gateStarted = Date.now();
  const { trigger, symbol: sym } = options;
  let response: Awaited<ReturnType<ReturnType<typeof getDecisionClient>["evaluate"]>>;
  try {
    response = await getDecisionClient().evaluate({
      state: { trigger, symbol: sym, swingFeed: "empty" },
      questions: [
        {
          type: "noul",
          name: AUTOSEED_NOUL,
          instruction: "Is it valid to auto-generate swing targets on this trigger right now?",
        },
        {
          type: "choice",
          name: AUTOSEED_REGIME,
          options: ["trending", "ranging"],
          instruction: "What regime is the market in (for swing target generation)?",
        },
      ],
    });
  } catch (error) {
    logger.warn({
      msg: "Decision engine unavailable — auto-seed proceeds (graceful allow)",
      trigger,
      error: error instanceof Error ? error.message : String(error),
    });
    await createAuditLog({
      action: "DECISION_GATE",
      resource: "swing",
      path: "/api/recommendations/swing",
      metadata: {
        context: "swing-auto-seed",
        trigger,
        allowed: true,
        gate: "act",
        reason: "engine-unavailable",
      },
    }).catch(() => undefined);
    trackDecisionTrace({
      timestamp: new Date().toISOString(),
      kind: "poc-b-autoseed-gate",
      mode: getDecisionClient().mode(),
      status: "success",
      latencyMs: Date.now() - gateStarted,
      gate: "act",
      reason: "engine-unavailable",
      allowed: true,
    });
    return { allowed: true, gate: "act", reason: "engine-unavailable" };
  }

  // Inert engine (DECISION_PROVIDER=none) → same graceful allow.
  if (!response) {
    trackDecisionTrace({
      timestamp: new Date().toISOString(),
      kind: "poc-b-autoseed-gate",
      mode: getDecisionClient().mode(),
      status: "success",
      latencyMs: Date.now() - gateStarted,
      gate: "act",
      reason: "engine-unavailable",
      allowed: true,
    });
    await createAuditLog({
      action: "DECISION_GATE",
      resource: "swing",
      path: "/api/recommendations/swing",
      metadata: {
        context: "swing-auto-seed",
        trigger,
        allowed: true,
        gate: "act",
        reason: "engine-unavailable",
      },
    }).catch(() => undefined);
    return { allowed: true, gate: "act", reason: "engine-unavailable" };
  }

  const noul = response.answers[AUTOSEED_NOUL];
  const regime = response.answers[AUTOSEED_REGIME];
  const noulVal = noul && "noul" in noul ? Number(noul.noul) : NaN;
  const regimeChoice = regime && "choice" in regime ? regime.choice : undefined;

  const valid = Number.isFinite(noulVal) && noulVal >= AUTO_SEED_NOUL_MIN;
  const trending = regimeChoice === "trending";

  const result: AutoGenerateGateResult = valid && trending
    ? { allowed: true, gate: "act", reason: "trending" }
    : {
        allowed: false,
        gate: "review",
        reason: valid ? "not-trending" : "low-validity",
      };

  await createAuditLog({
    action: "DECISION_GATE",
    resource: "swing",
    path: "/api/recommendations/swing",
    metadata: {
      context: "swing-auto-seed",
      trigger,
      symbol: sym,
      allowed: result.allowed,
      gate: result.gate,
      reason: result.reason,
      noul: Number.isFinite(noulVal) ? noulVal : undefined,
      regime: regimeChoice,
      provider: response.provider,
    },
  }).catch(() => undefined);

  logger.info({
    msg: "Decision gate evaluated for swing auto-seed",
    trigger,
    allowed: result.allowed,
    gate: result.gate,
    reason: result.reason,
  });
  trackDecisionTrace({
    timestamp: new Date().toISOString(),
    kind: "poc-b-autoseed-gate",
    mode: getDecisionClient().mode(),
    provider: response.provider,
    status: "success",
    latencyMs: Date.now() - gateStarted,
    gate: result.gate,
    reason: result.reason,
    allowed: result.allowed,
    noulAmount: Number.isFinite(noulVal) ? noulVal : undefined,
  });
  return result;
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

  // POC B decision gate — governs whether the ONE-TIME generate fires.
  // Flag off → unconditional allow (no provider call, current behavior).
  const gate = await gateAutoGenerate({ trigger, symbol: options.symbol, userId });
  if (!gate.allowed) {
    await createAuditLog({
      action: "SWING_AUTO_SEED_SKIPPED",
      resource: "swing",
      path: "/api/recommendations/swing",
      metadata: {
        trigger,
        symbol: options.symbol,
        reason: "decision-gate",
        gate: gate.gate,
        decisionReason: gate.reason,
      },
    }).catch(() => undefined);
    logger.info({
      msg: "Swing auto-seed skipped by decision gate",
      trigger,
      userId,
      gate: gate.gate,
      reason: gate.reason,
    });
    return { seeded: false, skipped: true };
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
