/* @jest-environment node */

/**
 * Admin predeploy/preserve route (v3.40.3, spec 14).
 *
 * Dual auth (deploy-guard token OR admin session; 503 when the token env is
 * unset for token callers), exact POST ordering (snapshot → backup → push),
 * mode selection (pushed / backed_up / skipped), and a read-only GET. All
 * deps are mocked; the route plumbing is real.
 */

import { GET, POST } from "@/app/api/admin/predeploy/preserve/route";
import { auth } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { isPlanLimitBreakerOpen } from "@/lib/db-utils";
import {
  exportSqliteBackup,
  getOutboxPending,
  getSqliteFallback,
  persistMirrorSnapshot,
  pushSqliteToPrisma,
  uploadMirrorSnapshotToBlobs,
} from "@/lib/sqlite";
import { createMirrorBackup, listMirrorBackups } from "@/lib/services/mirrorBackup";

jest.mock("@/lib/auth", () => ({ __esModule: true, auth: jest.fn() }));
jest.mock("@/lib/audit", () => ({ __esModule: true, createAuditLog: jest.fn() }));
jest.mock("@/lib/db-utils", () => ({ __esModule: true, isPlanLimitBreakerOpen: jest.fn() }));
jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
  },
}));
jest.mock("@/lib/sqlite", () => ({
  __esModule: true,
  exportSqliteBackup: jest.fn(),
  getOutboxPending: jest.fn(),
  getSqliteFallback: jest.fn(),
  persistMirrorSnapshot: jest.fn(),
  pushSqliteToPrisma: jest.fn(),
  uploadMirrorSnapshotToBlobs: jest.fn(),
}));
jest.mock("@/lib/services/mirrorBackup", () => ({
  __esModule: true,
  MIRROR_BACKUP_KEEP: 5,
  createMirrorBackup: jest.fn(),
  listMirrorBackups: jest.fn(),
}));

const mockAuth = auth as jest.Mock;
const mockAudit = createAuditLog as jest.Mock;
const mockBreaker = isPlanLimitBreakerOpen as jest.Mock;
const mockExport = exportSqliteBackup as jest.Mock;
const mockOutbox = getOutboxPending as jest.Mock;
const mockFallback = getSqliteFallback as jest.Mock;
const mockPersist = persistMirrorSnapshot as jest.Mock;
const mockPush = pushSqliteToPrisma as jest.Mock;
const mockUpload = uploadMirrorSnapshotToBlobs as jest.Mock;
const mockCreateBackup = createMirrorBackup as jest.Mock;
const mockListBackups = listMirrorBackups as jest.Mock;

const BACKUP_KEY = "backups/sqlite-mirror-2026-09-19T06-30-00-000Z.sqlite";
const BYTES = new Uint8Array([1, 2, 3, 4]);

const req = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/admin/predeploy/preserve", { headers }) as never;

const healthyPush = { ran: true, synced: 412, failed: 0, errors: [] as string[] };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DEPLOY_GUARD_TOKEN = "test-token";
  mockAuth.mockResolvedValue(null);
  mockBreaker.mockReturnValue(false);
  mockPersist.mockReturnValue(true);
  mockExport.mockReturnValue(BYTES);
  mockUpload.mockResolvedValue(undefined);
  mockCreateBackup.mockResolvedValue({ key: BACKUP_KEY, bytes: 4, pruned: [] });
  mockPush.mockResolvedValue(healthyPush);
  mockOutbox.mockReturnValue({ nse_mirror_rows: { pending: 412, lastAt: "2026-09-19T04:11:02.001Z" } });
  mockListBackups.mockResolvedValue([{ key: BACKUP_KEY, at: "2026-09-19T06:30:00.000Z" }]);
  mockAudit.mockResolvedValue(undefined);
  (globalThis as Record<string, unknown>).__sqliteMirrorBlobsStore = undefined;
  (globalThis as Record<string, unknown>).__sqliteMirrorBlobsStoreFailedAt = 0;
});

afterEach(() => {
  delete process.env.DEPLOY_GUARD_TOKEN;
});

describe("POST /api/admin/predeploy/preserve — auth", () => {
  test("401 on invalid token with no admin session; zero side effects", async () => {
    const res = await POST(req({ "x-deploy-guard-token": "wrong" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mockPersist).not.toHaveBeenCalled();
    expect(mockCreateBackup).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  test("503 guard_token_not_configured when the token env is unset and no session", async () => {
    delete process.env.DEPLOY_GUARD_TOKEN;
    const res = await POST(req({ "x-deploy-guard-token": "anything" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "guard_token_not_configured" });
    expect(mockPush).not.toHaveBeenCalled();
  });

  test("503 guard_token_not_configured on GET when the token env is unset and no session", async () => {
    delete process.env.DEPLOY_GUARD_TOKEN;
    const res = await GET(req({ "x-deploy-guard-token": "anything" }));
    expect(res.status).toBe(503);
  });

  test("admin session alone authorizes without a token", async () => {
    mockAuth.mockResolvedValue({ user: { id: "7", role: "admin" } });
    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.mode).toBe("pushed");
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "ADMIN_DB_SYNC", resource: "predeploy-preserve" }));
  });
});

describe("POST /api/admin/predeploy/preserve — mode selection", () => {
  test("breaker closed → 200 mode pushed with drained counts", async () => {
    const res = await POST(req({ "x-deploy-guard-token": "test-token" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      mode: "pushed",
      pushed: true,
      synced: 412,
      failed: 0,
      breakerOpen: false,
      backupKey: BACKUP_KEY,
      snapshotBytes: 4,
    });
    expect(mockPush).toHaveBeenCalledWith({ reason: "deploy", leaderGate: false });
  });

  test("breaker open → 200 mode backed_up, no push attempt", async () => {
    mockBreaker.mockReturnValue(true);
    const res = await POST(req({ "x-deploy-guard-token": "test-token" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, mode: "backed_up", pushed: false, breakerOpen: true, backupKey: BACKUP_KEY });
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockCreateBackup).toHaveBeenCalledTimes(1);
  });

  test("SQLite not ready → 200 mode skipped", async () => {
    mockPersist.mockReturnValue(false);
    mockExport.mockReturnValue(null);
    // Real contract: createMirrorBackup(null) → null (never uploads empty bytes).
    mockCreateBackup.mockResolvedValue(null);
    mockPush.mockResolvedValue(null);
    const res = await POST(req({ "x-deploy-guard-token": "test-token" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, mode: "skipped", pushed: false, snapshotBytes: null, backupKey: null });
  });

  test("backup/snapshot happen BEFORE the push is attempted (ordering)", async () => {
    const res = await POST(req({ "x-deploy-guard-token": "test-token" }));
    expect(res.status).toBe(200);
    const backupOrder = mockCreateBackup.mock.invocationCallOrder[0];
    const pushOrder = mockPush.mock.invocationCallOrder[0];
    expect(backupOrder).toBeLessThan(pushOrder);
    const persistOrder = mockPersist.mock.invocationCallOrder[0];
    expect(persistOrder).toBeLessThan(backupOrder);
  });

  test("throwing push → 500 but snapshot + backup were still attempted", async () => {
    mockPush.mockRejectedValue(new Error("P6003 again"));
    const res = await POST(req({ "x-deploy-guard-token": "test-token" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: "push_failed", backupKey: BACKUP_KEY, snapshotBytes: 4 });
    expect(mockCreateBackup).toHaveBeenCalledTimes(1);
  });

  test("unavailable Blobs does not break the response and push still runs", async () => {
    mockCreateBackup.mockResolvedValue(null);
    const res = await POST(req({ "x-deploy-guard-token": "test-token" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ mode: "pushed", backupKey: null });
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/admin/predeploy/preserve — read-only status", () => {
  test("returns pending + backups + breaker state and never pushes", async () => {
    mockFallback.mockReturnValue({});
    const res = await GET(req({ "x-deploy-guard-token": "test-token" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      breakerOpen: false,
      sqliteReady: true,
      keep: 5,
      pending: { nse_mirror_rows: { pending: 412, lastAt: "2026-09-19T04:11:02.001Z" } },
      backups: [{ key: BACKUP_KEY, at: "2026-09-19T06:30:00.000Z" }],
    });
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
    expect(mockCreateBackup).not.toHaveBeenCalled();
  });
});