/* @jest-environment node */

/**
 * Route-level tests for GET /api/admin/cron/daemon (v3.37.0, issue #119 Fix 5).
 *
 * The endpoint reports cron-daemon liveness to the admin Cron tab. Besides the
 * in-memory daemon status it cross-checks the persisted worker_status heartbeat
 * rows — the daemon's OWN row (DAEMON_ID) AND the shared leader-cron-daemon
 * row — because in Turbopack dev the instrumentation entry and this route can
 * be separate module graphs (in-memory state reads "not running" while the real
 * daemon is alive). Running = in-memory running || fresh own heartbeat || fresh
 * leader row.
 *
 * deps are mocked; only the route plumbing is exercised. NextResponse requires
 * the node environment.
 */

import { GET } from "@/app/api/admin/cron/daemon/route";
import { auth } from "@/lib/auth";
import {
  getCronDaemonStatus,
  isDaemonHeartbeatFresh,
  DAEMON_ID,
} from "@/lib/services/worker/cron-daemon";
import { leaderWorkerId, LEADER_STALENESS_MS } from "@/lib/services/leader";

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
  },
}));
jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    workerStatus: {
      findUnique: jest.fn(),
    },
  },
}));
jest.mock("@/lib/services/worker/cron-daemon", () => ({
  __esModule: true,
  getCronDaemonStatus: jest.fn(),
  isDaemonHeartbeatFresh: jest.fn(),
  DAEMON_ID: "cron-daemon-test-host-123",
}));
jest.mock("@/lib/services/leader", () => ({
  __esModule: true,
  leaderWorkerId: jest.fn((role: string) => `leader-${role}`),
  LEADER_STALENESS_MS: 10 * 60_000,
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const prisma = require("@/lib/prisma").default as Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getCronDaemonStatus: mockGetCronDaemonStatus, isDaemonHeartbeatFresh: mockIsDaemonHeartbeatFresh } =
  require("@/lib/services/worker/cron-daemon") as {
    getCronDaemonStatus: jest.Mock;
    isDaemonHeartbeatFresh: jest.Mock;
  };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { leaderWorkerId: mockLeaderWorkerId } = require("@/lib/services/leader") as {
  leaderWorkerId: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  // Admin by default; override in the unauthorized test.
  (auth as jest.Mock).mockResolvedValue({ user: { id: "admin-1", role: "admin" } });
  mockGetCronDaemonStatus.mockReturnValue({ running: false, lastHeartbeatAt: null });
  // Age-based freshness mirroring the real check: a heartbeat present and
  // younger than the staleness window is "fresh".
  mockIsDaemonHeartbeatFresh.mockImplementation((d?: Date | null) => {
    if (d == null) return false;
    return Date.now() - d.getTime() < LEADER_STALENESS_MS;
  });
  prisma.workerStatus.findUnique.mockResolvedValue(null);
});

describe("GET /api/admin/cron/daemon (v3.37.0 Fix 5)", () => {
  test("rejects non-admin sessions with 401", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "u1", role: "user" } });

    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mockGetCronDaemonStatus).not.toHaveBeenCalled();
  });

  test("running = true when the daemon's OWN heartbeat row is fresh", async () => {
    const ownBeat = new Date();
    prisma.workerStatus.findUnique
      .mockResolvedValueOnce({ lastHeartbeat: ownBeat }) // DAEMON_ID row
      .mockResolvedValueOnce(null); // leader row

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    // Both rows are probed: own + shared leader (v3.37.0).
    expect(prisma.workerStatus.findUnique).toHaveBeenNthCalledWith(1, {
      where: { workerId: DAEMON_ID },
    });
    expect(mockLeaderWorkerId).toHaveBeenCalledWith("cron-daemon");
    expect(prisma.workerStatus.findUnique).toHaveBeenNthCalledWith(2, {
      where: { workerId: "leader-cron-daemon" },
    });

    expect(body.running).toBe(true);
    expect(body.lastHeartbeatAt).toEqual(ownBeat.toISOString());
    expect(body.lastHeartbeatAgeMs).toBeGreaterThanOrEqual(0);
  });

  test("leader-row cross-check: fresh shared leader row proves liveness even when own row is absent/stale", async () => {
    // Own row absent, leader row fresh → running true (split module graph case).
    const leaderBeat = new Date();
    prisma.workerStatus.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      lastHeartbeat: leaderBeat,
    });

    let body = await (await GET()).json();
    expect(body.running).toBe(true);
    expect(body.lastHeartbeatAt).toEqual(leaderBeat.toISOString());

    // Leader row now stale (past LEADER_STALENESS_MS) → running false.
    prisma.workerStatus.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      lastHeartbeat: new Date(Date.now() - LEADER_STALENESS_MS - 5_000),
    });
    body = await (await GET()).json();
    expect(body.running).toBe(false);
    expect(body.lastHeartbeatAgeMs).toBeGreaterThan(LEADER_STALENESS_MS);
  });

  test("running = false when all sources are stale/absent (no false positive)", async () => {
    const staleBeat = new Date(Date.now() - LEADER_STALENESS_MS - 60_000);
    prisma.workerStatus.findUnique
      .mockResolvedValueOnce(null) // own row absent
      .mockResolvedValueOnce({ lastHeartbeat: staleBeat }); // leader row stale

    const body = await (await GET()).json();
    expect(body.running).toBe(false);
    // The stale row still surfaces as metadata (honest), it just must not
    // flip running.
    expect(body.lastHeartbeatAt).toEqual(staleBeat.toISOString());
    expect(body.lastHeartbeatAgeMs).toBeGreaterThan(LEADER_STALENESS_MS);
  });
});