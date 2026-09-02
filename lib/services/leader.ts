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
export const LEADER_STALENESS_MS = 5 * 60_000;
/** How often we refresh our leadership heartbeat. */
export const LEADER_HEARTBEAT_MS = 60_000;

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

// Prisma unique-violation guard (code P2002).
function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}