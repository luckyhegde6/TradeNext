/* @jest-environment node */
/**
 * Spec 20 §5.C — admin route access control.
 *
 * The console exposes a spreadsheet id, OAuth *presence* flags, and a POST that
 * appends to an external system. Every handler therefore re-checks the role
 * server-side. These tests pin that check so a future refactor cannot quietly
 * drop it and turn a page-level client redirect into the only thing standing
 * between a non-admin and the config.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("@/lib/audit", () => ({ createAuditLog: jest.fn(async () => ({ id: 1 })) }));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

jest.mock("@/lib/services/googleSheets/configService", () => ({
  getConfig: jest.fn(() => ({ sheetId: "secret-sheet-id-value", displayName: "Tracker", dbEnabled: true, lastSyncAt: null, tabMarks: {} })),
  setSheetId: jest.fn(async () => ({})),
  setEnabled: jest.fn(async () => ({})),
  setDisplayName: jest.fn(async () => ({})),
  maskSheetId: jest.fn(() => "secr••••alue"),
  isTrackingActive: jest.fn(() => true),
}));

jest.mock("@/lib/services/googleSheets/syncService", () => ({
  syncTabs: jest.fn(async () => ({ status: "ok", tabs: [], startedAt: "t0", finishedAt: "t1" })),
  getBacklogCounts: jest.fn(() => ({ swing: { queued: 3, retained: 11 } })),
  getUnreadableSeqs: jest.fn((tab: string) => (tab === "swing" ? [9, 12] : [])),
  readTabCursor: jest.fn(() => 42),
  EXCLUDED_TABS: ["decisions"],
  SYNC_CONFIRM_THRESHOLD: 100,
  SYNC_ROW_CAP: 200,
  UNREADABLE_REPORT_CAP: 200,
}));

jest.mock("@/lib/services/googleSheets/statusService", () => ({
  getStatus: jest.fn(async () => ({
    envEnabled: true,
    dbConfigured: true,
    sheetIdMasked: "secreticalue",
    oauthConfigured: { clientId: true, clientSecret: true, refreshToken: false },
    trackingEnabled: true,
    perTab: ["swing", "daily-rec", "screener", "custom", "decisions", "metrics"].map((tab) => ({
      tab,
      headerState: "unknown",
      lastMark: null,
    })),
  })),
}));

jest.mock("@/lib/services/googleSheets/metricsService", () => ({ getMetrics: jest.fn() }));
jest.mock("@/lib/services/googleSheets/exporter", () => ({ exportMetricsSnapshot: jest.fn(async () => "enabled") }));


jest.mock("@/lib/sqlite", () => ({
  getSqliteFallback: jest.fn(),
}));

import { auth } from "@/lib/auth";
import { getStatus } from "@/lib/services/googleSheets/statusService";
import { setEnabled, setSheetId } from "@/lib/services/googleSheets/configService";
import { syncTabs } from "@/lib/services/googleSheets/syncService";
import { getSqliteFallback } from "@/lib/sqlite";
import { getMetrics } from "@/lib/services/googleSheets/metricsService";
import { exportMetricsSnapshot } from "@/lib/services/googleSheets/exporter";

import * as statusRoute from "@/app/api/admin/google-sheets/status/route";
import * as configRoute from "@/app/api/admin/google-sheets/config/route";
import * as syncRoute from "@/app/api/admin/google-sheets/sync/route";
import * as ledgerRoute from "@/app/api/admin/google-sheets/ledger/route";
import * as metricsRoute from "@/app/api/admin/google-sheets/metrics/route";

const mockAuth = auth as jest.Mock;
const mockSqlite = getSqliteFallback as jest.Mock;

/** A ledger row as the guard would read it back. `unreadable` decides whether the
 *  stored row_json parses to a non-empty array (syncable) or not (unappendable). */
function row(seq: number, tab: string, unreadable: boolean, delivered = false) {
  return { seq, tab, rowJson: unreadable ? "{oops" : '["a","b"]', delivered };
}
function sqliteWith(rows: Array<ReturnType<typeof row>>, deleted = rows.length) {
  return {
    getGoogleSheetsLedgerRowsBySeq: jest.fn((seqs: number[]) =>
      rows.filter((r) => seqs.includes(r.seq)),
    ),
    deleteGoogleSheetsLedgerRows: jest.fn(() => deleted),
  };
}


function asAdmin() {
  mockAuth.mockResolvedValue({ user: { email: "a@b.c", role: "admin" } });
}
function asUser() {
  mockAuth.mockResolvedValue({ user: { email: "u@b.c", role: "user" } });
}
function post(body: unknown) {
  return new NextRequest("http://localhost/api/admin/google-sheets/x", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
function del(body: unknown) {
  return new NextRequest("http://localhost/api/admin/google-sheets/ledger", {
    method: "DELETE",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  asAdmin();
  (getStatus as jest.Mock).mockResolvedValue({
    envEnabled: true,
    dbConfigured: true,
    sheetIdMasked: "secr••••alue",
    oauthConfigured: { clientId: true, clientSecret: true, refreshToken: false },
    trackingEnabled: true,
    perTab: ["swing", "daily-rec", "screener", "custom", "decisions"].map((tab) => ({
      tab,
      headerState: "unknown",
      lastMark: null,
    })),
  });
  (syncTabs as jest.Mock).mockResolvedValue({
    status: "ok",
    tabs: [],
    startedAt: "t0",
    finishedAt: "t1",
  });
  mockSqlite.mockReturnValue(sqliteWith([]));
});

describe("access control — all three routes reject non-admins", () => {
  const cases: Array<[string, () => Promise<Response>]> = [
    ["GET status", () => statusRoute.GET()],
    ["GET config", () => configRoute.GET()],
    ["POST config", () => configRoute.POST(post({ enabled: false }))],
    ["POST sync", () => syncRoute.POST(post({}))],
    ["DELETE ledger", () => ledgerRoute.DELETE(del({ tab: "swing", seqs: [1] }))],
  ];

  it.each(cases)("%s returns 401 for a logged-in non-admin", async (_name, run) => {
    asUser();
    const res = await run();
    expect(res.status).toBe(401);
  });

  it.each(cases)("%s returns 401 for no session", async (_name, run) => {
    mockAuth.mockResolvedValue(null);
    const res = await run();
    expect(res.status).toBe(401);
  });

  it("a rejected request performs no write and no sync", async () => {
    asUser();
    await configRoute.POST(post({ enabled: false, sheetId: "attacker-sheet-id" }));
    await syncRoute.POST(post({ tabs: ["swing"] }));
    expect(setEnabled).not.toHaveBeenCalled();
    expect(setSheetId).not.toHaveBeenCalled();
    expect(syncTabs).not.toHaveBeenCalled();
  });

  it("a rejected ledger delete destroys nothing", async () => {
    const sqlite = sqliteWith([row(1, "swing", true)]);
    mockSqlite.mockReturnValue(sqlite);
    asUser();
    const res = await ledgerRoute.DELETE(del({ tab: "swing", seqs: [1] }));
    expect(res.status).toBe(401);
    expect(sqlite.deleteGoogleSheetsLedgerRows).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/google-sheets/status", () => {
  it("returns the status plus per-tab queue, retention and unreadable rows", async () => {
    const res = await statusRoute.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.status.trackingEnabled).toBe(true);
    // queued and retained are DIFFERENT numbers: a single count would report
    // drained-but-retained rows as pending work.
    expect(body.sync.tabs[0]).toEqual({
      tab: "swing",
      queued: 3,
      retained: 11,
      unreadable: 2,
      unreadableSeqs: [9, 12],
      cursor: "42",
    });
  });

  it("reports zero counts for a tab with no ledger rows rather than failing", async () => {
    const body = await (await statusRoute.GET()).json();
    const daily = body.sync.tabs.find((t: { tab: string }) => t.tab === "daily-rec");
    expect(daily).toMatchObject({ queued: 0, retained: 0, unreadable: 0, unreadableSeqs: [] });
  });

  it("never reports unreadable rows for the excluded in-memory tab", async () => {
    const { getUnreadableSeqs } = jest.requireMock("@/lib/services/googleSheets/syncService");
    const body = await (await statusRoute.GET()).json();
    const decisions = body.sync.tabs.find((t: { tab: string }) => t.tab === "decisions");
    expect(decisions.unreadableSeqs).toEqual([]);
    // And the excluded tab is not even scanned.
    expect(getUnreadableSeqs).not.toHaveBeenCalledWith("decisions");
  });

  it("never leaks a full spreadsheet id or a token", async () => {
    const res = await statusRoute.GET();
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain("secret-sheet-id-value");
    expect(raw).not.toMatch(/refreshToken"\s*:\s*"/);
  });
});

describe("GET /api/admin/google-sheets/config", () => {
  it("returns the masked id, never the raw one", async () => {
    const res = await configRoute.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config.sheetIdMasked).toBe("secr••••alue");
    expect(JSON.stringify(body)).not.toContain("secret-sheet-id-value");
  });
});

describe("POST /api/admin/google-sheets/config", () => {
  it("rejects a malformed body with 400", async () => {
    expect((await configRoute.POST(post({ nope: 1 }))).status).toBe(400);
    expect((await configRoute.POST(post({ sheetId: "bad id with spaces" }))).status).toBe(400);
    expect((await configRoute.POST(post({ sheetId: "short" }))).status).toBe(400);
    expect(setSheetId).not.toHaveBeenCalled();
  });

  it("accepts a valid sheet id and applies it", async () => {
    const res = await configRoute.POST(post({ sheetId: "1AbCdEfGhIjKlMnOpQrStUvWxYz012345" }));
    expect(res.status).toBe(200);
    expect(setSheetId).toHaveBeenCalledWith("1AbCdEfGhIjKlMnOpQrStUvWxYz012345");
  });
});

describe("POST /api/admin/google-sheets/sync", () => {
  it("rejects an unknown tab with 400 and does not sync", async () => {
    const res = await syncRoute.POST(post({ tabs: ["swing", "not-a-tab"] }));
    expect(res.status).toBe(400);
    expect(syncTabs).not.toHaveBeenCalled();
  });

  it("passes the requested tabs and confirmed flag through", async () => {
    await syncRoute.POST(post({ tabs: ["custom"], confirmed: true }));
    expect(syncTabs).toHaveBeenCalledWith(["custom"], true);
  });

  it("syncs all tabs when none are named", async () => {
    await syncRoute.POST(post({}));
    const [tabs] = (syncTabs as jest.Mock).mock.calls[0];
    expect(tabs).toEqual(expect.arrayContaining(["swing", "daily-rec", "screener", "custom", "decisions"]));
  });

  it("tolerates an empty body", async () => {
    const empty = new NextRequest("http://localhost/x", { method: "POST" });
    expect((await syncRoute.POST(empty)).status).toBe(200);
  });

  it("rejects invalid JSON with 400", async () => {
    const bad = new NextRequest("http://localhost/x", { method: "POST", body: "{oops" });
    expect((await syncRoute.POST(bad)).status).toBe(400);
  });
});

/**
 * The ledger DELETE is the only destructive operation in the tracking subsystem.
 * These tests pin the refusal paths first: the guards exist to stop an operator
 * (or a stale/malicious client) from permanently destroying a row that is still
 * owed to the sheet. Each refusal must leave the ledger untouched.
 */
describe("DELETE /api/admin/google-sheets/ledger", () => {
  it("deletes unreadable undelivered rows and reports the real count", async () => {
    const sqlite = sqliteWith([row(1, "swing", true), row(2, "swing", true)]);
    mockSqlite.mockReturnValue(sqlite);
    const res = await ledgerRoute.DELETE(del({ tab: "swing", seqs: [1, 2] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, tab: "swing", requested: 2, deleted: 2 });
    expect(sqlite.deleteGoogleSheetsLedgerRows).toHaveBeenCalledWith("swing", [1, 2]);
  });

  it("refuses a healthy undelivered row and deletes nothing", async () => {
    const sqlite = sqliteWith([row(7, "swing", false)]);
    mockSqlite.mockReturnValue(sqlite);
    const res = await ledgerRoute.DELETE(del({ tab: "swing", seqs: [7] }));
    expect(res.status).toBe(409);
    expect(sqlite.deleteGoogleSheetsLedgerRows).not.toHaveBeenCalled();
  });

  it("refuses an already-delivered row, which is the append audit trail", async () => {
    const sqlite = sqliteWith([row(7, "swing", true, true)]);
    mockSqlite.mockReturnValue(sqlite);
    const res = await ledgerRoute.DELETE(del({ tab: "swing", seqs: [7] }));
    expect(res.status).toBe(409);
    expect(sqlite.deleteGoogleSheetsLedgerRows).not.toHaveBeenCalled();
  });

  it("is all-or-nothing: one readable row blocks the whole batch", async () => {
    const sqlite = sqliteWith([row(1, "swing", true), row(2, "swing", false)]);
    mockSqlite.mockReturnValue(sqlite);
    const res = await ledgerRoute.DELETE(del({ tab: "swing", seqs: [1, 2] }));
    expect(res.status).toBe(409);
    expect(sqlite.deleteGoogleSheetsLedgerRows).not.toHaveBeenCalled();
  });

  it("refuses a seq belonging to another tab", async () => {
    const sqlite = sqliteWith([row(4, "screener", true)]);
    mockSqlite.mockReturnValue(sqlite);
    const res = await ledgerRoute.DELETE(del({ tab: "swing", seqs: [4] }));
    expect(res.status).toBe(400);
    expect(sqlite.deleteGoogleSheetsLedgerRows).not.toHaveBeenCalled();
  });

  it("returns 404 for a seq that does not exist", async () => {
    const sqlite = sqliteWith([]);
    mockSqlite.mockReturnValue(sqlite);
    expect((await ledgerRoute.DELETE(del({ tab: "swing", seqs: [99] }))).status).toBe(404);
  });

  it("returns 503 rather than a misleading 404 when the mirror is not ready", async () => {
    mockSqlite.mockReturnValue(null);
    const res = await ledgerRoute.DELETE(del({ tab: "swing", seqs: [1] }));
    expect(res.status).toBe(503);
  });

  it("rejects an unknown tab with 400", async () => {
    expect((await ledgerRoute.DELETE(del({ tab: "nope", seqs: [1] }))).status).toBe(400);
  });

  it.each([
    ["no seqs", { tab: "swing", seqs: [] }],
    ["a zero seq", { tab: "swing", seqs: [0] }],
    ["a negative seq", { tab: "swing", seqs: [-1] }],
    ["a fractional seq", { tab: "swing", seqs: [1.5] }],
    ["a string seq", { tab: "swing", seqs: ["1"] }],
    ["an oversized batch", { tab: "swing", seqs: Array.from({ length: 201 }, (_, i) => i + 1) }],
  ])("rejects %s with 400 and deletes nothing", async (_name, body) => {
    const sqlite = sqliteWith([row(1, "swing", true)]);
    mockSqlite.mockReturnValue(sqlite);
    expect((await ledgerRoute.DELETE(del(body))).status).toBe(400);
    expect(sqlite.deleteGoogleSheetsLedgerRows).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON with 400", async () => {
    const bad = new NextRequest("http://localhost/x", { method: "DELETE", body: "{oops" });
    expect((await ledgerRoute.DELETE(bad)).status).toBe(400);
  });

  it("dedupes the batch so requested matches the real row count", async () => {
    const sqlite = sqliteWith([row(1, "swing", true)]);
    mockSqlite.mockReturnValue(sqlite);
    const res = await ledgerRoute.DELETE(del({ tab: "swing", seqs: [1, 1, 1] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, tab: "swing", requested: 1, deleted: 1 });
  });

  it("reports a conflict when the mirror changed underneath an approved batch", async () => {
    // Guards all passed, then the delete removed 0 rows. A success response here
    // would render a clean removal in the console that never happened.
    const sqlite = sqliteWith([row(1, "swing", true)], 0);
    mockSqlite.mockReturnValue(sqlite);
    const res = await ledgerRoute.DELETE(del({ tab: "swing", seqs: [1] }));
    expect(res.status).toBe(409);
  });

  it("reports a conflict on a PARTIAL delete, not just a zero-row delete", async () => {
    // The preflight guards all passed, but the delete removed only some of the
    // batch. Returning 200 would claim a clean removal for rows that are still
    // pending; the operator would never retry them.
    const sqlite = sqliteWith([row(1, "swing", true), row(2, "swing", true)], 1);
    mockSqlite.mockReturnValue(sqlite);
    const res = await ledgerRoute.DELETE(del({ tab: "swing", seqs: [1, 2] }));
    expect(res.status).toBe(409);
  });
});

describe("GET/POST /api/admin/google-sheets/metrics", () => {
  // Metrics are the one console panel that cannot be served from SQLite: the
  // RecommendationTracker table is not mirrored, so under the plan-limit hold the
  // preview is genuinely unavailable. The contract pinned here is that this is
  // REPORTED, never rendered as a confident row of zeros the user would then
  // append to their own sheet (Lesson 138).
  const snapshot = {
    snapshotAt: "2026-09-26T04:30:00.000Z",
    totalTracked: 40,
    active: 10,
    targetAchieved: 20,
    stopLossHit: 7,
    expired: 3,
    winRate: 74.07,
    netPnlAbs: 1234.5,
    netPnlPct: 3.21,
    avgReturnPct: 4.44,
    grossPnlAbs: 2000.75,
  };
  const getReq = () => new NextRequest("http://localhost/api/admin/google-sheets/metrics");
  const metricsPost = (body: unknown = {}) =>
    new NextRequest("http://localhost/api/admin/google-sheets/metrics", {
      method: "POST",
      body: JSON.stringify(body),
    });

  beforeEach(() => {
    (getMetrics as jest.Mock).mockResolvedValue({ ok: true, snapshot });
  });

  it("requires an admin session on GET", async () => {
    asUser();
    expect((await metricsRoute.GET()).status).toBe(401);
  });

  it("requires an admin session on POST", async () => {
    asUser();
    expect((await metricsRoute.POST(metricsPost())).status).toBe(401);
  });

  it("returns the snapshot for an admin", async () => {
    const res = await metricsRoute.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, ok: true, snapshot });
  });

  it("reports db_unavailable as a 200 with ok:false so the console keeps rendering", async () => {
    (getMetrics as jest.Mock).mockResolvedValue({ ok: false, reason: "db_unavailable" });
    const res = await metricsRoute.GET();
    // Deliberately NOT a 500: a throw here would take down every other panel.
    const body = await res.json();
    expect(body).toEqual({ success: true, ok: false, reason: "db_unavailable", snapshot: null });
  });

  it("appends exactly one snapshot row and reports the outcome", async () => {
    const res = await metricsRoute.POST(metricsPost());
    expect(res.status).toBe(200);
    expect(exportMetricsSnapshot).toHaveBeenCalledWith(snapshot);
    expect(await res.json()).toMatchObject({ success: true, tab: "metrics", outcome: "enabled" });
  });

  it("reports success:false when the export fails, so the console can say so", async () => {
    (exportMetricsSnapshot as jest.Mock).mockResolvedValueOnce("failed");
    const res = await metricsRoute.POST(metricsPost());
    expect(await res.json()).toMatchObject({ success: false, outcome: "failed" });
  });

  it("refuses to append an empty snapshot rather than writing a blank row", async () => {
    (getMetrics as jest.Mock).mockResolvedValue({ ok: true, snapshot: { ...snapshot, totalTracked: 0 } });
    const res = await metricsRoute.POST(metricsPost());
    expect(res.status).toBe(409);
    expect(exportMetricsSnapshot).not.toHaveBeenCalled();
  });

  it("refuses to append while the DB is unavailable", async () => {
    (getMetrics as jest.Mock).mockResolvedValue({ ok: false, reason: "db_unavailable" });
    const res = await metricsRoute.POST(metricsPost());
    expect(res.status).toBe(503);
    expect(exportMetricsSnapshot).not.toHaveBeenCalled();
  });

  it("rejects a malformed body before reading the database", async () => {
    const bad = new NextRequest("http://localhost/api/admin/google-sheets/metrics", {
      method: "POST",
      body: JSON.stringify({ confirmed: "yes-please" }),
    });
    expect((await metricsRoute.POST(bad)).status).toBe(400);
    expect(getMetrics).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON body", async () => {
    const bad = new NextRequest("http://localhost/api/admin/google-sheets/metrics", {
      method: "POST",
      body: "not json",
    });
    expect((await metricsRoute.POST(bad)).status).toBe(400);
  });

  it("accepts a valid confirmation flag", async () => {
    expect((await metricsRoute.POST(metricsPost({ confirmed: true }))).status).toBe(200);
  });

  it("exposes GET so the console can re-read after an append", () => {
    expect(typeof metricsRoute.GET).toBe("function");
    expect(typeof getReq).toBe("function");
  });
});
