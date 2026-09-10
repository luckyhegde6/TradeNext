/* @jest-environment node */

/**
 * Watchdog self-heal tests (v3.33.0, spec 11) — the REAL leader.ts module with
 * mocked prisma/db-utils/logger, driving the probe + heartbeat loops via modern
 * fake timers.
 *
 * The watchdog (`watchLeaderRole`) replaces the one-shot boot election: a
 * standby watches the leader row on an adaptive cadence (SLOW 300s while
 * another instance holds a FRESH row, FAST 60s once it looks stale/absent),
 * claims the lock as soon as the row dies, and re-claims after losing
 * leadership. Claim success fires `onAcquired`; a lost row fires `onLost` and
 * returns to standby → fast re-probe. DB-unavailable stays fail-open (local
 * leader) and is distinguished from a real claim by re-reading our row
 * (`failOpenEvents`).
 *
 * Fake timers pin the real cadences: probe(0) kicks off immediately, then each
 * probe schedules the next via setTimeout; while leader, the heartbeat
 * setInterval(LEADER_HEARTBEAT_MS = 300s) owns renewal and fires onLost on a
 * 0-count update. `advanceTimersByTimeAsync` is used so promise chains inside
 * the probe/heartbeat resolve between ticks.
 */

jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    workerStatus: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
  },
}));

jest.mock("@/lib/db-utils", () => ({
  isDbUnavailableError: jest.fn(() => false),
}));

jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import prisma from "@/lib/prisma";
import {
  watchLeaderRole,
  getLeaderWatchStatuses,
  LEADER_SELF,
  LEADER_STALENESS_MS,
  LEADER_HEARTBEAT_MS,
  LEADER_CLAIM_FAST_MS,
  LEADER_CLAIM_SLOW_MS,
} from "@/lib/services/leader";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isDbUnavailableError } = require("@/lib/db-utils") as { isDbUnavailableError: jest.Mock };

const mockFindUnique = prisma.workerStatus.findUnique as jest.Mock;
const mockUpdateMany = prisma.workerStatus.updateMany as jest.Mock;
const mockCreate = prisma.workerStatus.create as jest.Mock;

const ourRow = {
  workerId: "leader-worker",
  workerName: LEADER_SELF,
  lastHeartbeat: new Date(),
};

function freshForeignRow() {
  return {
    workerId: "leader-other-host",
    workerName: "other-host-1234",
    lastHeartbeat: new Date(),
  };
}

describe("watchLeaderRole — watchdog self-heal loop (v3.33.0)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    isDbUnavailableError.mockReturnValue(false);
    mockFindUnique.mockReset();
    mockUpdateMany.mockReset();
    mockCreate.mockReset();
    // Fresh per-test watchdog registry (globalThis-backed, like readTier).
    const registry = getLeaderWatchStatuses();
    for (const key of Object.keys(registry)) delete registry[key];
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("stands by (slow probe, zero claims) while another instance holds a FRESH row", async () => {
    mockFindUnique.mockImplementation(() => Promise.resolve(freshForeignRow()));

    const onAcquired = jest.fn();
    const onLost = jest.fn();
    const stop = watchLeaderRole("worker", { onAcquired, onLost });

    // probe(0) → fresh foreign row → schedule slow probe.
    await jest.advanceTimersByTimeAsync(1);
    // 300s later, still fresh → probe again (slow), never touches the lock.
    await jest.advanceTimersByTimeAsync(LEADER_CLAIM_SLOW_MS);
    await jest.advanceTimersByTimeAsync(LEADER_CLAIM_SLOW_MS);

    expect(mockFindUnique.mock.calls.length).toBe(3); // probe @0, @300s, @600s
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(onAcquired).not.toHaveBeenCalled();
    expect(onLost).not.toHaveBeenCalled();
    expect(getLeaderWatchStatuses().worker.phase).toBe("standby");
    expect(getLeaderWatchStatuses().worker.claimAttempts).toBe(0);
    stop();
  });

  it("claims a stale/absent row on the fast path and fires onAcquired once", async () => {
    mockFindUnique
      .mockResolvedValueOnce(null) // probe: no row → claim
      .mockResolvedValueOnce(ourRow); // post-claim check: real claim (ours)
    mockUpdateMany.mockResolvedValueOnce({ count: 1 }); // stale-claim hit

    const onAcquired = jest.fn();
    const onLost = jest.fn();
    const stop = watchLeaderRole("worker", { onAcquired, onLost });

    await jest.advanceTimersByTimeAsync(1);

    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(onAcquired).toHaveBeenCalledTimes(1);
    expect(onAcquired).toHaveBeenCalledWith("worker");
    expect(onLost).not.toHaveBeenCalled();
    expect(getLeaderWatchStatuses().worker.phase).toBe("leader");
    expect(getLeaderWatchStatuses().worker.claimAttempts).toBe(1);
    expect(getLeaderWatchStatuses().worker.failOpenEvents).toBe(0);
    stop();
  });

  it("self-heals after losing leadership: onLost → fast re-probe → re-claim → onAcquired", async () => {
    mockFindUnique
      .mockResolvedValueOnce(null) // probe 1: claim
      .mockResolvedValueOnce(ourRow) // claim check: real claim
      .mockResolvedValueOnce(null) // probe 2 (after loss at 300s + fast 60s)
      .mockResolvedValueOnce(ourRow); // re-claim check
    mockUpdateMany
      .mockResolvedValueOnce({ count: 1 }) // claim 1
      .mockResolvedValueOnce({ count: 0 }) // heartbeat renewal → LOST
      .mockResolvedValueOnce({ count: 1 }); // re-claim 2

    const onAcquired = jest.fn();
    const onLost = jest.fn();
    watchLeaderRole("worker", { onAcquired, onLost });

    await jest.advanceTimersByTimeAsync(1); // claim → leader, heartbeat @300s
    expect(onAcquired).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(LEADER_HEARTBEAT_MS); // renewal count 0 → onLost
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(onLost).toHaveBeenCalledWith("worker");
    expect(getLeaderWatchStatuses().worker.phase).toBe("standby");
    expect(getLeaderWatchStatuses().worker.lastLostAt).not.toBeNull();

    await jest.advanceTimersByTimeAsync(LEADER_CLAIM_FAST_MS); // fast re-probe → re-claim
    expect(mockFindUnique.mock.calls.length).toBe(4);
    expect(onAcquired).toHaveBeenCalledTimes(2); // re-elected
    expect(getLeaderWatchStatuses().worker.phase).toBe("leader");
  });

  it("stays leader while renewals keep succeeding — onAcquired fires exactly once", async () => {
    mockFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(ourRow);
    mockUpdateMany.mockResolvedValue({ count: 1 }); // claim + every renewal

    const onAcquired = jest.fn();
    const onLost = jest.fn();
    const stop = watchLeaderRole("worker", { onAcquired, onLost });

    await jest.advanceTimersByTimeAsync(1);
    expect(onAcquired).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(LEADER_HEARTBEAT_MS); // renewal 1 ok
    await jest.advanceTimersByTimeAsync(LEADER_HEARTBEAT_MS); // renewal 2 ok

    // While leader there are NO probes (heartbeat owns renewal), so findUnique
    // stays at the claim + check and onAcquired never re-fires.
    expect(mockFindUnique.mock.calls.length).toBe(2);
    expect(mockUpdateMany.mock.calls.length).toBe(3); // claim + 2 renewals
    expect(onAcquired).toHaveBeenCalledTimes(1);
    expect(onLost).not.toHaveBeenCalled();
    expect(getLeaderWatchStatuses().worker.phase).toBe("leader");
    stop();
  });

  it("fail-opens to local leader when the DB is unavailable (isDbUnavailableError)", async () => {
    isDbUnavailableError.mockReturnValue(true); // updateMany claim throws P6003
    mockFindUnique.mockRejectedValue(new Error("Plan limit hold")); // probe → null; check → null
    mockUpdateMany.mockRejectedValue(new Error("Plan limit hold"));

    const onAcquired = jest.fn();
    const onLost = jest.fn();
    const stop = watchLeaderRole("worker", { onAcquired, onLost });

    await jest.advanceTimersByTimeAsync(1);

    // Fail-open degrade: leadership assumed locally + the missing row is
    // counted so db-health can show it was NOT a real DB claim.
    expect(onAcquired).toHaveBeenCalledTimes(1);
    expect(getLeaderWatchStatuses().worker.phase).toBe("leader");
    expect(getLeaderWatchStatuses().worker.claimAttempts).toBe(1);
    expect(getLeaderWatchStatuses().worker.failOpenEvents).toBe(1);
    expect(mockCreate).not.toHaveBeenCalled();
    stop();
  });

  it("keeps local leadership through a fail-open renewal; a lost row still fires onLost", async () => {
    mockFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(ourRow);
    mockUpdateMany
      .mockResolvedValueOnce({ count: 1 }) // claim
      .mockRejectedValueOnce(new Error("Plan limit hold")) // renewal 1 → fail-open true
      .mockResolvedValueOnce({ count: 0 }); // renewal 2 → lost
    isDbUnavailableError.mockReturnValue(true);

    const onAcquired = jest.fn();
    const onLost = jest.fn();
    watchLeaderRole("worker", { onAcquired, onLost });

    await jest.advanceTimersByTimeAsync(1);
    expect(onAcquired).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(LEADER_HEARTBEAT_MS);
    // DB-down renewal → stays leader (fail-open degrade), onLost NOT fired.
    expect(onLost).not.toHaveBeenCalled();
    expect(getLeaderWatchStatuses().worker.phase).toBe("leader");

    await jest.advanceTimersByTimeAsync(LEADER_HEARTBEAT_MS);
    // DB back up but the row was taken → renewal returns 0 → onLost → standby.
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(getLeaderWatchStatuses().worker.phase).toBe("standby");
    expect(getLeaderWatchStatuses().worker.lastLostAt).not.toBeNull();
  });

  it("stop() clears both the probe timer and the heartbeat — no further DB calls", async () => {
    mockFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(ourRow);
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });

    const onAcquired = jest.fn();
    const onLost = jest.fn();
    const stop = watchLeaderRole("worker", { onAcquired, onLost });

    await jest.advanceTimersByTimeAsync(1);
    expect(onAcquired).toHaveBeenCalledTimes(1);
    const callsAfterClaim = {
      findUnique: mockFindUnique.mock.calls.length,
      updateMany: mockUpdateMany.mock.calls.length,
    };

    stop();

    await jest.advanceTimersByTimeAsync(600_000);
    expect(mockFindUnique.mock.calls.length).toBe(callsAfterClaim.findUnique);
    expect(mockUpdateMany.mock.calls.length).toBe(callsAfterClaim.updateMany);
    expect(onLost).not.toHaveBeenCalled();
  });

  it("getLeaderWatchStatuses exposes all three role registries (zero Prisma)", () => {
    const stops = [
      watchLeaderRole("worker", {}),
      watchLeaderRole("cron-daemon", {}),
      watchLeaderRole("sqlite-sync", {}),
    ];

    const registry = getLeaderWatchStatuses();
    expect(Object.keys(registry).sort()).toEqual(["cron-daemon", "sqlite-sync", "worker"]);
    for (const role of ["worker", "cron-daemon", "sqlite-sync"] as const) {
      expect(registry[role].role).toBe(role);
      expect(registry[role].phase).toBe("standby");
      expect(registry[role].claimAttempts).toBe(0);
      expect(registry[role].failOpenEvents).toBe(0);
    }
    stops.forEach((s) => s());
  });
});