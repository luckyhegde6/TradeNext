/**
 * Tests for lib/services/leader.ts (v3.22.0) — distributed leader election for
 * the in-process daemon:
 *   - acquireLeaderLock: stale-claim, fresh-create ownership, unique-conflict
 *     standby, DB-unavailable degrade to local leader.
 *   - renewLeaderLock: refreshes heartbeat, stands down if the row was taken.
 *   - releaseLeaderLock: clears only our own row.
 *   - isLeader / getLeaderInfo.
 *
 * IMPORTANT: Do NOT use `import { jest } from "@jest/globals"`. SWC (used by
 * next/jest) requires `jest` to be the global variable for `jest.mock()`
 * hoisting to work correctly.
 */

// ─── Mocks (MUST be before any imports — SWC hoists jest.mock) ─────────

jest.mock("@/lib/logger", () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { __esModule: true, default: mock, info: mock.info, warn: mock.warn, error: mock.error, debug: mock.debug };
});

jest.mock("@/lib/db-utils", () => ({
  __esModule: true,
  isDbUnavailableError: jest.fn(() => false),
}));

jest.mock("@/lib/prisma", () => {
  const mock = {
    workerStatus: {
      updateMany: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };
  return { __esModule: true, default: mock };
});

// ─── Imports ──────────────────────────────────────────────────────────────

import {
  acquireLeaderLock,
  renewLeaderLock,
  releaseLeaderLock,
  isLeader,
  getLeaderInfo,
  leaderWorkerId,
  LEADER_SELF,
  LEADER_STALENESS_MS,
} from "@/lib/services/leader";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const prisma = require("@/lib/prisma").default as Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isDbUnavailableError } = require("@/lib/db-utils") as { isDbUnavailableError: jest.Mock };

describe("leaderWorkerId / constants", () => {
  it("maps a role to a stable single-writer workerId", () => {
    expect(leaderWorkerId("worker")).toBe("leader-worker");
    expect(leaderWorkerId("cron-daemon")).toBe("leader-cron-daemon");
    expect(leaderWorkerId("sqlite-sync")).toBe("leader-sqlite-sync");
  });

  it("exposes host-pid self identifier and staleness window", () => {
    expect(typeof LEADER_SELF).toBe("string");
    expect(LEADER_SELF).toContain("-");
    expect(LEADER_STALENESS_MS).toBe(5 * 60_000);
  });
});

describe("acquireLeaderLock", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isDbUnavailableError.mockReturnValue(false);
  });

  it("acquires by claiming an existing stale (expired) lock", async () => {
    prisma.workerStatus.updateMany.mockResolvedValue({ count: 1 });
    prisma.workerStatus.create.mockResolvedValue({ id: "x" });

    const result = await acquireLeaderLock("worker");

    expect(result).toBe(true);
    expect(prisma.workerStatus.updateMany).toHaveBeenCalledTimes(1);
    const where = prisma.workerStatus.updateMany.mock.calls[0][0].where;
    expect(where.workerId).toBe("leader-worker");
    expect(where.lastHeartbeat.lt).toBeInstanceOf(Date);
    // We should NOT have fallen through to create once the stale claim hit.
    expect(prisma.workerStatus.create).not.toHaveBeenCalled();
  });

  it("acquires by creating a fresh lock when no stale row exists", async () => {
    prisma.workerStatus.updateMany.mockResolvedValue({ count: 0 });
    prisma.workerStatus.create.mockResolvedValue({ id: "new" });

    const result = await acquireLeaderLock("cron-daemon");

    expect(result).toBe(true);
    expect(prisma.workerStatus.create).toHaveBeenCalledTimes(1);
    const data = prisma.workerStatus.create.mock.calls[0][0].data;
    expect(data.workerId).toBe("leader-cron-daemon");
    expect(data.workerName).toBe(LEADER_SELF);
  });

  it("stands by when another instance holds a fresh lock (unique conflict P2002)", async () => {
    prisma.workerStatus.updateMany.mockResolvedValue({ count: 0 });
    prisma.workerStatus.create.mockRejectedValue({ code: "P2002" });

    const result = await acquireLeaderLock("sqlite-sync");

    expect(result).toBe(false);
  });

  it("rethrows non-conflict create errors that are not DB-unavailable", async () => {
    prisma.workerStatus.updateMany.mockResolvedValue({ count: 0 });
    const boom = new Error("validation failed");
    prisma.workerStatus.create.mockRejectedValue(boom);
    isDbUnavailableError.mockReturnValue(false);

    await expect(acquireLeaderLock("worker")).rejects.toThrow("validation failed");
  });

  it("degrades to local leader when the DB is unavailable (fail-open)", async () => {
    prisma.workerStatus.updateMany.mockRejectedValue({ code: "P6003" });
    isDbUnavailableError.mockReturnValue(true);

    const result = await acquireLeaderLock("worker");

    expect(result).toBe(true);
  });

  it("returns false when a non-DB generic error escapes election", async () => {
    prisma.workerStatus.updateMany.mockRejectedValue(new Error("boom"));
    isDbUnavailableError.mockReturnValue(false);

    const result = await acquireLeaderLock("worker");

    expect(result).toBe(false);
  });
});

describe("renewLeaderLock", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns true when it refreshed its own heartbeat", async () => {
    prisma.workerStatus.updateMany.mockResolvedValue({ count: 1 });

    const result = await renewLeaderLock("worker");

    expect(result).toBe(true);
    const where = prisma.workerStatus.updateMany.mock.calls[0][0].where;
    expect(where.workerId).toBe("leader-worker");
    expect(where.workerName).toBe(LEADER_SELF);
  });

  it("stands down when the row was taken by someone else (0 matches)", async () => {
    prisma.workerStatus.updateMany.mockResolvedValue({ count: 0 });

    const result = await renewLeaderLock("worker");

    expect(result).toBe(false);
  });

  it("keeps local leadership when the DB is down (fail-open)", async () => {
    prisma.workerStatus.updateMany.mockRejectedValue({ code: "P6003" });
    isDbUnavailableError.mockReturnValue(true);

    const result = await renewLeaderLock("worker");

    expect(result).toBe(true);
  });
});

describe("releaseLeaderLock", () => {
  beforeEach(() => jest.clearAllMocks());

  it("clears only the row that belongs to us", async () => {
    prisma.workerStatus.deleteMany.mockResolvedValue({ count: 1 });

    await releaseLeaderLock("worker");

    const where = prisma.workerStatus.deleteMany.mock.calls[0][0].where;
    expect(where.workerId).toBe("leader-worker");
    expect(where.workerName).toBe(LEADER_SELF);
  });

  it("does not throw when the DB is unavailable", async () => {
    prisma.workerStatus.deleteMany.mockRejectedValue({ code: "P6003" });
    isDbUnavailableError.mockReturnValue(true);

    await expect(releaseLeaderLock("worker")).resolves.toBeUndefined();
  });
});

describe("isLeader", () => {
  beforeEach(() => jest.clearAllMocks());

  it("is true when the row belongs to us", async () => {
    prisma.workerStatus.findUnique.mockResolvedValue({ workerId: "leader-worker", workerName: LEADER_SELF });

    const result = await isLeader("worker");

    expect(result).toBe(true);
  });

  it("is false when another instance leads", async () => {
    prisma.workerStatus.findUnique.mockResolvedValue({ workerId: "leader-worker", workerName: "some-other-host-999" });

    const result = await isLeader("worker");

    expect(result).toBe(false);
  });

  it("is true on DB-unavailable (degraded local leadership)", async () => {
    prisma.workerStatus.findUnique.mockRejectedValue({ code: "P6003" });
    isDbUnavailableError.mockReturnValue(true);

    const result = await isLeader("worker");

    expect(result).toBe(true);
  });
});

describe("getLeaderInfo", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the leader row for diagnostics", async () => {
    const row = { workerId: "leader-cron-daemon", workerName: LEADER_SELF, lastHeartbeat: new Date() };
    prisma.workerStatus.findUnique.mockResolvedValue(row);

    const info = await getLeaderInfo("cron-daemon");

    expect(info).toEqual(row);
    expect(prisma.workerStatus.findUnique).toHaveBeenCalledWith({ where: { workerId: "leader-cron-daemon" } });
  });

  it("returns null when there is no leader or the read fails", async () => {
    prisma.workerStatus.findUnique.mockResolvedValue(null);
    expect(await getLeaderInfo("sqlite-sync")).toBeNull();

    prisma.workerStatus.findUnique.mockRejectedValue(new Error("x"));
    expect(await getLeaderInfo("sqlite-sync")).toBeNull();
  });
});