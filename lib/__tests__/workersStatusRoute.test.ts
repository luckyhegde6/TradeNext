/* @jest-environment node */

/**
 * Admin workers/status route (BUGS 17).
 *
 * GET was Prisma-only: under the P6003 plan-limit hold it 500'd every 10s poll,
 * spamming the admin Workers tab. It must now (a) require an admin session,
 * (b) fall back to the SQLite `worker_status` mirror (raw snake_case), and
 * (c) keep the 5-minute staleness filter. POST (heartbeat, previously open) now
 * also requires an admin session. deps are mocked; the route plumbing is real.
 */

import { GET, POST } from "@/app/api/admin/workers/status/route";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getSqliteFallback } from "@/lib/sqlite";

jest.mock("@/lib/auth", () => ({ __esModule: true, auth: jest.fn() }));
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
    workerStatus: { findMany: jest.fn(), upsert: jest.fn() },
  },
}));
jest.mock("@/lib/sqlite", () => ({ __esModule: true, getSqliteFallback: jest.fn() }));

const mockFindMany = (prisma as unknown as { workerStatus: { findMany: jest.Mock } }).workerStatus
  .findMany;
const mockUpsert = (prisma as unknown as { workerStatus: { upsert: jest.Mock } }).workerStatus.upsert;
const mockGetSqliteFallback = getSqliteFallback as jest.Mock;

const holdError = Object.assign(
  new Error("There is a hold on your account. Reason: planLimitReached."),
  { code: "P6003" }
);

const now = Date.now();
const freshMs = now - 30_000;
const staleMs = now - 10 * 60_000;

function sqliteWith(rows: Array<Record<string, unknown>>) {
  mockGetSqliteFallback.mockReturnValue({
    isReady: () => true,
    getWorkerStatuses: () => rows,
  });
}

const req = (qs = "") => new Request(`http://localhost/api/admin/workers/status${qs}`) as never;

describe("GET /api/admin/workers/status (BUGS 17)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth as jest.Mock).mockResolvedValue({ user: { id: "admin-1", role: "admin" } });
    sqliteWith([]);
  });

  test("rejects unauthenticated callers with 401 (no DB read)", async () => {
    (auth as jest.Mock).mockResolvedValue(null);

    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockGetSqliteFallback).not.toHaveBeenCalled();
  });

  test("rejects non-admin sessions with 401", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "u1", role: "user" } });

    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  test("healthy Prisma → filters out stale workers by default", async () => {
    mockFindMany.mockResolvedValue([
      { workerId: "worker-a", lastHeartbeat: new Date(freshMs) },
      { workerId: "worker-old", lastHeartbeat: new Date(staleMs) },
    ]);

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((w: { workerId: string }) => w.workerId)).toEqual(["worker-a"]);
    expect(mockGetSqliteFallback).not.toHaveBeenCalled();
  });

  test("includeOffline=true keeps stale workers", async () => {
    mockFindMany.mockResolvedValue([
      { workerId: "worker-a", lastHeartbeat: new Date(freshMs) },
      { workerId: "worker-old", lastHeartbeat: new Date(staleMs) },
    ]);

    const res = await GET(req("?includeOffline=true"));
    const body = await res.json();
    expect(body).toHaveLength(2);
  });

  test("P6003 hold → 200 from the mirror with snake_case mapped to camelCase", async () => {
    mockFindMany.mockRejectedValue(holdError);
    sqliteWith([
      {
        id: 1,
        worker_id: "worker-a",
        worker_name: "Alpha",
        status: "idle",
        current_task_id: null,
        cpu_usage: 4.5,
        memory_usage: null,
        last_heartbeat: new Date(freshMs).toISOString(),
      },
      {
        id: 2,
        worker_id: "worker-old",
        worker_name: "Zombie",
        status: "offline",
        last_heartbeat: new Date(staleMs).toISOString(),
      },
    ]);

    const res = await GET(req());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(1); // stale one filtered even on the mirror path
    expect(body[0]).toEqual({
      id: 1,
      workerId: "worker-a",
      workerName: "Alpha",
      status: "idle",
      currentTaskId: null,
      cpuUsage: 4.5,
      memoryUsage: null,
      lastHeartbeat: new Date(freshMs).toISOString(),
    });
    expect(body[0]).not.toHaveProperty("worker_id");
    expect(body[0]).not.toHaveProperty("last_heartbeat");
  });

  test("P6003 hold with the mirror unavailable → 200 [] (never a 500)", async () => {
    mockFindMany.mockRejectedValue(holdError);
    mockGetSqliteFallback.mockReturnValue(null);

    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("a non-hold DB error still surfaces as 500", async () => {
    mockFindMany.mockRejectedValue(new Error("syntax error near FROM"));

    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to fetch workers" });
    expect(mockGetSqliteFallback).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/workers/status (BUGS 17)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth as jest.Mock).mockResolvedValue({ user: { id: "admin-1", role: "admin" } });
  });

  test("rejects unauthenticated heartbeats with 401 (previously open)", async () => {
    (auth as jest.Mock).mockResolvedValue(null);

    const res = await POST(
      new Request("http://localhost/api/admin/workers/status", {
        method: "POST",
        body: JSON.stringify({ workerId: "w1", status: "idle" }),
      }) as never,
    );
    expect(res.status).toBe(401);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  test("admin heartbeat upserts and returns 200", async () => {
    mockUpsert.mockResolvedValue({ workerId: "w1", status: "idle" });

    const res = await POST(
      new Request("http://localhost/api/admin/workers/status", {
        method: "POST",
        body: JSON.stringify({ workerId: "w1", status: "idle", cpuUsage: 3 }),
      }) as never,
    );

    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert.mock.calls[0][0].where).toEqual({ workerId: "w1" });
  });

  test("invalid heartbeat payload → 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/admin/workers/status", {
        method: "POST",
        body: JSON.stringify({ workerId: "w1", status: "nonsense" }),
      }) as never,
    );
    expect(res.status).toBe(400);
  });
});
