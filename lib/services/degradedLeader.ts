// ─── Degraded-mode execution gate — fail-CLOSED single leader (v3.45.0) ──────
//
// WHY THIS FILE EXISTS. Degraded jobs have EXTERNAL side effects (Telegram
// sends, Google Sheets appends, AI spend). If two instances run the same
// degraded job, users get duplicate messages and the Sheets ledger gets
// duplicate rows. `lib/services/leader.ts` cannot be used as-is for this: it
// deliberately FAILS OPEN — `acquireLeaderLock()` (line 128) and `isLeader()`
// (line 258) both return TRUE when the DB is unavailable, on the reasoning that
// cron/work should not halt entirely. That is the right call for scheduling and
// the WRONG call for side-effecting degraded execution: during a plan-limit
// hold EVERY instance would self-elect and every instance would execute.
//
// THE DESIGN IS EVIDENCE-BASED, not speculative. Production logs from
// 2026-10-05 show Prisma leader election working correctly while healthy:
//
//   Leader lock acquired (stale claimed), role=cron-daemon, self=169.254.47.245-9
//   Leader lock held by another instance — standing by, role=worker
//
// So we split by DB availability, which is exactly the axis that decides whether
// the fail-open path is even reachable:
//
//   breaker CLOSED (Prisma healthy)  → TRUST the existing Prisma election.
//     This is the common case: a THRESHOLD-triggered degraded mode (90% of the
//     monthly limit) fires while the database is still perfectly healthy. No new
//     lock, no extra ops, and we inherit a battle-tested implementation.
//
//   breaker OPEN (Prisma unusable)   → the Prisma election is untrustworthy
//     (every instance fail-opens to "leader"). Require an INDEPENDENT lock in
//     Netlify Blobs, and FAIL CLOSED if that is unavailable.
//
// Fail-closed is the whole point: if we cannot prove single-leader, we do not
// execute. A missed job is recoverable (the cron re-fires); a duplicated
// Telegram broadcast is not.

import { randomUUID } from "node:crypto";
import { LEADER_SELF, isLeader, type LeaderRole } from "@/lib/services/leader";
import { isPlanLimitBreakerOpen } from "@/lib/db-utils";
import logger from "@/lib/logger";

/** Separate store from the mirror snapshots so a snapshot upload storm can
 *  never contend with (or evict) the leadership lock. */
const DEGRADED_LEADER_STORE = "degraded-leader-lock";
const DEGRADED_LEADER_KEY = "degraded-leader";

/** Keep in step with leader.ts so a holder is replaced no slower than the
 *  Prisma path would replace a dead leader. */
const LEASE_MS = 10 * 60_000;
/**
 * Re-probe cadence while we believe we hold the lock.
 *
 * This doubles as the fencing-exposure window: if another instance takes the
 * lease over, we may keep executing for up to this long before noticing. Kept
 * at 1 minute — one small conditional write per minute by the single leader is
 * negligible, and it keeps that window far below `LEASE_MS`.
 */
const RENEW_MS = 60_000;
/** When the Blobs store is unavailable, don't hammer it — but retry often
 *  enough that a transient Netlify context miss self-heals. */
const STORE_NEGATIVE_TTL_MS = 30_000;

interface Lease {
  holder: string;
  acquiredAt: number;
  expiresAt: number;
  renewals: number;
}

/** A lease plus the ETag we must present to mutate it. */
interface LeaseEntry {
  value: Lease;
  etag: string;
}

/**
 * The subset of the `@netlify/blobs` store this file uses.
 *
 * CONDITIONAL WRITES ARE THE POINT: `setJSON` accepts `onlyIfNew` / `onlyIfMatch`
 * and reports `modified`, and `getWithMetadata` hands back the current `etag`.
 * That is a genuine compare-and-swap, so a lease claim is atomic even though
 * Blobs offers no dedicated lock primitive (verified against
 * @netlify/blobs@11.0.3 `SetOptions` / `GetWithMetadataOptions`).
 */
interface BlobsStoreLike {
  getWithMetadata(
    key: string,
    options: { type: "json"; consistency: "strong" },
  ): Promise<({ value: unknown } & { etag?: string }) | null>;
  setJSON(
    key: string,
    data: unknown,
    options: { onlyIfNew: true } | { onlyIfMatch: string },
  ): Promise<{ etag?: string; modified: boolean }>;
}

const g = globalThis as unknown as {
  __degradedLeaderStore?: BlobsStoreLike | null;
  __degradedLeaderStoreFailedAt?: number;
  __degradedLease?: Lease;
  __degradedLeaseRenewAt?: number;
  __degradedHolder?: string;
};

/**
 * THIS PROCESS's lease identity — `LEADER_SELF` plus a per-process nonce.
 *
 * `LEADER_SELF` ALONE IS NOT A SAFE LEASE HOLDER, and this was found in the
 * 2026-10-05 production log rather than reasoned about in the abstract.
 * `leader.ts` builds it as `${os.hostname()}-${process.pid}`; on Netlify the
 * hostname is a container IP and the Node process starts at a low pid, so a
 * value like `169.254.7.249-9` is ROUTINE, and container IPs get reused. The
 * log contains two distinct invocations (`2c866912`, `7ea555eb`) reporting the
 * SAME `self=169.254.7.249-9`.
 *
 * A collision defeats the lease in a way CAS provably cannot fix. Both
 * processes read the same live lease; `holder !== LEADER_SELF` is false for each,
 * so neither takes the stand-down branch; each treats the lease as its own
 * renewal and writes with `onlyIfMatch`. Exactly one write wins — but the loser
 * has already populated `g.__degradedLease`, and `canExecuteDegradedWork()` is a
 * purely LOCAL check (`holder === <local id>` && not expired). Both instances
 * would then execute degraded work until the winner's next renewal failed its
 * CAS, i.e. for up to `RENEW_MS`. The failure mode is precisely the one this
 * whole subsystem exists to prevent: duplicated Telegram sends and duplicated
 * Sheets ledger rows.
 *
 * A per-process nonce removes the collision rather than narrowing it: a
 * non-holder's identity can never compare equal, so a colliding neighbour is
 * forced down the stand-down branch. Memoized on `globalThis` so it is stable
 * for the life of the process (a stable id is what makes renewal possible).
 */
function leaseHolderId(): string {
  if (!g.__degradedHolder) g.__degradedHolder = `${LEADER_SELF}#${randomUUID()}`;
  return g.__degradedHolder;
}

async function getStore(): Promise<BlobsStoreLike | null> {
  if (g.__degradedLeaderStore) return g.__degradedLeaderStore;
  const failedAt = g.__degradedLeaderStoreFailedAt ?? 0;
  if (Date.now() - failedAt < STORE_NEGATIVE_TTL_MS) return null;
  try {
    // Lazy dynamic import — same EDGE-SAFETY rule as the mirror store: never
    // import @netlify/blobs at module load (instrumentation pulls this in).
    const mod = (await import("@netlify/blobs")) as unknown as {
      getStore?: (o: { name: string }) => BlobsStoreLike | undefined;
    };
    const store = mod.getStore?.({ name: DEGRADED_LEADER_STORE });
    if (store) {
      g.__degradedLeaderStore = store;
      g.__degradedLeaderStoreFailedAt = 0;
      return store;
    }
    g.__degradedLeaderStoreFailedAt = Date.now();
    return null;
  } catch (err) {
    logger.warn({
      msg: "Degraded leader: Netlify Blobs unavailable",
      error: err instanceof Error ? err.message : String(err),
    });
    g.__degradedLeaderStoreFailedAt = Date.now();
    return null;
  }
}

/**
 * Read the lease AND its ETag at strong consistency.
 *
 * `consistency: "strong"` matters: an eventually-consistent read can return a
 * stale "nobody holds this" and make a second instance believe it may claim, so
 * a stale read could defeat even a conditional write.
 */
async function readLease(store: BlobsStoreLike): Promise<LeaseEntry | null> {
  try {
    const res = await store.getWithMetadata(DEGRADED_LEADER_KEY, {
      type: "json",
      consistency: "strong",
    });
    if (!res || typeof res.value !== "object" || res.value === null) return null;
    const l = res.value as Partial<Lease>;
    if (typeof l.holder !== "string" || typeof l.expiresAt !== "number") return null;
    if (typeof res.etag !== "string" || res.etag.length === 0) return null;
    return {
      etag: res.etag,
      value: {
        holder: l.holder,
        acquiredAt: Number(l.acquiredAt ?? 0),
        expiresAt: l.expiresAt,
        renewals: Number(l.renewals ?? 0),
      },
    };
  } catch (err) {
    // Not swallowed silently: a failing lease store is a degraded condition the
    // operator needs to see. Returning null is still SAFE — the conditional write
    // (`onlyIfNew`) refuses to overwrite an existing key, so a missed read can
    // never turn into a double claim.
    logger.warn({
      msg: "Degraded leader: lease read failed — will attempt conditional claim",
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Atomically write `next` iff the store is still in the state we observed.
 *
 * `onlyIfNew` handles first claim; `onlyIfMatch` handles renew + expired-lease
 * takeover. Both return `modified: false` instead of throwing on conflict, which
 * is the signal we lost the race. This is the ONLY reason the Blobs path can
 * claim single-leader honestly — an unconditional `set` + re-read does not
 * exclude a concurrent claimant.
 */
async function writeLeaseIfUnchanged(
  store: BlobsStoreLike,
  next: Lease,
  observed: LeaseEntry | null,
): Promise<{ ok: boolean; etag?: string }> {
  const result = observed
    ? await store.setJSON(DEGRADED_LEADER_KEY, next, { onlyIfMatch: observed.etag })
    : await store.setJSON(DEGRADED_LEADER_KEY, next, { onlyIfNew: true });
  return { ok: result.modified === true, etag: result.etag };
}

/**
 * Fail-closed Blobs election. Returns true only if we hold a live lease.
 *
 * WHY THIS IS ATOMIC (and why the earlier version was not): the lease is mutated
 * only through a conditional write (`onlyIfNew` / `onlyIfMatch`), so of N
 * instances racing on the same observed ETag exactly ONE gets `modified: true`.
 * The previous unconditional write + re-read was NOT safe — with A writing, A
 * re-reading (sees A), B writing, B re-reading (sees B), both returned true.
 *
 * Residual, and stated rather than hidden: `canExecuteDegradedWork()` trusts a
 * held lease for up to `RENEW_MS` without re-probing, so an instance fenced by a
 * takeover could keep executing for that window. It is bounded and small, and
 * takeover only happens after a full `LEASE_MS` of missed renewals — i.e. after
 * we have already stalled. `RENEW_MS` is kept well under `LEASE_MS` to shrink it.
 */
async function acquireBlobsLease(now: number): Promise<boolean> {
  const store = await getStore();
  if (!store) return false; // fail closed — cannot prove single-leader
  try {
    const observed = await readLease(store);
    const me = leaseHolderId();

    // Someone else holds a LIVE lease → stand down. Comparing against the
    // per-process holder id (not bare LEADER_SELF) is what makes a colliding
    // hostname+pid neighbour stand down instead of renewing — see leaseHolderId().
    if (observed && observed.value.holder !== me && observed.value.expiresAt > now) {
      g.__degradedLease = undefined;
      g.__degradedLeaseRenewAt = 0;
      return false;
    }

    // Either absent, already ours (renew), or expired (takeover).
    const mine = observed?.value.holder === me ? observed.value : null;
    const next: Lease = mine
      ? { ...mine, expiresAt: now + LEASE_MS, renewals: mine.renewals + 1 }
      : { holder: me, acquiredAt: now, expiresAt: now + LEASE_MS, renewals: 0 };

    const written = await writeLeaseIfUnchanged(store, next, observed);
    if (!written.ok) {
      // Lost the CAS to a concurrent claim/takeover — fail closed.
      g.__degradedLease = undefined;
      g.__degradedLeaseRenewAt = 0;
      return false;
    }

    g.__degradedLease = next;
    g.__degradedLeaseRenewAt = now;
    return true;
  } catch (err) {
    logger.warn({
      msg: "Degraded leader: lease acquisition failed — standing down (fail-closed)",
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * May this instance execute side-effecting degraded work right now?
 *
 * `role` is the existing Prisma leader role to piggyback on when the DB is
 * healthy — `"worker"` is the role whose election already gates task execution.
 */
export async function canExecuteDegradedWork(role: LeaderRole = "worker"): Promise<boolean> {
  // While Prisma is healthy, its election is authoritative (and atomic).
  if (!isPlanLimitBreakerOpen()) {
    try {
      return await isLeader(role);
    } catch {
      // isLeader swallows its own errors; a throw here would be a genuine bug.
      return false;
    }
  }

  // Prisma is unusable → its fail-open election is untrustworthy. Demand the
  // independent Blobs lease instead, renewing it on a timer.
  const now = Date.now();
  const renewAt = g.__degradedLeaseRenewAt ?? 0;
  const held = g.__degradedLease?.holder === leaseHolderId() && g.__degradedLease.expiresAt > now;
  if (held && now - renewAt < RENEW_MS) return true;
  return acquireBlobsLease(now);
}

/** Diagnostics for the admin surface. Never throws. */
export async function getDegradedLeaderStatus(): Promise<{
  source: "prisma" | "blobs" | "unavailable";
  holder: string | null;
  self: string;
  leaseExpiresAt: number | null;
  renewals: number;
}> {
  const self = leaseHolderId();
  if (!isPlanLimitBreakerOpen()) {
    try {
      const isLead = await isLeader("worker");
      return {
        source: "prisma",
        holder: isLead ? self : "another-instance",
        self,
        leaseExpiresAt: null,
        renewals: 0,
      };
    } catch {
      /* fall through to unavailable */
    }
  }
  const store = await getStore();
  if (!store) return { source: "unavailable", holder: null, self, leaseExpiresAt: null, renewals: 0 };
  const lease = await readLease(store);
  return {
    source: "blobs",
    holder: lease?.value.holder ?? null,
    self,
    leaseExpiresAt: lease?.value.expiresAt ?? null,
    renewals: lease?.value.renewals ?? 0,
  };
}

/**
 * The exact holder id this process uses for its Blobs lease.
 *
 * Production callers need this to stamp `claimed_by` on the rows they execute,
 * so the recorded owner matches the lease that authorised the work. Named
 * without the `ForTests` suffix because it is a real accessor; the suffixed
 * alias below is kept so existing test call sites are unaffected.
 */
export function degradedLeaseHolder(): string {
  return leaseHolderId();
}

/** Test hook — the exact holder id this process uses for its lease. */
export function degradedLeaseHolderForTests(): string {
  return degradedLeaseHolder();
}

/**
 * Test hook — drop the memoized store, the local lease, AND the per-process
 * holder id. Clearing the holder is what lets one test impersonate two
 * different instances: change `LEADER_SELF`, reset, and a fresh nonce is minted.
 */
export function resetDegradedLeaderForTests(): void {
  g.__degradedLeaderStore = undefined;
  g.__degradedLeaderStoreFailedAt = 0;
  g.__degradedLease = undefined;
  g.__degradedLeaseRenewAt = 0;
  g.__degradedHolder = undefined;
}
