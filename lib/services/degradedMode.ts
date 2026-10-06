// ─── Degraded mode — preemptive SQLite-first switch (v3.45.0, spec 21) ───────
//
// WHY THIS EXISTS. The Prisma plan-limit circuit breaker in `lib/db-utils.ts` is
// REACTIVE: it only opens once a real P6003/timeout has already been thrown. By
// then ops have been spent, and every caller has to individually remember to
// check the breaker. Production showed the cost of reactive-only: the account
// sat on hold and `/api/recommendations` served 31-day-stale data from
// `memory_cache` (run `347d6887`, `status: "failed"`, `aiProcessed: 0`).
//
// This module adds the PRE-EMPTIVE switch the user asked for: at 90% of the
// monthly plan limit we degrade to SQLite BEFORE the hold lands. It is a pure
// evaluator over the monthly ops ledger (`lib/services/opsMonthly.ts`) plus the
// existing breaker, with NO Prisma dependency of its own — so it is unit
// testable without a database and cheap enough to call on hot paths.
//
// THREE INVARIANTS (each has a unit test in `degradedMode.test.ts`):
//  1. Hysteresis. Enter at ENTER_RATIO (90%) of the monthly limit, but only LEAVE
//     once usage drops to EXIT_RATIO (80%) AND the breaker is closed. Without the
//     gap the switch would flap on a single op straddling the line.
//  2. Precedence `off > forced > breaker > threshold`. `off` is a hard kill
//     switch that even beats an OPEN breaker — otherwise an operator could not
//     get back to normal behaviour without a redeploy.
//  3. Fail-safe. If the ops ledger cannot be read we report NOT active. Erring
//     toward "degraded" on an unreadable counter would take the site down over a
//     transient read failure.
//
// NEVER THROWS. Callers are on request paths; a throw here would be worse than
// the condition being measured.

import { isPlanLimitBreakerOpen } from "@/lib/db-utils";
import { getOpsMonthlyState, buildQueryConsumption } from "@/lib/services/opsMonthly";

/** Operator-selectable mode. `off` = never degrade (kill switch). */
export type DegradedModeSetting = "auto" | "force" | "off";

/**
 * Runtime source of truth for the valid modes. Exported so the admin API's zod
 * enum and any UI picker derive from the SAME list the service validates against
 * — a hand-written duplicate is how a UI ends up offering a mode the backend
 * silently coerces to `auto`.
 */
export const DEGRADED_MODE_SETTINGS = ["auto", "force", "off"] as const satisfies readonly DegradedModeSetting[];

/** Why degraded mode is (or is not) engaged. Useful for admin UI + audit. */
export type DegradedReason = "breaker" | "forced" | "threshold" | "off";

export interface DegradedState {
  /** Effective state, after precedence + hysteresis. */
  active: boolean;
  /** The operator's configured mode. */
  mode: DegradedModeSetting;
  /** The reason that actually decided `active`. */
  reason: DegradedReason;
  /** Month-to-date reads + writes at the moment of evaluation. */
  totalOperations: number;
  /** Monthly plan limit (`DB_PLAN_LIMIT_OPS_MONTHLY`, default 200k). */
  planLimit: number;
  /** Operations left before the plan limit. */
  planOperationsRemaining: number;
  /** Ops at which we flip on (90% of planLimit). */
  enterAt: number;
  /** Ops at which we may flip back off (80% of planLimit). */
  exitAt: number;
  /** Prisma plan-limit breaker state. */
  breakerOpen: boolean;
  /** Epoch ms of the last transition; null when never transitioned. */
  since: number | null;
}

export const DEFAULT_PLAN_LIMIT_OPS_MONTHLY = 200_000;
/** Flip ON at 90% of the monthly plan limit (user directive). */
export const ENTER_RATIO = 0.9;
/** Only flip OFF at 80% — the 10-point gap is the anti-flap hysteresis band. */
export const EXIT_RATIO = 0.8;
/** Cheap enough to call per request; the ops ledger only moves on real DB ops. */
const CACHE_TTL_MS = 5_000;

const g = globalThis as unknown as {
  __degradedMode?: DegradedModeSetting;
  __degradedSince?: number | null;
  __degradedActive?: boolean;
  __degradedCache?: { at: number; state: DegradedState };
};

function readMode(): DegradedModeSetting {
  const raw = (g.__degradedMode ?? process.env.DEGRADED_MODE ?? "auto").toString().trim().toLowerCase();
  // Unknown values coerce to `auto` rather than throwing — a typo in env must
  // not silently disable the protection the user asked for.
  return raw === "force" || raw === "off" ? raw : "auto";
}

/** Override the mode at runtime (admin kill switch). Survives in-process only;
 *  the operator's durable choice is the env var. */
export function setDegradedMode(mode: DegradedModeSetting): void {
  g.__degradedMode = mode;
  g.__degradedCache = undefined; // force re-evaluation so the change is immediate
}

export function getDegradedModeSetting(): DegradedModeSetting {
  return readMode();
}

export function monthlyPlanLimit(): number {
  const n = Number(process.env.DB_PLAN_LIMIT_OPS_MONTHLY);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PLAN_LIMIT_OPS_MONTHLY;
}

/**
 * Evaluate degraded mode. Pure with respect to the thresholds — all I/O is the
 * in-memory ops ledger and the in-memory breaker, so this is safe to call from
 * any request path.
 *
 * Hysteresis state (`__degradedActive`) is deliberately process-local: the
 * switch is a *local* decision about whether THIS instance should read/write
 * SQLite, and every instance sees the same persisted ops ledger, so they
 * converge on the same answer without extra coordination.
 */
export function evaluateDegradedMode(now: number = Date.now()): DegradedState {
  const mode = readMode();
  const breakerOpen = isPlanLimitBreakerOpen();
  const planLimit = monthlyPlanLimit();
  const enterAt = Math.floor(planLimit * ENTER_RATIO);
  const exitAt = Math.floor(planLimit * EXIT_RATIO);

  let totalOperations = 0;
  let planOperationsRemaining = planLimit;
  try {
    // buildQueryConsumption merges today's live counter over the persisted
    // ledger, so a just-restarted instance with an empty in-memory counter still
    // sees the month's high-water mark — that matters because the whole point is
    // to act BEFORE the hold.
    const consumption = buildQueryConsumption(
      getOpsMonthlyState(),
      { reads: 0, writes: 0 },
      planLimit,
    );
    totalOperations = consumption.totalOperations;
    planOperationsRemaining = consumption.planOperationsRemaining;
  } catch {
    // Fail-safe: an unreadable ledger must NOT trip degraded mode. Losing the
    // site because we could not count is strictly worse than the hold itself.
    totalOperations = 0;
    planOperationsRemaining = planLimit;
  }

  let active: boolean;
  let reason: DegradedReason;
  if (mode === "off") {
    active = false;
    reason = "off";
  } else if (mode === "force") {
    active = true;
    reason = "forced";
  } else if (breakerOpen) {
    active = true;
    reason = "breaker";
  } else {
    // Threshold with hysteresis. `g.__degradedActive` is undefined on first
    // evaluation, which correctly reads as "not yet engaged".
    //
    // The two comparisons are DELIBERATELY asymmetric: engage at `>= enterAt`,
    // but while engaged stay engaged until usage falls BELOW `exitAt` (`>` not
    // `>=`, so the exit line itself is a release point). Writing the engaged
    // branch as `totalOperations <= exitAt` looks equivalent and is not: usage
    // ABOVE the exit line is the normal engaged state, so `active` would collapse
    // to false on the very next evaluation after engaging — i.e. degraded mode
    // would flicker for a single 5s cache window and never stay on, which is the
    // exact hold this whole subsystem exists to pre-empt.
    const engaged = g.__degradedActive === true;
    active = engaged ? totalOperations > exitAt : totalOperations >= enterAt;
    reason = active ? "threshold" : "threshold";
  }

  if (active !== (g.__degradedActive === true)) {
    g.__degradedActive = active;
    g.__degradedSince = active ? now : null;
  }

  return {
    active,
    mode,
    reason,
    totalOperations,
    planLimit,
    planOperationsRemaining,
    enterAt,
    exitAt,
    breakerOpen,
    since: g.__degradedSince ?? null,
  };
}

/** Cached read for hot paths (5s TTL). `active` is the hot-path question. */
export function getDegradedState(): DegradedState {
  const now = Date.now();
  const cached = g.__degradedCache;
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.state;
  const state = evaluateDegradedMode(now);
  g.__degradedCache = { at: now, state };
  return state;
}

/** The one-liner hot paths want: should I read/write SQLite instead of Prisma? */
export function isDegradedModeActive(): boolean {
  return getDegradedState().active;
}

/** Test hook — clear mode, hysteresis, transition time and cache. */
export function resetDegradedModeForTests(): void {
  g.__degradedMode = undefined;
  g.__degradedActive = undefined;
  g.__degradedSince = undefined;
  g.__degradedCache = undefined;
}
