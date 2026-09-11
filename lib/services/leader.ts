// lib/services/leader.ts
//
// Distributed leader election for the in-process daemon (v3.22.0).
//
// Problem: Netlify runs the app as a PERSISTENT server but can spawn MULTIPLE
// instances per deploy (cold-start burst / scale). Every instance runs
// `instrumentation.ts`, which meant N instances each started a worker engine,
// a cron daemon, and a full SQLite sync — multiplying Prisma ops ~5-10x at
// boot and scheduling DUPLICATE cron jobs. The 2026-09-02 prod log showed 5
// instances each logging `SQLite: sync complete, totalRows=2055, durationMs=~7s`
// in the same window, plus `Plan limit circuit breaker open` from the resulting
// op pressure.
//
// Fix: a simple single-writer lock backed by the existing `worker_status`
// table. Only ONE instance holds the lock (refreshes a heartbeat); the rest
// stand by. If the leader's heartbeat goes stale (crash / recycle / deploy),
// a standby acquires the lock and becomes the new leader within the staleness
// window. If the DB itself is unavailable, we DEGRADE to running locally
// so cron/work don't halt entirely — and re-elect on DB recovery.

import os from "os";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { isDbUnavailableError } from "@/lib/db-utils";

export type LeaderRole = "cron-daemon" | "worker" | "sqlite-sync";

/** Unique worker_status row per role, shared by all instances. */
export function leaderWorkerId(role: LeaderRole): string {
  return `leader-${role}`;
}

/** Staleness window — a heartbeat older than this means the leader is dead. */
// v3.33.0: 15 → 10 min (spec 11). A 15-min window meant a crashed leader's row
// took 15+ min to look dead AND our heartbeat (5 min, 3x margin) was overkill;
// 10 min keeps a full heartbeat margin (2x) while letting the watchdog re-claim
// faster after a crash/recycle.
export const LEADER_STALENESS_MS = 10 * 60_000;
/** How often we refresh our leadership heartbeat. */
export const LEADER_HEARTBEAT_MS = 300_000;
/**
 * Watchdog cadences (v3.33.0, spec 11). A standby re-probes the leader row on
 * an ADAPTIVE schedule: slowly (300s) while another instance holds a FRESH
 * row, or fast (60s) when the row is stale/absent so a dead leader is replaced
 * quickly. Both sit far below the staleness window (10 min) yet stay DB-op
 * cheap: steady-state standby = 1 `findUnique` per 300s per instance.
 */
export const LEADER_CLAIM_SLOW_MS = 300_000;
export const LEADER_CLAIM_FAST_MS = 60_000;

/** This instance's unique name (host-pid) so we can tell it's us. */
export const LEADER_SELF = `${os.hostname()}-${process.pid}`;

interface LeaderRow {
  workerId: string;
  workerName: string | null;
  lastHeartbeat: Date;
}

const staleFilter = (role: LeaderRole) => ({
  workerId: leaderWorkerId(role),
  lastHeartbeat: { lt: new Date(Date.now() - LEADER_STALENESS_MS) },
});

function toRow(role: LeaderRole, status: string): {
  workerId: string;
  workerName: string;
  status: string;
  lastHeartbeat: Date;
  cpuUsage: number;
  memoryUsage: number;
} {
  return {
    workerId: leaderWorkerId(role),
    workerName: LEADER_SELF,
    status,
    lastHeartbeat: new Date(),
    cpuUsage: os.loadavg()[0],
    memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
  };
}

/**
 * Attempt to become the leader for `role`. Returns true if THIS process holds
 * (or just acquired) the lock, false if another instance holds a fresh lock.
 *
 * Semantics:
 *   1. Atomically grab an EXISTING but STALE row via updateMany (expired lock).
 *   2. If no stale row existed, upsert — create-absent owns it; a unique
 *      conflict on the create path means another instance holds a fresh lock.
 *   3. If the DB is unreachable (plan-limit hold / breaker), we DEGRADE to
 *      running locally so cron/work continue — this is a fail-open for
 *      availability. We re-elect once the DB recovers.
 */
export async function acquireLeaderLock(role: LeaderRole): Promise<boolean> {
  const workerId = leaderWorkerId(role);
  // Non-conflict errors that escaped the create step are genuine faults (a DB
  // validation/constraint we couldn't interpret) that MUST propagate — but the
  // outer catch treats infra/unavailable errors separately. Track the origin so
  // a generic updateMany claim failure (Test B) stands down instead of throwing.
  let createPath = false;
  try {
    // 1) Claim an expired lock if one exists.
    const claimed = await prisma.workerStatus.updateMany({
      where: staleFilter(role),
      data: toRow(role, "leader"),
    });
    if (claimed.count > 0) {
      logger.info({ msg: "Leader lock acquired (stale claimed)", role, workerId, self: LEADER_SELF });
      return true;
    }

    // 2) No stale row — upsert to own it (fail on unique conflict = someone else leads).
    createPath = true;
    try {
      await prisma.workerStatus.create({ data: toRow(role, "leader") });
      logger.info({ msg: "Leader lock acquired (created)", role, workerId, self: LEADER_SELF });
      return true;
    } catch (createErr) {
      if (isUniqueConflict(createErr)) {
        logger.info({ msg: "Leader lock held by another instance — standing by", role, workerId });
        return false;
      }
      throw createErr;
    }
  } catch (error) {
    // Fail-open ONLY for DB unavailability (plan-limit hold / breaker).
    if (isDbUnavailableError(error)) {
      logger.warn({
        msg: "DB unavailable during leader election — degrading to local leader",
        role,
        workerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
    if (createPath) {
      // A genuine non-conflict error escaped the create step — surface it so the
      // caller can diagnose (constraint, schema, etc.), never silently stand down.
      logger.error({
        msg: "Leader lock acquisition failed",
        role,
        workerId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    // Generic claim-step failure (updateMany) — best-effort: stand down.
    logger.error({
      msg: "Leader lock claim failed — standing down",
      role,
      workerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Refresh the leader heartbeat. Returns whether we STILL hold the lock.
 * If someone else took it while we were renewing (they shouldn't — we hold a
 * fresh row), the updateMany returns 0 and we stand down.
 */
export async function renewLeaderLock(role: LeaderRole): Promise<boolean> {
  const workerId = leaderWorkerId(role);
  try {
    const updated = await prisma.workerStatus.updateMany({
      where: { workerId, workerName: LEADER_SELF },
      data: toRow(role, "leader"),
    });
    return updated.count > 0;
  } catch (error) {
    if (isDbUnavailableError(error)) {
      // DB down — keep local leadership (degrade), we already hold in-memory.
      return true;
    }
    logger.error({
      msg: "Leader heartbeat renew failed",
      role,
      workerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Periodically refresh OUR leadership heartbeat for `role` so the row never
 * goes stale inside LEADER_STALENESS_MS (which would let a standby instance
 * claim the lock and split leadership). Uses LEADER_HEARTBEAT_MS (5 min) which
 * is well under the 10-min staleness window (2x). Self-healing: if renewal stops
 * returning true (we lost the lock), stop renewing and notify via a callback.
 * Returns a stop() function.
 */
export function startLeaderHeartbeat(
  role: LeaderRole,
  onLost?: (role: LeaderRole) => void,
): () => void {
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    renewLeaderLock(role).then((stillLeader) => {
      if (stopped) return;
      if (!stillLeader) {
        logger.warn({
          msg: "Lost leader lock — stopping heartbeat (another instance took over)",
          role,
          workerId: leaderWorkerId(role),
          self: LEADER_SELF,
        });
        stopped = true;
        clearInterval(timer);
        onLost?.(role);
      }
    });
  }, LEADER_HEARTBEAT_MS);
  // Don't keep the process alive just for the heartbeat.
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/** Release leadership (graceful shutdown). Only clears the row if it's ours. */
export async function releaseLeaderLock(role: LeaderRole): Promise<void> {
  const workerId = leaderWorkerId(role);
  try {
    await prisma.workerStatus.deleteMany({
      where: { workerId, workerName: LEADER_SELF },
    });
    logger.info({ msg: "Leader lock released", role, workerId, self: LEADER_SELF });
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      logger.error({
        msg: "Leader lock release failed",
        role,
        workerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Is this process currently the leader for `role`? Reads the row; true if it
 * exists AND belongs to us. Used by the SQLite sync gate and helpers.
 */
export async function isLeader(role: LeaderRole): Promise<boolean> {
  const workerId = leaderWorkerId(role);
  try {
    const row = await prisma.workerStatus.findUnique({
      where: { workerId },
    });
    return row?.workerName === LEADER_SELF;
  } catch (error) {
    if (isDbUnavailableError(error)) {
      // DB down — we degraded to local leader, so treat ourselves as leader.
      return true;
    }
    return false;
  }
}

/** Read the current leader row for diagnostics (null if none). */
export async function getLeaderInfo(role: LeaderRole): Promise<LeaderRow | null> {
  const workerId = leaderWorkerId(role);
  try {
    return await prisma.workerStatus.findUnique({ where: { workerId } });
  } catch {
    return null;
  }
}

// ─── Watchdog self-heal (v3.33.0, spec 11) ───────────────────────────────────
//
// Problem: the v3.22.0 model elected a leader ONCE at boot and NEVER re-claimed
// the lock. If the leader crashed / was recycled, its heartbeat went stale and
// NO standby ever claimed the row — the scheduler / worker engine stayed dead
// FOREVER, and a manual admin "Start Engine" click was the only recovery.
//
// Fix: `watchLeaderRole` is a per-role watchdog loop. The standby watches the
// leader row on an ADAPTIVE cadence (fast LEADER_CLAIM_FAST_MS when the row is
// stale/absent, slow LEADER_CLAIM_SLOW_MS while another instance holds a fresh
// row) and claims the lock as soon as the row looks dead. Claim success
// (re)starts the engine via `onAcquired` and runs the EXISTING heartbeat; a
// lost row keeps the existing `onLost` semantics (engine stop → back to
// standby → fast re-probe). The atomic claim path itself is unchanged
// (updateMany stale-claim → create → P2002 stand down) and the DB-unavailable
// fail-open degrade is preserved.
//
// Ops budget (Plan 09): steady-state standby = 1 `findUnique` per 300s per
// instance (~288 ops/day/instance); promotion paths only on claim.
//
// The per-role diagnostic status lives in a globalThis registry (mirrors
// readTier) so db-health can render it with ZERO Prisma reads.

export interface LeaderWatchHandlers {
  /** Fired once when THIS instance acquires (or fail-open degrades into) leadership. */
  onAcquired?: (role: LeaderRole) => void;
  /** Fired once when THIS instance loses leadership (row taken / stop). */
  onLost?: (role: LeaderRole) => void;
}

export interface LeaderWatchStatus {
  role: LeaderRole;
  phase: "standby" | "leader";
  claimAttempts: number;
  failOpenEvents: number;
  lastClaimAt: string | null;
  lastLostAt: string | null;
  lastProbeAt: string | null;
}

// globalThis registry so db-health diagnostics work across module graphs.
const watchGlobal = globalThis as unknown as { __leaderWatchStatus?: Record<string, LeaderWatchStatus> };

/** In-memory watchdog status per role (zero Prisma). Used by /api/admin/db-health. */
export function getLeaderWatchStatuses(): Record<string, LeaderWatchStatus> {
  if (!watchGlobal.__leaderWatchStatus) watchGlobal.__leaderWatchStatus = {};
  return watchGlobal.__leaderWatchStatus;
}

function newWatchStatus(role: LeaderRole): LeaderWatchStatus {
  return {
    role,
    phase: "standby",
    claimAttempts: 0,
    failOpenEvents: 0,
    lastClaimAt: null,
    lastLostAt: null,
    lastProbeAt: null,
  };
}

/**
 * Per-role watchdog loop (v3.33.0, spec 11). Stands by while another instance
 * holds a fresh leader row, claims the lock as soon as the row is stale/absent,
 * and re-claims after losing leadership — replacing the one-shot boot election.
 *
 * Cadence (adaptive, respects the DB-op budget):
 *   - row FRESH & foreign → slow probe every LEADER_CLAIM_SLOW_MS (300s)
 *   - row stale/absent/DB-down → claim now; while standing by, fast re-probe
 *     every LEADER_CLAIM_FAST_MS (60s)
 *   - while LEADER → no probing; the existing startLeaderHeartbeat owns renewal
 *     and fires `onLost` when the row is taken → phase → standby → fast probe
 *
 * Returns a stop() that clears the probe timer AND stops the heartbeat.
 */
export function watchLeaderRole(role: LeaderRole, handlers: LeaderWatchHandlers = {}): () => void {
  const status = (getLeaderWatchStatuses()[role] ??= newWatchStatus(role));
  let phase: "standby" | "leader" = "standby";
  let stopped = false;
  let probeTimer: NodeJS.Timeout | null = null;
  let heartbeatStop: (() => void) | null = null;

  const syncStatus = () => {
    status.phase = phase;
  };

  const scheduleProbe = (delayMs: number) => {
    if (stopped || phase === "leader") return;
    probeTimer = setTimeout(() => {
      probeTimer = null;
      void probe();
    }, delayMs);
    probeTimer.unref?.();
  };

  const onLost = (lostRole: LeaderRole) => {
    if (stopped) return;
    phase = "standby";
    heartbeatStop = null;
    status.lastLostAt = new Date().toISOString();
    syncStatus();
    handlers.onLost?.(lostRole);
    scheduleProbe(LEADER_CLAIM_FAST_MS);
  };

  const probe = async () => {
    if (stopped || phase === "leader") return;
    status.lastProbeAt = new Date().toISOString();

    let row: LeaderRow | null = null;
    try {
      row = await getLeaderInfo(role); // never throws (catches → null)
    } catch {
      row = null;
    }

    const freshForeign =
      row !== null &&
      row.workerName !== LEADER_SELF &&
      Date.now() - row.lastHeartbeat.getTime() < LEADER_STALENESS_MS;

    if (freshForeign) {
      // Someone healthy leads — stay a standby, probe slowly.
      scheduleProbe(LEADER_CLAIM_SLOW_MS);
      return;
    }

    // Stale / absent row (or DB down) — try to claim.
    status.claimAttempts += 1;
    let acquired = false;
    try {
      acquired = await acquireLeaderLock(role);
    } catch (error) {
      logger.error({
        msg: "watchLeaderRole claim failed — staying standby",
        role,
        workerId: leaderWorkerId(role),
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (!acquired) {
      scheduleProbe(LEADER_CLAIM_SLOW_MS); // another instance won the race
      return;
    }

    // Distinguish a real DB claim from the fail-open degrade (DB down): a real
    // claim leaves OUR row behind; fail-open leaves no readable row.
    try {
      const own = await getLeaderInfo(role);
      if (own === null || own.workerName !== LEADER_SELF) status.failOpenEvents += 1;
    } catch {
      status.failOpenEvents += 1;
    }

    phase = "leader";
    status.lastClaimAt = new Date().toISOString();
    syncStatus();
    logger.info({
      msg: "watchLeaderRole acquired leadership",
      role,
      workerId: leaderWorkerId(role),
      self: LEADER_SELF,
    });
    handlers.onAcquired?.(role);
    heartbeatStop = startLeaderHeartbeat(role, onLost);
  };

  // Kick off the loop immediately (same timing as the old boot-time acquire).
  scheduleProbe(0);

  return () => {
    stopped = true;
    if (probeTimer) {
      clearTimeout(probeTimer);
      probeTimer = null;
    }
    if (heartbeatStop) {
      heartbeatStop();
      heartbeatStop = null;
    }
    syncStatus();
  };
}

// Prisma unique-violation guard (code P2002).
function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}