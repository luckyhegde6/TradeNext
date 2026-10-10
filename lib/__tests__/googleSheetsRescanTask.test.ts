/* @jest-environment node */
/**
 * Spec 27 — the `google_sheets_rescan` worker executor + its `executeTask` wiring.
 *
 * The contract that matters: a re-scan runs on the queue and either REALLY ran
 * (`executeTask` → `success: true`) or the task is marked `failed`. It must never
 * return a false `completed`. `rescanService` RETURNS its failures, so the
 * executor has to convert a `!ok` outcome into a THROW — that conversion is the
 * central thing under test here.
 */
jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("@/lib/prisma", () => ({ __esModule: true, default: {} }));
jest.mock("@/lib/index-service", () => ({
  getIndexStocks: jest.fn(),
  syncStocksToDatabase: jest.fn(),
}));
jest.mock("@/lib/services/worker/task-orchestrator", () => ({
  logTaskEvent: jest.fn(async () => ({})),
}));
jest.mock("@/lib/services/recommendationCronService", () => ({
  recordCronRun: jest.fn(),
  SYSTEM_JOB_NAME_BY_TASK_TYPE: {},
}));
jest.mock("@/lib/services/corpActionPurpose", () => ({ parseActionPurpose: jest.fn() }));
jest.mock("@/lib/services/googleSheets/rescanService", () => ({
  RESCAN_ROW_LIMIT: 200,
  rescanScreener: jest.fn(),
  rescanCustomConfig: jest.fn(),
}));

import { rescanCustomConfig, rescanScreener, RESCAN_ROW_LIMIT } from "@/lib/services/googleSheets/rescanService";
import { executeGoogleSheetsRescan, executeTask } from "@/lib/services/worker/worker-service";

const mockScreener = rescanScreener as jest.Mock;
const mockCustom = rescanCustomConfig as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockScreener.mockResolvedValue({
    ok: true,
    tab: "screener",
    appended: 2,
    total: 2,
    executionMs: 12,
    delegatedExport: true,
  });
  mockCustom.mockResolvedValue({
    ok: true,
    tab: "custom",
    appended: 1,
    total: 1,
    executionMs: 9,
    delegatedExport: false,
  });
});

describe("executeGoogleSheetsRescan — screener", () => {
  it("forces the row cap and passes the caller's filters", async () => {
    const res = await executeGoogleSheetsRescan({ tab: "screener", categoryId: "trend", templateIds: ["t1"] });
    expect(mockScreener).toHaveBeenCalledWith({
      categoryId: "trend",
      templateIds: ["t1"],
      tvFallbackLimit: RESCAN_ROW_LIMIT,
    });
    expect(res).toMatchObject({ ok: true, tab: "screener", appended: 2, rowLimit: RESCAN_ROW_LIMIT });
  });

  it("omits filters that were not supplied", async () => {
    await executeGoogleSheetsRescan({ tab: "screener" });
    expect(mockScreener).toHaveBeenCalledWith({
      categoryId: undefined,
      templateIds: undefined,
      tvFallbackLimit: RESCAN_ROW_LIMIT,
    });
  });

  it("resolves an empty scan rather than throwing (zero hits is a real answer)", async () => {
    mockScreener.mockResolvedValue({
      ok: true,
      tab: "screener",
      appended: 0,
      total: 0,
      executionMs: 3,
      delegatedExport: true,
    });
    await expect(executeGoogleSheetsRescan({ tab: "screener" })).resolves.toMatchObject({ ok: true, appended: 0 });
  });

  it("throws when the scan reports a failure, so the task is marked failed", async () => {
    mockScreener.mockResolvedValue({ ok: false, tab: "screener", reason: "db_unavailable", error: "hold" });
    await expect(executeGoogleSheetsRescan({ tab: "screener" })).rejects.toThrow(/db_unavailable/);
  });
});

describe("executeGoogleSheetsRescan — custom", () => {
  it("addresses the re-scan by the stored config id", async () => {
    const res = await executeGoogleSheetsRescan({ tab: "custom", configId: "cfg-1" });
    expect(mockCustom).toHaveBeenCalledWith("cfg-1");
    expect(res).toMatchObject({ ok: true, tab: "custom", appended: 1, delegatedExport: false });
  });

  it("refuses to guess a config id", async () => {
    await expect(executeGoogleSheetsRescan({ tab: "custom" })).rejects.toThrow(/configId is required/);
    expect(mockCustom).not.toHaveBeenCalled();
  });

  it("throws when the custom scan reports a failure", async () => {
    mockCustom.mockResolvedValue({ ok: false, tab: "custom", reason: "not_found", error: "gone" });
    await expect(executeGoogleSheetsRescan({ tab: "custom", configId: "x" })).rejects.toThrow(/not_found/);
  });
});

describe("executeGoogleSheetsRescan — guard", () => {
  it("rejects an invalid or missing tab", async () => {
    await expect(executeGoogleSheetsRescan({ tab: "metrics" })).rejects.toThrow(/invalid tab/);
    await expect(executeGoogleSheetsRescan({})).rejects.toThrow(/invalid tab/);
    expect(mockScreener).not.toHaveBeenCalled();
    expect(mockCustom).not.toHaveBeenCalled();
  });
});

describe("executeTask — google_sheets_rescan wiring", () => {
  it("dispatches the task type and reports success with the result", async () => {
    const res = (await executeTask("t1", "google_sheets_rescan", { tab: "screener" })) as {
      success: boolean;
      result: { appended: number };
    };
    expect(res.success).toBe(true);
    expect(res.result).toMatchObject({ appended: 2 });
  });

  it("converts a thrown scan failure into success:false — never a false completed", async () => {
    mockScreener.mockResolvedValue({ ok: false, tab: "screener", reason: "error", error: "tv down" });
    const res = (await executeTask("t2", "google_sheets_rescan", { tab: "screener" })) as {
      success: boolean;
      error: string;
    };
    expect(res.success).toBe(false);
    expect(res.error).toContain("tv down");
  });
});
