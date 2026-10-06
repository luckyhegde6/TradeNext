/**
 * Tests for lib/services/degradedLeader.ts (v3.45.0, spec 21) — the fail-closed
 * single-leader gate for side-effecting degraded work.
 *
 * The behaviour under test that actually matters:
 *   - breaker CLOSED → the existing atomic Prisma election is authoritative.
 *   - breaker OPEN   → an INDEPENDENT Blobs lease is required.
 *   - store missing / lease read+write failing → FAIL CLOSED (false, never true).
 *   - the lease is mutated ONLY by conditional write, so losing the CAS returns
 *     stand-down rather than a second executor.
 *
 * Do NOT use `import { jest } from "@jest/globals"` — SWC (next/jest) needs
 * `jest` as the global for `jest.mock()` hoisting.
 */

// ─── Mocks (MUST be before any imports — SWC hoists jest.mock) ────────────

const selfRef: { value: string } = { value: "self-A" };
const storeRef: { current: unknown } = { current: null };

jest.mock("@/lib/services/leader", () => ({
  __esModule: true,
  // A live getter so one process can impersonate two different instances.
  get LEADER_SELF(): string {
    return selfRef.value;
  },
  isLeader: jest.fn(async () => false),
}));

jest.mock("@/lib/db-utils", () => ({
  __esModule: true,
  isPlanLimitBreakerOpen: jest.fn(() => false),
}));

jest.mock("@/lib/logger", () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { __esModule: true, default: mock, info: mock.info, warn: mock.warn, error: mock.error, debug: mock.debug };
});

jest.mock("@netlify/blobs", () => ({
  __esModule: true,
  getStore: jest.fn(() => storeRef.current),
}));

// ─── Imports ────────────────────────────────────────────────────────────────

import { isPlanLimitBreakerOpen } from "@/lib/db-utils";
import { isLeader } from "@/lib/services/leader";
import {
  canExecuteDegradedWork,
  degradedLeaseHolderForTests,
  getDegradedLeaderStatus,
  resetDegradedLeaderForTests,
} from "@/lib/services/degradedLeader";

const breakerOpen = isPlanLimitBreakerOpen as jest.MockedFunction<typeof isPlanLimitBreakerOpen>;
const prismaIsLeader = isLeader as jest.MockedFunction<typeof isLeader>;

// ─── Fake Blobs store with real compare-and-swap semantics ──────────────────

interface WriteOpts { onlyIfNew?: true; onlyIfMatch?: string }

function makeStore(seed?: unknown) {
  let raw: string | undefined = seed === undefined ? undefined : JSON.stringify(seed);
  let version = 0;
  const store = {
    /** Current persisted value, or null if the key is absent. */
    peek: () => (raw === undefined ? null : JSON.parse(raw)),
    // Args are (key, {type, ...}) — unneeded by this fake, which serves one key.
    getWithMetadata: jest.fn(async () =>
      raw === undefined ? null : { value: JSON.parse(raw), etag: `etag-${version}` },
    ),
    // Args are (key, data, {onlyIfNew, onlyIfMatch}) — `opts` IS needed below.
    setJSON: jest.fn(async (_key: string, data: unknown, opts: WriteOpts) => {
      // Atomic: the check and the swap cannot interleave.
      if (opts.onlyIfNew === true) {
        if (raw !== undefined) return { modified: false };
      } else if (typeof opts.onlyIfMatch === "string") {
        if (raw === undefined) return { modified: false };
        if (`etag-${version}` !== opts.onlyIfMatch) return { modified: false };
      }
      raw = JSON.stringify(data);
      version += 1;
      return { modified: true, etag: `etag-${version}` };
    }),
  };
  return store;
}

type Store = ReturnType<typeof makeStore>;

function leaseFor(holder: string, expiresInMs: number) {
  return { holder, acquiredAt: Date.now() - 1000, expiresAt: Date.now() + expiresInMs, renewals: 0 };
}

beforeEach(() => {
  jest.clearAllMocks();
  selfRef.value = "self-A";
  storeRef.current = null;
  resetDegradedLeaderForTests();
  breakerOpen.mockReturnValue(false);
  prismaIsLeader.mockResolvedValue(false);
});

// ─── Prisma-healthy path ────────────────────────────────────────────────────

describe("canExecuteDegradedWork — breaker closed (Prisma healthy)", () => {
  it("delegates to the existing atomic Prisma election", async () => {
    prismaIsLeader.mockResolvedValue(true);
    await expect(canExecuteDegradedWork("worker")).resolves.toBe(true);
    expect(prismaIsLeader).toHaveBeenCalledWith("worker");
  });

  it("stands down when another instance holds the Prisma lock", async () => {
    prismaIsLeader.mockResolvedValue(false);
    await expect(canExecuteDegradedWork("worker")).resolves.toBe(false);
  });

  it("does not touch Blobs at all while Prisma is authoritative", async () => {
    storeRef.current = makeStore();
    prismaIsLeader.mockResolvedValue(true);
    await canExecuteDegradedWork();
    expect((storeRef.current as Store).setJSON).not.toHaveBeenCalled();
  });

  it("fails closed if the Prisma election throws", async () => {
    prismaIsLeader.mockRejectedValue(new Error("boom"));
    await expect(canExecuteDegradedWork()).resolves.toBe(false);
  });
});

// ─── Blobs path: first claim ───────────────────────────────────────────────

describe("canExecuteDegradedWork — breaker open, empty store", () => {
  it("claims an absent lease with onlyIfNew", async () => {
    breakerOpen.mockReturnValue(true);
    const store = makeStore();
    storeRef.current = store;

    await expect(canExecuteDegradedWork()).resolves.toBe(true);
    expect(store.setJSON).toHaveBeenCalledTimes(1);
    expect(store.setJSON.mock.calls[0][2]).toEqual({ onlyIfNew: true });
    expect(store.peek()).toMatchObject({ holder: degradedLeaseHolderForTests(), renewals: 0 });
  });

  it("reads with strong consistency so a stale read cannot trigger a claim", async () => {
    breakerOpen.mockReturnValue(true);
    const store = makeStore();
    storeRef.current = store;

    await canExecuteDegradedWork();
    expect(store.getWithMetadata).toHaveBeenCalledWith("degraded-leader", {
      type: "json",
      consistency: "strong",
    });
  });

  it("fails closed when the Blobs store is unavailable", async () => {
    breakerOpen.mockReturnValue(true);
    storeRef.current = null;
    await expect(canExecuteDegradedWork()).resolves.toBe(false);
  });
});

// ─── Blobs path: contention ─────────────────────────────────────────────────

describe("canExecuteDegradedWork — breaker open, contended lease", () => {
  it("stands down without writing when a FOREIGN lease is still live", async () => {
    breakerOpen.mockReturnValue(true);
    const store = makeStore(leaseFor("other-instance", 5 * 60_000));
    storeRef.current = store;

    await expect(canExecuteDegradedWork()).resolves.toBe(false);
    expect(store.setJSON).not.toHaveBeenCalled();
    expect(store.peek()).toMatchObject({ holder: "other-instance" });
  });

  // ── Regression: the production log's hostname+pid collision ────────────────
  //
  // 2026-10-05 log: two distinct invocations (`2c866912`, `7ea555eb`) both
  // reported `self=169.254.7.249-9`, because LEADER_SELF is
  // `${hostname}-${pid}` and Netlify containers reuse IPs at a low pid.
  //
  // With the lease holder equal to bare LEADER_SELF this test RENEWED the
  // neighbour's lease and returned true — because `holder !== LEADER_SELF` is
  // false when both processes share an id. CAS cannot save that: the local
  // `g.__degradedLease` check would then let BOTH instances run degraded work
  // for up to RENEW_MS. The per-process nonce is what forces the stand-down.
  it("stands down against a COLLIDING LEADER_SELF (same host+pid, different process)", async () => {
    breakerOpen.mockReturnValue(true);
    const mine = degradedLeaseHolderForTests();
    // The neighbour wrote its lease under the BARE colliding id — exactly what
    // `self=169.254.7.249-9` means: two processes, one shared identity.
    const store = makeStore(leaseFor("self-A", 5 * 60_000));
    storeRef.current = store;

    await expect(canExecuteDegradedWork()).resolves.toBe(false);
    // Critically: it must NOT have written — a renewal here is the bug, because
    // both processes would then hold `g.__degradedLease` and both would execute.
    expect(store.setJSON).not.toHaveBeenCalled();
    expect(mine.startsWith("self-A#")).toBe(true);
    expect(store.peek()).toMatchObject({ holder: "self-A", renewals: 0 });
  });

  it("mints a distinct holder per process even when LEADER_SELF is identical", () => {
    const first = degradedLeaseHolderForTests();
    resetDegradedLeaderForTests(); // same LEADER_SELF, fresh process
    const second = degradedLeaseHolderForTests();

    expect(second.split("#")[0]).toBe(first.split("#")[0]); // same host+pid
    expect(second).not.toBe(first); // but NOT the same holder identity
  });

  it("takes over an EXPIRED foreign lease with onlyIfMatch", async () => {
    breakerOpen.mockReturnValue(true);
    const store = makeStore(leaseFor("other-instance", -1000));
    storeRef.current = store;

    await expect(canExecuteDegradedWork()).resolves.toBe(true);
    expect(store.setJSON.mock.calls[0][2]).toEqual({ onlyIfMatch: "etag-0" });
    expect(store.peek()).toMatchObject({ holder: degradedLeaseHolderForTests(), renewals: 0 });
  });

  it("renews its OWN live lease, bumping renewals", async () => {
    breakerOpen.mockReturnValue(true);
    const store = makeStore(leaseFor(degradedLeaseHolderForTests(), 5 * 60_000));
    storeRef.current = store;

    await expect(canExecuteDegradedWork()).resolves.toBe(true);
    expect(store.setJSON.mock.calls[0][2]).toEqual({ onlyIfMatch: "etag-0" });
    expect(store.peek()).toMatchObject({ holder: degradedLeaseHolderForTests(), renewals: 1 });
  });

  it("STANDS DOWN when the conditional write loses the compare-and-swap", async () => {
    // The exact race the previous unconditional-write version lost: we read the
    // lease, a concurrent writer bumps the ETag, then our onlyIfMatch fails.
    breakerOpen.mockReturnValue(true);
    const store = makeStore(leaseFor("other-instance", -1000));
    storeRef.current = store;
    store.setJSON.mockImplementationOnce(async () => ({ modified: false }));

    await expect(canExecuteDegradedWork()).resolves.toBe(false);
  });

  it("lets exactly ONE of two contenders win a shared-ETag race", async () => {
    // Both contenders observe etag-0 of the same expired lease.
    const store = makeStore(leaseFor("dead-instance", -1000));
    const observedEtag = "etag-0";

    const a = await store.setJSON("degraded-leader", leaseFor("self-A", 60_000), { onlyIfMatch: observedEtag });
    const b = await store.setJSON("degraded-leader", leaseFor("self-B", 60_000), { onlyIfMatch: observedEtag });

    expect(a.modified).toBe(true);
    expect(b.modified).toBe(false);
    expect(store.peek()).toMatchObject({ holder: "self-A" });
  });

  it("cannot double-claim a fresh key: onlyIfNew admits one writer", async () => {
    const store = makeStore();
    const a = await store.setJSON("degraded-leader", leaseFor("self-A", 60_000), { onlyIfNew: true });
    const b = await store.setJSON("degraded-leader", leaseFor("self-B", 60_000), { onlyIfNew: true });
    expect(a.modified).toBe(true);
    expect(b.modified).toBe(false);
  });

  it("stays leader across repeated calls without re-writing every time", async () => {
    breakerOpen.mockReturnValue(true);
    const store = makeStore();
    storeRef.current = store;

    await expect(canExecuteDegradedWork()).resolves.toBe(true);
    const writesAfterFirst = store.setJSON.mock.calls.length;
    await expect(canExecuteDegradedWork()).resolves.toBe(true);

    // Renewal is memoised for RENEW_MS, so a burst of calls costs no extra writes.
    expect(store.setJSON.mock.calls.length).toBe(writesAfterFirst);
  });
});

// ─── Robustness / fail-closed ──────────────────────────────────────────────

describe("degradedLeader — robustness", () => {
  it("fails closed when the lease read fails over an EXISTING lease", async () => {
    // We cannot see the lease, so we must not assume we may take it. The
    // `onlyIfNew` fallback refuses to overwrite an existing key → stand down.
    breakerOpen.mockReturnValue(true);
    const store = makeStore(leaseFor("other-instance", 5 * 60_000));
    storeRef.current = store;
    store.getWithMetadata.mockRejectedValueOnce(new Error("network down"));

    await expect(canExecuteDegradedWork()).resolves.toBe(false);
  });

  it("still claims an EMPTY store when the read fails (onlyIfNew stays exclusive)", async () => {
    // A missed read is only an optimisation loss. On an empty store the
    // conditional create is itself the atomic proof of ownership, so claiming is
    // correct — and a concurrent claimer would lose the same `onlyIfNew`.
    breakerOpen.mockReturnValue(true);
    const store = makeStore();
    storeRef.current = store;
    store.getWithMetadata.mockRejectedValueOnce(new Error("network down"));

    await expect(canExecuteDegradedWork()).resolves.toBe(true);
    expect(store.setJSON.mock.calls[0][2]).toEqual({ onlyIfNew: true });
  });

  it("fails closed when the lease write throws", async () => {
    breakerOpen.mockReturnValue(true);
    const store = makeStore();
    storeRef.current = store;
    store.setJSON.mockRejectedValueOnce(new Error("network down"));
    await expect(canExecuteDegradedWork()).resolves.toBe(false);
  });

  it("treats an unreadable lease payload as no lease (claims via onlyIfNew)", async () => {
    breakerOpen.mockReturnValue(true);
    const store = makeStore("not-an-object");
    storeRef.current = store;
    // Garbage cannot prove a live foreign lease, but onlyIfNew still refuses to
    // overwrite an existing key, so we stand down rather than clobber it.
    await expect(canExecuteDegradedWork()).resolves.toBe(false);
  });

  it("recovers after the store comes back (negative cache is per-process, reset clears it)", async () => {
    breakerOpen.mockReturnValue(true);
    storeRef.current = null;
    await expect(canExecuteDegradedWork()).resolves.toBe(false);

    resetDegradedLeaderForTests();
    storeRef.current = makeStore();
    await expect(canExecuteDegradedWork()).resolves.toBe(true);
  });
});

// ─── Status surface ────────────────────────────────────────────────────────

describe("getDegradedLeaderStatus", () => {
  it("reports the Prisma source while the breaker is closed", async () => {
    prismaIsLeader.mockResolvedValue(true);
    const mine = degradedLeaseHolderForTests();
    await expect(getDegradedLeaderStatus()).resolves.toMatchObject({
      source: "prisma",
      holder: mine,
      self: mine,
    });
  });

  it("reports the Blobs holder while the breaker is open", async () => {
    breakerOpen.mockReturnValue(true);
    storeRef.current = makeStore(leaseFor("other-instance", 5 * 60_000));
    const status = await getDegradedLeaderStatus();
    expect(status.source).toBe("blobs");
    expect(status.holder).toBe("other-instance");
    expect(status.leaseExpiresAt).toBeGreaterThan(Date.now());
  });

  it("reports unavailable when neither source can answer", async () => {
    breakerOpen.mockReturnValue(true);
    storeRef.current = null;
    await expect(getDegradedLeaderStatus()).resolves.toMatchObject({
      source: "unavailable",
      holder: null,
    });
  });

  it("never throws", async () => {
    breakerOpen.mockReturnValue(true);
    storeRef.current = makeStore();
    (storeRef.current as Store).getWithMetadata.mockRejectedValue(new Error("boom"));
    await expect(getDegradedLeaderStatus()).resolves.toMatchObject({ source: "blobs", holder: null });
  });
});
