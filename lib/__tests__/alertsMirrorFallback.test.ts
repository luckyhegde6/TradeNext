/* @jest-environment node */

/**
 * Alerts route mirror fallback + crash guard (BUGS 15).
 *
 * Under the P6003 plan-limit hold GET /api/alerts used to bubble a 500, and the
 * page then called `.filter` on a non-array (Error Boundary — Lessons 130).
 * Reads must now fall back to the SQLite `alert` mirror, scoped to the session
 * user. deps are mocked; the route plumbing is real.
 */

import { GET } from "@/app/api/alerts/route";
import { auth } from "@/lib/auth";
import { getUserAlerts, getAlertCount } from "@/lib/services/alertService";
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
jest.mock("@/lib/services/alertService", () => ({
  __esModule: true,
  createAlert: jest.fn(),
  getUserAlerts: jest.fn(),
  markAlertSeen: jest.fn(),
  markAllAlertsSeen: jest.fn(),
  deleteAlert: jest.fn(),
  getAlertCount: jest.fn(),
  updateAlert: jest.fn(),
}));
jest.mock("@/lib/audit", () => ({ __esModule: true, createAuditLog: jest.fn() }));
jest.mock("@/lib/sqlite", () => ({ __esModule: true, getSqliteFallback: jest.fn() }));

const mockGetUserAlerts = getUserAlerts as jest.Mock;
const mockGetAlertCount = getAlertCount as jest.Mock;
const mockGetSqliteFallback = getSqliteFallback as jest.Mock;

const holdError = Object.assign(
  new Error("There is a hold on your account. Reason: planLimitReached."),
  { code: "P6003" }
);

// Mirror rows for ALL users; the route must scope to userId 5.
const mirrorAlertRows = [
  {
    id: "a1",
    userId: 5,
    type: "price_above",
    symbol: "RELIANCE",
    condition: { threshold: 3000 },
    triggered: 1,
    triggeredAt: "2026-09-18T09:00:00.000Z",
    seen: 0,
    createdAt: "2026-09-17T09:00:00.000Z",
  },
  {
    id: "a2",
    userId: 6,
    type: "price_below",
    symbol: "INFY",
    condition: { threshold: 1400 },
    triggered: 0,
    triggeredAt: null,
    seen: 0,
    createdAt: "2026-09-17T10:00:00.000Z",
  },
];

function sqliteWith(rows: Array<Record<string, unknown>>) {
  mockGetSqliteFallback.mockReturnValue({
    isReady: () => true,
    getAlerts: () => rows,
  });
}

const req = (qs = "") => new Request(`http://localhost/api/alerts${qs}`) as never;

describe("GET /api/alerts (BUGS 15)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "user" } });
    sqliteWith([]);
  });

  test("unauthenticated → 401 (no fallback)", async () => {
    (auth as jest.Mock).mockResolvedValue(null);

    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockGetSqliteFallback).not.toHaveBeenCalled();
  });

  test("P6003 hold → 200 with mirror alerts scoped to the session user", async () => {
    mockGetUserAlerts.mockRejectedValue(holdError);
    sqliteWith(mirrorAlertRows);

    const res = await GET(req());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true); // the crash guard the page relies on
    expect(body).toHaveLength(1); // other users' alerts excluded
    expect(body[0]).toEqual({
      id: "a1",
      type: "price_above",
      symbol: "RELIANCE",
      condition: { threshold: 3000 },
      triggered: true, // coerced from 1
      triggeredAt: "2026-09-18T09:00:00.000Z",
      seen: false, // coerced from 0
      createdAt: "2026-09-17T09:00:00.000Z",
    });
  });

  test("P6003 hold with an empty mirror → 200 [] (never a 500)", async () => {
    mockGetUserAlerts.mockRejectedValue(holdError);
    sqliteWith([]);

    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("action=count also falls back to the mirror count", async () => {
    mockGetAlertCount.mockRejectedValue(holdError);
    sqliteWith(mirrorAlertRows);

    const res = await GET(req("?action=count"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 1 });
  });

  test("a non-hold DB error still surfaces as 500 (no silent masking)", async () => {
    mockGetUserAlerts.mockRejectedValue(new Error("syntax error near FROM"));

    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to fetch alerts" });
    expect(mockGetSqliteFallback).not.toHaveBeenCalled();
  });

  test("a healthy Prisma read never touches the mirror", async () => {
    mockGetUserAlerts.mockResolvedValue([{ id: "live-1", type: "price_above" }]);

    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "live-1", type: "price_above" }]);
    expect(mockGetSqliteFallback).not.toHaveBeenCalled();
  });
});
