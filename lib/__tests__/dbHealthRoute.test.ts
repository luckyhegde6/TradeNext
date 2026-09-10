/* @jest-environment node */

/**
 * Route-level regression for the request-body single-read bug in
 * POST /api/admin/db-health (v3.32.1 post-merge fix).
 *
 * Root cause: the handler reads `await req.json()` at the top to extract
 * `action`, then `restore` (:272) and `set_time_correction` (:434) re-read the
 * body. A Web `Request` body stream is single-use (`bodyUsed`), so the second
 * `json()` throws and the catch returns 400 — every Save Correction from the
 * UI failed with "Invalid payload" since v3.32.0 shipped (and restore failed
 * with "Invalid restore payload" since v3.21.2). Only `probe_time` worked
 * because it never re-reads.
 *
 * These tests build a real `Request` (enforcing bodyUsed semantics) and assert
 * the handler returns 200 and calls the expected services — pre-fix they all
 * 400'd on the double read. The pure timeCorrection functions are covered by
 * `lib/__tests__/timeCorrection.test.ts`; here only the route plumbing is
 * exercised (deps mocked).
 */

import { POST } from "@/app/api/admin/db-health/route";
import { auth } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import {
  saveCorrection,
  clearCorrection,
  computeCorrectionOffsetMinutes,
  parseIstDateTimeLocal,
  getTimeDiagnostics,
} from "@/lib/services/timeCorrection";
import { restoreSqliteBackup } from "@/lib/sqlite";

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
  dbOpsCounter: { reads: 0, writes: 0 },
  isDbWriteBudgetExceeded: jest.fn(() => false),
  WRITE_BUDGET_CONFIG: { writeBudget: 8000, exceeded: false },
  getDbErrorLog: jest.fn(() => []),
  getIstDayKey: jest.fn(() => "2026-09-10"),
  getDbErrorCounts: jest.fn(() => ({ _day: "2026-09-10", counts: {} })),
}));
jest.mock("@/lib/sqlite", () => ({
  ensureSqliteBackup: jest.fn(async () => null),
  getSqliteFallback: jest.fn(() => null),
  exportSqliteBackup: jest.fn(() => null),
  restoreSqliteBackup: jest.fn(async () => ({ db: 24 })),
  getWriteBehindStats: jest.fn(() => ({})),
  flushWriteBehind: jest.fn(async () => ({ flushed: {}, retained: 0, pending: 0 })),
  probePrismaNow: jest.fn(async () => ({ available: true, latencyMs: 5 })),
  probeDbTimeNow: jest.fn(async () => ({
    available: true,
    latencyMs: 5,
    dbIso: new Date().toISOString(),
  })),
  getDbLogFiles: jest.fn(() => []),
  readDbLogFile: jest.fn(() => null),
  exportDbLogsAsNdjson: jest.fn(() => null),
  pushSqliteToPrisma: jest.fn(async () => ({ pushed: false, reason: "skipped" })),
  hasSyncHistoryTable: jest.fn(() => false),
  getOutboxPending: jest.fn(() => 0),
  getSqliteDerivedCounts: jest.fn(() => ({})),
}));
jest.mock("@/lib/audit", () => ({ createAuditLog: jest.fn(async () => {}) }));
jest.mock("@/lib/services/priceCache", () => ({
  getDailyPriceCacheStatus: jest.fn(() => ({})),
  flushDailyPricesToDb: jest.fn(async () => ({ rows: 0, errors: 0 })),
}));
jest.mock("@/lib/services/leader", () => ({
  getLeaderInfo: jest.fn(() => ({})),
  LEADER_SELF: "test-instance",
}));
jest.mock("@/lib/services/readTier", () => ({ getReadMetrics: jest.fn(() => ({})) }));
jest.mock("@/lib/cache", () => ({ getCacheMetrics: jest.fn(() => ({})) }));
jest.mock("@/lib/services/timeCorrection", () => ({
  getTimeDiagnostics: jest.fn(() => ({ hasCorrection: false, offsetMinutes: 0 })),
  parseIstDateTimeLocal: jest.fn(() => new Date("2026-09-10T09:36:00.000Z")),
  computeCorrectionOffsetMinutes: jest.fn(() => 6),
  saveCorrection: jest.fn(),
  clearCorrection: jest.fn(),
}));

const mockAuth = auth as jest.Mock;
const mockSaveCorrection = saveCorrection as jest.Mock;
const mockClearCorrection = clearCorrection as jest.Mock;
const mockComputeOffset = computeCorrectionOffsetMinutes as jest.Mock;
const mockParseIst = parseIstDateTimeLocal as jest.Mock;
const mockGetTimeDiagnostics = getTimeDiagnostics as jest.Mock;
const mockRestoreSqliteBackup = restoreSqliteBackup as jest.Mock;
const mockCreateAuditLog = createAuditLog as jest.Mock;

function jsonPost(body: unknown): Request {
  return new Request("http://localhost/api/admin/db-health", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "1", email: "admin@tradenext6.app" } });
});

describe("POST /api/admin/db-health — request body single-read (v3.32.1 regression)", () => {
  it("set_time_correction returns 200 (NOT 400 'Invalid payload') with a valid body", async () => {
    const res = await POST(
      jsonPost({ action: "set_time_correction", istDateTime: "2026-09-10T15:06" }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.error).toBeUndefined();
    expect(json.success).toBe(true);
    expect(json.offsetMinutes).toBe(6);
  });

  it("set_time_correction persists the offset record + audits ADMIN_DB_TIME_CORRECTION_SET", async () => {
    const res = await POST(
      jsonPost({ action: "set_time_correction", istDateTime: "2026-09-10T15:06" }),
    );
    expect(res.status).toBe(200);
    expect(mockParseIst).toHaveBeenCalledWith("2026-09-10T15:06");
    expect(mockComputeOffset).toHaveBeenCalledTimes(1);
    expect(mockSaveCorrection).toHaveBeenCalledWith(
      expect.objectContaining({ offsetMinutes: 6, istInput: "2026-09-10T15:06" }),
    );
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ADMIN_DB_TIME_CORRECTION_SET" }),
    );
  });

  it("restore returns 200 (NOT 400 'Invalid restore payload') with valid base64 data", async () => {
    const base64 = Buffer.from("fake-sqlite-bytes").toString("base64");
    const res = await POST(
      jsonPost({ action: "restore", data: base64 }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.error).toBeUndefined();
    expect(json.success).toBe(true);
    expect(json.tables).toBe(24);
    expect(mockRestoreSqliteBackup).toHaveBeenCalledTimes(1);
    expect(mockRestoreSqliteBackup.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
  });

  it("still 400s cleanly (zod path) when istDateTime is missing — no behavior change", async () => {
    const res = await POST(jsonPost({ action: "set_time_correction" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("istDateTime is required");
    expect(mockSaveCorrection).not.toHaveBeenCalled();
  });

  it("clear_time_correction returns 200 and clears the offset (no body re-read)", async () => {
    const res = await POST(jsonPost({ action: "clear_time_correction" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.cleared).toBe(true);
    expect(mockClearCorrection).toHaveBeenCalledTimes(1);
    expect(mockGetTimeDiagnostics).toHaveBeenCalled();
  });
});