/* @jest-environment node */
/**
 * POST /api/screener/configs/:id/run — regression guard for the Spec 20
 * extraction of the scan pipeline into `lib/screener/customScanRunner`.
 *
 * The pipeline itself is mocked, so these tests assert the part that did NOT
 * move and must not drift: ownership, the paging-gated export, and the response
 * shape the screener UI depends on. A refactor that quietly dropped the
 * `offset === 0` export gate, or relaxed `config.userId === session.user.id`,
 * would be invisible everywhere else in the suite.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: { scanConfig: { findUnique: jest.fn() } },
}));
jest.mock("@/lib/screener/customScanRunner", () => ({
  asFilterGroup: jest.fn((f: unknown) =>
    f && typeof f === "object" && Array.isArray((f as { conditions?: unknown }).conditions) ? f : null,
  ),
  runCustomScan: jest.fn(),
}));
jest.mock("@/lib/services/googleSheets/exporter", () => ({ exportCustomScan: jest.fn(async () => "enabled") }));

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { runCustomScan } from "@/lib/screener/customScanRunner";
import { exportCustomScan } from "@/lib/services/googleSheets/exporter";
import { POST } from "@/app/api/screener/configs/[id]/run/route";

const mockAuth = auth as jest.Mock;
const mockFind = prisma.scanConfig.findUnique as jest.Mock;
const mockScan = runCustomScan as jest.Mock;
const mockExport = exportCustomScan as jest.Mock;

const CONFIG = {
  id: "cfg-1",
  name: "Momentum",
  userId: 7,
  filters: { logic: "and", conditions: [{ field: "close", op: ">", value: 100 }] },
};

function post(body: unknown = {}, id = "cfg-1") {
  return new NextRequest(`http://localhost/api/screener/configs/${id}/run`, {
    method: "POST",
    body: JSON.stringify(body),
    // `params` is a promise in the App Router signature; the route awaits it.
  }) as never;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { email: "u@b.c", id: "7" } });
  mockFind.mockResolvedValue(CONFIG);
  mockScan.mockResolvedValue({ stocks: [{ symbol: "AAA" }], total: 120, fetchMs: 5, executionMs: 9 });
  mockExport.mockResolvedValue("enabled");
});

describe("POST /api/screener/configs/:id/run", () => {
  it("rejects an anonymous caller", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await POST(post(), params("cfg-1"))).status).toBe(401);
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("rejects a caller who does not own the config", async () => {
    // The console re-scans through the service, not this route, so this route
    // must never become a way to run someone else's scan.
    mockAuth.mockResolvedValue({ user: { email: "other@b.c", id: "99" } });
    const res = await POST(post(), params("cfg-1"));
    expect(res.status).toBe(403);
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("404s an unknown config", async () => {
    mockFind.mockResolvedValue(null);
    expect((await POST(post(), params("nope"))).status).toBe(404);
  });

  it("400s a config whose filter group is unusable", async () => {
    mockFind.mockResolvedValue({ ...CONFIG, filters: { logic: "and" } });
    expect((await POST(post(), params("cfg-1"))).status).toBe(400);
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("delegates to the shared pipeline, passing the request's paging through", async () => {
    await POST(post({ limit: 25, offset: 50, sortBy: "close", sortOrder: "asc" }), params("cfg-1"));
    expect(mockScan).toHaveBeenCalledWith(
      { id: "cfg-1", filters: CONFIG.filters },
      { limit: 25, offset: 50, sortBy: "close", sortOrder: "asc" },
    );
  });

  it("exports the first page only, so paging cannot append a run twice", async () => {
    await POST(post({ offset: 0 }), params("cfg-1"));
    await POST(post({ offset: 50 }), params("cfg-1"));
    await POST(post({ offset: 100 }), params("cfg-1"));
    expect(mockExport).toHaveBeenCalledTimes(1);
  });

  it("sends the run's FULL total as matchCount, not the page length", async () => {
    await POST(post({ limit: 10, offset: 0 }), params("cfg-1"));
    expect(mockExport.mock.calls[0][0]).toMatchObject({ configId: "cfg-1", configName: "Momentum", matchCount: 120 });
  });

  it("tags the export with a unique runId", async () => {
    await POST(post(), params("cfg-1"));
    await POST(post(), params("cfg-1"));
    expect(mockExport.mock.calls[0][2]).not.toBe(mockExport.mock.calls[1][2]);
  });

  it("returns the page with pagination derived from the full total", async () => {
    const res = await POST(post({ limit: 50, offset: 0 }), params("cfg-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      config: { id: "cfg-1", name: "Momentum" },
      stocks: [{ symbol: "AAA" }],
      pagination: { page: 1, limit: 50, total: 120, totalPages: 3 },
      executionMs: 9,
    });
  });

  it("computes the page number from the offset", async () => {
    const body = await (await POST(post({ limit: 50, offset: 50 }), params("cfg-1"))).json();
    expect(body.pagination).toMatchObject({ page: 2, totalPages: 3 });
  });

  it("still returns the run even if the background export fails", async () => {
    // The export is fire-and-forget; a sheet outage must not fail the screener.
    mockExport.mockRejectedValue(new Error("sheets down"));
    const res = await POST(post(), params("cfg-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });
  });

  it("500s when the scan itself throws", async () => {
    mockScan.mockRejectedValue(new Error("tv down"));
    const res = await POST(post(), params("cfg-1"));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "Failed to execute config" });
  });
});
