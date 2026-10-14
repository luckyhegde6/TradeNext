/* @jest-environment node */
/**
 * Spec 20 — admin re-scan: the `screener`/`custom` service and the route that
 * exposes it.
 *
 * The two properties that matter and are easy to regress:
 *
 *  1. A re-scan must FORCE a refresh. Without `forceRefresh: true` the unified
 *     screener serves its 5-minute cache, and the operator gets a byte-identical
 *     duplicate run in their sheet while the button reports success.
 *  2. A re-scan must NOT double-export. `runChartinkUnifiedScreeners` already
 *     appends on its fresh path, so the service exporting as well would write two
 *     runs per click. The `delegatedExport` flag is what pins that contract.
 *
 * `custom` is the mirror image: the pipeline does NOT export, so the service
 * must. Getting either direction wrong is invisible in a unit test that only
 * checks the return value, which is why the export call count is asserted
 * directly on both paths.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("@/lib/audit", () => ({ createAuditLog: jest.fn(async () => ({ id: 1 })) }));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: { scanConfig: { findUnique: jest.fn() } },
}));
jest.mock("@/lib/db-utils", () => ({
  isPlanLimitBreakerOpen: jest.fn(() => false),
  isDbUnavailableError: jest.fn(() => false),
}));
jest.mock("@/lib/screener/customScanRunner", () => ({
  asFilterGroup: jest.fn((f: unknown) =>
    f && typeof f === "object" && Array.isArray((f as { conditions?: unknown }).conditions) ? f : null,
  ),
  runCustomScan: jest.fn(),
}));
jest.mock("@/lib/services/chartinkUnifiedScreenerService", () => ({
  runChartinkUnifiedScreeners: jest.fn(),
}));
jest.mock("@/lib/services/googleSheets/exporter", () => ({ exportCustomScan: jest.fn(async () => "enabled") }));
// Spec 27: the route no longer scans; it enqueues a worker task. Mock the spawn
// so the test asserts the enqueue contract (and never touches a real queue).
jest.mock("@/lib/services/worker/task-orchestrator", () => ({ spawnRegularTask: jest.fn() }));

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isDbUnavailableError, isPlanLimitBreakerOpen } from "@/lib/db-utils";
import { runCustomScan } from "@/lib/screener/customScanRunner";
import { runChartinkUnifiedScreeners } from "@/lib/services/chartinkUnifiedScreenerService";
import { exportCustomScan } from "@/lib/services/googleSheets/exporter";
import { createAuditLog } from "@/lib/audit";
import { spawnRegularTask } from "@/lib/services/worker/task-orchestrator";

import { RESCAN_ROW_LIMIT, rescanCustomConfig, rescanScreener } from "@/lib/services/googleSheets/rescanService";
import * as rescanRoute from "@/app/api/admin/google-sheets/rescan/route";

const mockAuth = auth as jest.Mock;
const mockUnified = runChartinkUnifiedScreeners as jest.Mock;
const mockScan = runCustomScan as jest.Mock;
const mockExport = exportCustomScan as jest.Mock;
const mockFindConfig = prisma.scanConfig.findUnique as jest.Mock;
const mockAudit = createAuditLog as jest.Mock;
const mockSpawn = spawnRegularTask as jest.Mock;

function asAdmin() {
  mockAuth.mockResolvedValue({ user: { email: "a@b.c", id: "1", role: "admin" } });
}
function asUser() {
  mockAuth.mockResolvedValue({ user: { email: "u@b.c", id: "2", role: "user" } });
}
function post(body: unknown) {
  return new NextRequest("http://localhost/api/admin/google-sheets/rescan", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const CONFIG = {
  id: "cfg-1",
  name: "Momentum",
  userId: 7,
  filters: { logic: "and", conditions: [{ field: "close", op: ">", value: 100 }] },
};

beforeEach(() => {
  jest.clearAllMocks();
  asAdmin();
  (isPlanLimitBreakerOpen as jest.Mock).mockReturnValue(false);
  (isDbUnavailableError as jest.Mock).mockReturnValue(false);
  mockUnified.mockResolvedValue([{ symbol: "AAA" }, { symbol: "BBB" }]);
  mockScan.mockResolvedValue({ stocks: [{ symbol: "AAA" }], total: 1, fetchMs: 5, executionMs: 7 });
  mockExport.mockResolvedValue("enabled");
  mockFindConfig.mockResolvedValue(CONFIG);
  mockSpawn.mockResolvedValue({ id: "task-1" });
});

describe("rescanScreener", () => {
  it("forces a refresh, which is the entire point of the button", async () => {
    await rescanScreener();
    expect(mockUnified).toHaveBeenCalledWith(expect.objectContaining({ forceRefresh: true }));
  });

  it("passes the caller's category/template filters through", async () => {
    await rescanScreener({ categoryId: "trend", templateIds: ["t1"] });
    expect(mockUnified).toHaveBeenCalledWith(
      expect.objectContaining({ forceRefresh: true, categoryId: "trend", templateIds: ["t1"] }),
    );
  });

  it("caps the TV fallback at the rescan row limit", async () => {
    await rescanScreener();
    expect(mockUnified).toHaveBeenCalledWith(
      expect.objectContaining({ tvFallbackLimit: RESCAN_ROW_LIMIT }),
    );
  });

  it("does NOT export: the producer already appended on its fresh path", async () => {
    // Double-exporting would write two identical runs per click.
    await rescanScreener();
    expect(mockExport).not.toHaveBeenCalled();
  });

  it("reports delegatedExport so the console knows the append was not awaited", async () => {
    const res = await rescanScreener();
    expect(res).toMatchObject({ ok: true, tab: "screener", appended: 2, total: 2, delegatedExport: true });
  });

  it("succeeds with zero hits rather than failing (an empty scan is a real answer)", async () => {
    mockUnified.mockResolvedValue([]);
    await expect(rescanScreener()).resolves.toMatchObject({ ok: true, appended: 0, total: 0 });
  });

  it("maps a DB failure to db_unavailable instead of throwing", async () => {
    mockUnified.mockRejectedValue(new Error("hold on your account"));
    (isDbUnavailableError as jest.Mock).mockReturnValue(true);
    await expect(rescanScreener()).resolves.toMatchObject({ ok: false, reason: "db_unavailable" });
  });

  it("maps any other failure to a generic error", async () => {
    mockUnified.mockRejectedValue(new Error("boom"));
    await expect(rescanScreener()).resolves.toMatchObject({ ok: false, reason: "error", error: "boom" });
  });
});

describe("rescanCustomConfig", () => {
  it("re-scans through the shared pipeline, not a private copy", async () => {
    await rescanCustomConfig("cfg-1");
    expect(mockScan).toHaveBeenCalledWith(
      { id: "cfg-1", filters: CONFIG.filters },
      expect.objectContaining({ limit: RESCAN_ROW_LIMIT, offset: 0 }),
    );
  });

  it("exports the re-scan (the pipeline does not) and always appends", async () => {
    const res = await rescanCustomConfig("cfg-1");
    expect(mockExport).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ ok: true, tab: "custom", appended: 1, delegatedExport: false });
  });

  it("builds the row from the stored config, never from client input", async () => {
    await rescanCustomConfig("cfg-1");
    const [ctx, rows] = mockExport.mock.calls[0];
    expect(ctx).toMatchObject({ configId: "cfg-1", configName: "Momentum", userId: "7", matchCount: 1 });
    expect(rows).toEqual([{ symbol: "AAA" }]);
  });

  it("uses a fresh runId so a re-run is distinguishable from the original", async () => {
    await rescanCustomConfig("cfg-1");
    const first = mockExport.mock.calls[0][2];
    await rescanCustomConfig("cfg-1");
    expect(mockExport.mock.calls[1][2]).not.toBe(first);
  });

  it("reports not_found for a missing config and exports nothing", async () => {
    mockFindConfig.mockResolvedValue(null);
    const res = await rescanCustomConfig("nope");
    expect(res).toMatchObject({ ok: false, reason: "not_found" });
    expect(mockExport).not.toHaveBeenCalled();
  });

  it("rejects a config with no usable filter group before scanning", async () => {
    mockFindConfig.mockResolvedValue({ ...CONFIG, filters: { logic: "and" } });
    const res = await rescanCustomConfig("cfg-1");
    expect(res).toMatchObject({ ok: false, reason: "no_filter_group" });
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("does not claim rows were queued when the export failed", async () => {
    mockExport.mockResolvedValue("failed");
    const res = await rescanCustomConfig("cfg-1");
    // The scan really ran, but nothing reached the ledger — reporting the row
    // count here would tell the operator to expect a sheet row that never lands.
    expect(res).toMatchObject({ ok: true, appended: 0, total: 1 });
  });

  it("does not claim rows were queued when tracking is disabled", async () => {
    mockExport.mockResolvedValue("disabled");
    await expect(rescanCustomConfig("cfg-1")).resolves.toMatchObject({ ok: true, appended: 0 });
  });

  it("short-circuits on an open plan-limit breaker without touching the DB", async () => {
    (isPlanLimitBreakerOpen as jest.Mock).mockReturnValue(true);
    await expect(rescanCustomConfig("cfg-1")).resolves.toMatchObject({ ok: false, reason: "db_unavailable" });
    expect(mockFindConfig).not.toHaveBeenCalled();
  });

  it("maps a scan failure to a generic error", async () => {
    mockScan.mockRejectedValue(new Error("tv down"));
    await expect(rescanCustomConfig("cfg-1")).resolves.toMatchObject({ ok: false, reason: "error" });
  });
});

describe("POST /api/admin/google-sheets/rescan", () => {
  it("requires an admin session", async () => {
    asUser();
    expect((await rescanRoute.POST(post({ tab: "screener" }))).status).toBe(401);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("enqueues a screener scan and returns 202 (never scans in the request)", async () => {
    const res = await rescanRoute.POST(post({ tab: "screener" }));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ success: true, queued: true, tab: "screener", taskId: "task-1" });
    // The whole point of Spec 27: the scan is NOT run inline.
    expect(mockUnified).not.toHaveBeenCalled();
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: "google_sheets_rescan",
        maxRetries: 0,
        triggeredBy: "admin",
        payload: expect.objectContaining({ tab: "screener" }),
      }),
    );
  });

  it("carries the caller's category/template filters into the task payload", async () => {
    await rescanRoute.POST(post({ tab: "screener", categoryId: "trend", templateIds: ["t1"] }));
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ categoryId: "trend", templateIds: ["t1"] }) }),
    );
  });

  it("enqueues a custom scan when a configId is given", async () => {
    const res = await rescanRoute.POST(post({ tab: "custom", configId: "cfg-1" }));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ success: true, queued: true, tab: "custom" });
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ tab: "custom", configId: "cfg-1" }) }),
    );
    // The pre-check reads the config, but the scan itself must not run here.
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("rejects a custom re-scan with no configId before doing any work", async () => {
    const res = await rescanRoute.POST(post({ tab: "custom" }));
    expect(res.status).toBe(400);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("rejects an unknown tab", async () => {
    expect((await rescanRoute.POST(post({ tab: "nope" }))).status).toBe(400);
  });

  it("rejects swing and daily-rec with an explanation, not a silent no-op", async () => {
    for (const tab of ["swing", "daily-rec"]) {
      const res = await rescanRoute.POST(post({ tab }));
      expect(res.status).toBe(400);
      const body = await res.json();
      // The message must say WHY, so the operator does not file a bug about a
      // button that "does nothing".
      expect(body.error).toContain("swing and daily-rec");
    }
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("rejects metrics: it is derived, so re-running it would fabricate data", async () => {
    const res = await rescanRoute.POST(post({ tab: "metrics" }));
    expect(res.status).toBe(400);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("rejects decisions, which is never synced or re-scanned", async () => {
    expect((await rescanRoute.POST(post({ tab: "decisions" }))).status).toBe(400);
  });

  it("rejects an oversized templateIds list", async () => {
    const many = Array.from({ length: 51 }, (_, i) => `t${i}`);
    expect((await rescanRoute.POST(post({ tab: "screener", templateIds: many }))).status).toBe(400);
  });

  it("rejects invalid JSON", async () => {
    const bad = new NextRequest("http://localhost/api/admin/google-sheets/rescan", {
      method: "POST",
      body: "nope",
    });
    expect((await rescanRoute.POST(bad)).status).toBe(400);
  });

  it("maps a missing config to 404 without enqueuing", async () => {
    mockFindConfig.mockResolvedValue(null);
    const res = await rescanRoute.POST(post({ tab: "custom", configId: "nope" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ reason: "not_found" });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("maps an unusable config to 409", async () => {
    mockFindConfig.mockResolvedValue({ ...CONFIG, filters: {} });
    expect((await rescanRoute.POST(post({ tab: "custom", configId: "cfg-1" }))).status).toBe(409);
  });

  it("maps an unavailable DB to 503", async () => {
    (isPlanLimitBreakerOpen as jest.Mock).mockReturnValue(true);
    const res = await rescanRoute.POST(post({ tab: "custom", configId: "cfg-1" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ reason: "db_unavailable" });
  });

  it("maps an unexpected pre-check failure to 500", async () => {
    mockFindConfig.mockRejectedValue(new Error("boom"));
    expect((await rescanRoute.POST(post({ tab: "custom", configId: "cfg-1" }))).status).toBe(500);
  });

  it("maps a queue-enqueue failure to 503 rather than a false 202", async () => {
    mockSpawn.mockRejectedValue(new Error("queue down"));
    const res = await rescanRoute.POST(post({ tab: "screener" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ reason: "db_unavailable" });
  });

  it("audits the enqueue with the taskId, tab and row cap", async () => {
    await rescanRoute.POST(post({ tab: "screener", categoryId: "trend" }));
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "GOOGLE_SHEETS_RESCAN",
        resourceId: "screener",
        metadata: expect.objectContaining({
          queued: true,
          taskId: "task-1",
          categoryId: "trend",
          rowLimit: RESCAN_ROW_LIMIT,
        }),
      }),
    );
  });

  it("does not audit when the re-scan is rejected before it is queued", async () => {
    mockFindConfig.mockResolvedValue(null);
    await rescanRoute.POST(post({ tab: "custom", configId: "nope" }));
    expect(mockAudit).not.toHaveBeenCalled();
  });
});
