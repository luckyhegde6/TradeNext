// lib/__tests__/googleSheetsTracking.test.ts
// Spec 19 — Google Sheets append-only tracking: pure row encoders, the
// header-ensure policy, the fire-and-forget exporter (batching / retry /
// audit), and the five producer wrappers. Zero network: the auth seam is mocked.

jest.mock("@/lib/services/googleSheets/auth", () => ({
  isTrackingEnabled: jest.fn(),
  trackerSheetId: jest.fn(),
  getSheetsClient: jest.fn(),
  _resetGoogleSheetsClients: jest.fn(),
}));

jest.mock("@/lib/audit", () => ({ createAuditLog: jest.fn(async () => ({ id: 1 })) }));

jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  cell,
  customScanRow,
  dailyRecRow,
  decisionRow,
  screenerRow,
  swingRow,
  type DailyRecStockInput,
  type ScreenerRowInput,
} from "@/lib/services/googleSheets/rows";
import { TRACKER_TABS, ensureHeaders, isTrackerTab, _resetHeaderGuard } from "@/lib/services/googleSheets/tabs";
import {
  exportCustomScan,
  exportDailyRecs,
  exportDecision,
  exportRows,
  exportScreeners,
  exportSwing,
} from "@/lib/services/googleSheets/exporter";
import type { DecisionTraceEntry } from "@/lib/services/decision/monitoring";
import type { SwingStock } from "@/lib/services/swing-types";

const mockAuth = jest.requireMock("@/lib/services/googleSheets/auth") as {
  isTrackingEnabled: jest.Mock<boolean, []>;
  trackerSheetId: jest.Mock<string | null, []>;
  getSheetsClient: jest.Mock;
};
const mockCreateAuditLog = jest.requireMock("@/lib/audit").createAuditLog as jest.Mock;
const mockLogger = jest.requireMock("@/lib/logger").default as {
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  debug: jest.Mock;
};

const valuesGet = jest.fn();
const valuesUpdate = jest.fn();
const valuesAppend = jest.fn();

const SHEET_ID = "1mRDK40yv2_RAgRitEZZutF1UmMJEBy9ccrjxeDYDXzQ";

/** Gaxios-shaped error with a numeric status. */
function httpError(status: number): Error & { response: { status: number } } {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status } });
}

function arm(enabled: boolean, sheetId: string | null = SHEET_ID): void {
  mockAuth.isTrackingEnabled.mockReturnValue(enabled);
  mockAuth.trackerSheetId.mockReturnValue(sheetId);
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetHeaderGuard();
  valuesGet.mockReset();
  valuesUpdate.mockReset();
  valuesAppend.mockReset();
  valuesGet.mockResolvedValue({ data: {} });
  valuesUpdate.mockResolvedValue({ data: {} });
  valuesAppend.mockResolvedValue({ data: {} });
  mockAuth.getSheetsClient.mockResolvedValue({
    spreadsheets: { values: { get: valuesGet, update: valuesUpdate, append: valuesAppend } },
  });
  arm(true);
});

// ─── cell() ──────────────────────────────────────────────────────────────

describe("cell", () => {
  test("nullish, NaN and Infinity become empty", () => {
    expect(cell(null)).toBe("");
    expect(cell(undefined)).toBe("");
    expect(cell(NaN)).toBe("");
    expect(cell(Infinity)).toBe("");
    expect(cell(-Infinity)).toBe("");
  });

  test("numbers, booleans and strings pass through", () => {
    expect(cell(0)).toBe("0");
    expect(cell(12.5)).toBe("12.5");
    expect(cell(false)).toBe("false");
    expect(cell("RELIANCE")).toBe("RELIANCE");
  });

  test("arrays join with '; ' and drop empties", () => {
    expect(cell(["a", "b"])).toBe("a; b");
    expect(cell(["a", null, "b", ""])).toBe("a; b");
    expect(cell([])).toBe("");
  });

  test("objects are JSON, and a circular object degrades to empty", () => {
    expect(cell({ a: 1 })).toBe('{"a":1}');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(cell(circular)).toBe("");
  });
});

// ─── Row encoders: the sheet contract ────────────────────────────────────

describe("row encoders match the tab column contracts", () => {
  test("every encoder emits exactly as many cells as its tab declares", () => {
    const swing = swingRow({ symbol: "RELIANCE" } as SwingStock, "2026-09-25T00:00:00.000Z");
    expect(swing).toHaveLength(TRACKER_TABS.swing.length);

    const daily = dailyRecRow(
      { symbol: "TCS", price: 1, change: 1, changePercent: 1, volume: 1 } as DailyRecStockInput,
      { runId: "r1", runDate: "2026-09-25" }
    );
    expect(daily).toHaveLength(TRACKER_TABS["daily-rec"].length);

    const screener = screenerRow({ symbol: "INFY", name: "Infosys", price: 1, changePercent: 1, volume: 1 });
    expect(screener).toHaveLength(TRACKER_TABS.screener.length);

    const custom = customScanRow(
      { symbol: "NSE:SBIN" },
      { runAt: "2026-09-25", configId: "c1", configName: "n", userId: "1", filters: {}, matchCount: 1 }
    );
    expect(custom).toHaveLength(TRACKER_TABS.custom.length);

    const decision = decisionRow({
      timestamp: "2026-09-25T00:00:00.000Z",
      kind: "ping",
      mode: "none",
      status: "success",
      latencyMs: 1,
    } as DecisionTraceEntry);
    expect(decision).toHaveLength(TRACKER_TABS.decisions.length);
  });

  test("swingRow maps the AI verdict into its own columns", () => {
    const row = swingRow(
      {
        symbol: "RELIANCE",
        name: "Reliance",
        price: 1400,
        change: 20,
        changePercent: 1.5,
        volume: 1000,
        marketCap: 1e12,
        screenerCount: 3,
        screenerNames: ["s1", "s2", "s3"],
        families: ["momentum"],
        templateIds: ["t1"],
        source: "chartink_db",
        momentumScore: 0.7,
        indicators: {},
        analysis: {
          action: "BUY",
          confidence: 80,
          entryPrice: 1400,
          targetPrice: 1600,
          stopLoss: 1350,
          timeHorizon: "short",
          logic: "because",
          riskFactors: ["r1"],
        },
      } as unknown as SwingStock,
      "2026-09-25T00:00:00.000Z"
    );

    expect(row[0]).toBe("2026-09-25T00:00:00.000Z"); // postedAt
    expect(row[1]).toBe("RELIANCE");
    expect(row[8]).toBe("3"); // screenerCount
    expect(row[9]).toBe("s1; s2; s3"); // screenerNames
    expect(row[15]).toBe("BUY"); // action
    expect(row[16]).toBe("80"); // confidence
    expect(row[17]).toBe("1400"); // entryPrice
    expect(row[18]).toBe("1600"); // targetPrice
    expect(row[19]).toBe("1350"); // stopLoss
    expect(row[20]).toBe("short"); // timeHorizon
    expect(row[23]).toBe(""); // analysisError
  });

  test("swingRow without a postedAt still fills column 0", () => {
    const row = swingRow({ symbol: "X" } as SwingStock);
    expect(row[0]).not.toBe("");
  });

  test("dailyRecRow derives screenerCount and marks AI failures", () => {
    const base: DailyRecStockInput = {
      symbol: "TCS",
      price: 3000,
      change: 30,
      changePercent: 1,
      volume: 500,
      screenerNames: ["a", "b"],
      success: true,
      aiRecommendation: {
        recommendation: "BUY",
        confidence: 70,
        targetPrice: 3300,
        stopLoss: 2900,
        timeHorizon: "short",
        reasoning: "r",
      },
    };
    const ok = dailyRecRow(base, { runId: "run-1", runDate: "2026-09-25" });
    expect(ok[0]).toBe("2026-09-25"); // runDate
    expect(ok[1]).toBe("run-1");
    expect(ok[8]).toBe("2"); // screenerCount from screenerNames
    expect(ok[9]).toBe("BUY");
    expect(ok[14]).toBe("analyzed");

    const failed = dailyRecRow({ ...base, success: false }, { runId: "run-1", runDate: "2026-09-25" });
    expect(failed[14]).toBe("ai-failed");
  });

  test("dailyRecRow tolerates a missing verdict", () => {
    const row = dailyRecRow(
      { symbol: "X", price: 1, change: 1, changePercent: 1, volume: 1, success: true },
      { runId: "r", runDate: "d" }
    );
    expect(row[8]).toBe("0");
    expect(row[9]).toBe("");
  });

  test("screenerRow writes price into the `close` column", () => {
    const row = screenerRow(
      { symbol: "INFY", name: "Infosys", price: 1500, changePercent: 2, volume: 9, screenerNames: ["s"] },
      { capturedAt: "T", runId: "R", category: "momentum" }
    );
    expect(row[0]).toBe("T");
    expect(row[1]).toBe("R");
    expect(row[4]).toBe("1500"); // close
    expect(row[8]).toBe("momentum");
  });

  test("customScanRow strips the NSE: prefix and derives the rupee change", () => {
    const row = customScanRow(
      { symbol: "NSE:SBIN", name: "SBI", close: 110, change: 10, volume: 999 },
      { runAt: "T", configId: "c", configName: "n", userId: "7", filters: { a: 1 }, matchCount: 42 }
    );
    expect(row[5]).toBe("42"); // matchCount
    expect(row[6]).toBe("SBIN"); // prefix stripped
    expect(row[8]).toBe("110");
    expect(row[9]).toBe("10"); // close * pct / (100 + pct) = 110 * 10 / 110
    expect(row[10]).toBe("10"); // percent
    expect(row[11]).toBe("999");
    expect(JSON.parse(row[12])).toEqual({ symbol: "NSE:SBIN", name: "SBI", close: 110, change: 10, volume: 999 });
  });

  test("customScanRow guards a -100% or missing close", () => {
    const row = customScanRow(
      { symbol: "NSE:X", close: 100, change: -100 },
      { runAt: "T", configId: "c", configName: "n", userId: "1", filters: {}, matchCount: 1 }
    );
    expect(row[9]).toBe(""); // no absurd rupee change
    expect(row[10]).toBe("-100");

    const noPrice = customScanRow(
      { name: "OnlyName" },
      { runAt: "T", configId: "c", configName: "n", userId: "1", filters: {}, matchCount: 1 }
    );
    expect(noPrice[6]).toBe("OnlyName"); // symbol falls back to name
    expect(noPrice[9]).toBe("");
  });

  test("decisionRow maps the trace fields", () => {
    const row = decisionRow({
      timestamp: "T",
      kind: "poc-a-screener",
      mode: "laya",
      provider: "local",
      status: "success",
      latencyMs: 12,
      attempts: 1,
      questionCount: 4,
      questionTypes: ["choice"],
      gate: "act",
      reason: "trending",
      scoredCount: 10,
      noulAmount: 0.25,
      allowed: true,
    } as DecisionTraceEntry);
    expect(row[1]).toBe("poc-a-screener");
    expect(row[5]).toBe("12");
    expect(row[10]).toBe("act");
    expect(row[15]).toBe("true");
  });
});

// ─── Header ensure ───────────────────────────────────────────────────────

describe("isTrackerTab", () => {
  test("accepts the 5 real tabs and rejects anything else", () => {
    for (const tab of Object.keys(TRACKER_TABS)) expect(isTrackerTab(tab)).toBe(true);
    expect(isTrackerTab("Decisions")).toBe(false);
    expect(isTrackerTab("__proto__")).toBe(false);
  });
});

describe("ensureHeaders", () => {
  test("writes the header row into an empty tab", async () => {
    valuesGet.mockResolvedValue({ data: {} });
    await expect(ensureHeaders("swing")).resolves.toBe(true);
    expect(valuesUpdate).toHaveBeenCalledTimes(1);
    expect(valuesUpdate.mock.calls[0][0].range).toBe("swing!A1");
    expect(valuesUpdate.mock.calls[0][0].requestBody.values[0]).toEqual([...TRACKER_TABS.swing]);
  });

  test("treats an all-blank first row as empty and writes headers", async () => {
    valuesGet.mockResolvedValue({ data: { values: [["", ""]] } });
    await expect(ensureHeaders("decisions")).resolves.toBe(true);
    expect(valuesUpdate).toHaveBeenCalledTimes(1);
  });

  test("is a no-op when the header already matches", async () => {
    valuesGet.mockResolvedValue({ data: { values: [[...TRACKER_TABS.screener]] } });
    await expect(ensureHeaders("screener")).resolves.toBe(true);
    expect(valuesUpdate).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  test("never overwrites a customised header, and still allows the append", async () => {
    valuesGet.mockResolvedValue({ data: { values: [["col1", "col2"]] } });
    await expect(ensureHeaders("custom")).resolves.toBe(true);
    expect(valuesUpdate).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining("header mismatch") })
    );
  });

  test("reads the header at most once per tab per process", async () => {
    valuesGet.mockResolvedValue({ data: {} });
    await ensureHeaders("swing");
    await ensureHeaders("swing");
    await ensureHeaders("swing");
    expect(valuesGet).toHaveBeenCalledTimes(1);
    expect(valuesUpdate).toHaveBeenCalledTimes(1);
  });

  test("returns false and does not throw when the sheet id is missing", async () => {
    arm(true, null);
    await expect(ensureHeaders("swing")).resolves.toBe(false);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  test("returns false and does not throw when the API fails", async () => {
    valuesGet.mockRejectedValue(new Error("nope"));
    await expect(ensureHeaders("swing")).resolves.toBe(false);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  test("a failed ensure can be retried later in the process", async () => {
    valuesGet.mockRejectedValueOnce(new Error("nope"));
    await expect(ensureHeaders("swing")).resolves.toBe(false);
    await expect(ensureHeaders("swing")).resolves.toBe(true);
    expect(valuesGet).toHaveBeenCalledTimes(2);
  });
});

// ─── exportRows ──────────────────────────────────────────────────────────

describe("exportRows", () => {
  test("disabled → no client, no network", async () => {
    arm(false);
    await expect(exportRows("swing", [["a"]])).resolves.toBe("disabled");
    expect(mockAuth.getSheetsClient).not.toHaveBeenCalled();
    expect(valuesAppend).not.toHaveBeenCalled();
  });

  test("no rows → enabled but zero network", async () => {
    await expect(exportRows("swing", [])).resolves.toBe("enabled");
    expect(mockAuth.getSheetsClient).not.toHaveBeenCalled();
    expect(valuesAppend).not.toHaveBeenCalled();
  });

  test("batches every row into ONE append with the USER_ENTERED option", async () => {
    const rows = [["a", "b"], ["c", "d"], ["e", "f"]];
    await expect(exportRows("screener", rows)).resolves.toBe("enabled");
    expect(valuesAppend).toHaveBeenCalledTimes(1);
    const arg = valuesAppend.mock.calls[0][0];
    expect(arg.spreadsheetId).toBe(SHEET_ID);
    expect(arg.range).toBe("screener!A1");
    expect(arg.valueInputOption).toBe("USER_ENTERED");
    expect(arg.requestBody.values).toEqual(rows);
  });

  test("ensures headers before appending", async () => {
    await exportRows("swing", [["a"]]);
    expect(valuesGet).toHaveBeenCalledTimes(1);
    expect(valuesUpdate).toHaveBeenCalledTimes(1);
    expect(valuesGet.mock.invocationCallOrder[0]).toBeLessThan(valuesAppend.mock.invocationCallOrder[0]);
  });

  test("missing sheet id → failed + FAILED audit, no throw", async () => {
    arm(true, null);
    await expect(exportRows("swing", [["a"]])).resolves.toBe("failed");
    expect(valuesAppend).not.toHaveBeenCalled();
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "GOOGLE_SHEETS_APPEND_FAILED" })
    );
  });

  test("emits a SUCCESS audit for run-level tabs", async () => {
    await exportRows("swing", [["a"]]);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "GOOGLE_SHEETS_APPEND_SUCCESS", resourceId: "swing" })
    );
  });

  test("skips the SUCCESS audit for the high-frequency decisions tab", async () => {
    await exportRows("decisions", [["a"]]);
    expect(mockCreateAuditLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "GOOGLE_SHEETS_APPEND_SUCCESS" })
    );
  });

  test("retries once after a 429 and succeeds", async () => {
    valuesAppend.mockRejectedValueOnce(httpError(429)).mockResolvedValueOnce({ data: {} });
    await expect(exportRows("swing", [["a"]])).resolves.toBe("enabled");
    expect(valuesAppend).toHaveBeenCalledTimes(2);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining("retrying once") })
    );
  }, 10_000);

  test("retries once after a 503 and succeeds", async () => {
    valuesAppend.mockRejectedValueOnce(httpError(503)).mockResolvedValueOnce({ data: {} });
    await expect(exportRows("swing", [["a"]])).resolves.toBe("enabled");
    expect(valuesAppend).toHaveBeenCalledTimes(2);
  }, 10_000);

  test("gives up after the single retry and audits the failure", async () => {
    valuesAppend.mockRejectedValue(httpError(500));
    await expect(exportRows("swing", [["a"]])).resolves.toBe("failed");
    expect(valuesAppend).toHaveBeenCalledTimes(2);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "GOOGLE_SHEETS_APPEND_FAILED" })
    );
  }, 10_000);

  test("does NOT retry a non-transient 400", async () => {
    valuesAppend.mockRejectedValue(httpError(400));
    await expect(exportRows("swing", [["a"]])).resolves.toBe("failed");
    expect(valuesAppend).toHaveBeenCalledTimes(1);
  });

  test("does NOT retry a non-status error", async () => {
    valuesAppend.mockRejectedValue(new Error("socket hang up"));
    await expect(exportRows("swing", [["a"]])).resolves.toBe("failed");
    expect(valuesAppend).toHaveBeenCalledTimes(1);
  }, 10_000);

  test("never throws, even when OAuth env is unusable", async () => {
    mockAuth.getSheetsClient.mockRejectedValue(new Error("missing GOOGLE_OAUTH_CLIENT_ID"));
    await expect(exportRows("swing", [["a"]])).resolves.toBe("failed");
  });

  test("a failing audit does not fail the export", async () => {
    mockCreateAuditLog.mockRejectedValueOnce(new Error("audit down"));
    await expect(exportRows("swing", [["a"]])).resolves.toBe("enabled");
    expect(valuesAppend).toHaveBeenCalledTimes(1);
  });
});

// ─── Producer wrappers ───────────────────────────────────────────────────

describe("producer wrappers", () => {
  test("exportSwing writes the swing tab", async () => {
    await expect(exportSwing([{ symbol: "SBIN" } as SwingStock])).resolves.toBe("enabled");
    expect(valuesAppend.mock.calls[0][0].range).toBe("swing!A1");
    expect(valuesAppend.mock.calls[0][0].requestBody.values[0][1]).toBe("SBIN");
  });

  test("exportDailyRecs writes the daily-rec tab", async () => {
    const stock: DailyRecStockInput = {
      symbol: "TCS",
      price: 1,
      change: 1,
      changePercent: 1,
      volume: 1,
      screenerNames: ["a"],
      success: true,
    };
    await expect(exportDailyRecs({ runId: "r9", runDate: "2026-09-25" }, [stock])).resolves.toBe("enabled");
    const arg = valuesAppend.mock.calls[0][0];
    expect(arg.range).toBe("daily-rec!A1");
    expect(arg.requestBody.values[0][1]).toBe("r9");
  });

  test("exportScreeners writes the screener tab", async () => {
    const hit: ScreenerRowInput = { symbol: "INFY", name: "I", price: 1, changePercent: 1, volume: 1 };
    await expect(exportScreeners([hit], { runId: "r", category: "trend" })).resolves.toBe("enabled");
    expect(valuesAppend.mock.calls[0][0].range).toBe("screener!A1");
  });

  test("exportCustomScan writes the custom tab", async () => {
    await expect(
      exportCustomScan(
        { runAt: "T", configId: "c1", configName: "n", userId: "1", filters: {}, matchCount: 1 },
        [{ symbol: "NSE:SBIN" }]
      )
    ).resolves.toBe("enabled");
    const arg = valuesAppend.mock.calls[0][0];
    expect(arg.range).toBe("custom!A1");
    expect(arg.requestBody.values[0][6]).toBe("SBIN");
  });

  test("exportDecision writes the decisions tab", async () => {
    await expect(
      exportDecision({
        timestamp: "T",
        kind: "ping",
        mode: "none",
        status: "success",
        latencyMs: 1,
      } as DecisionTraceEntry)
    ).resolves.toBe("enabled");
    expect(valuesAppend.mock.calls[0][0].range).toBe("decisions!A1");
  });

  test("every wrapper is a no-op when disabled", async () => {
    arm(false);
    const entry: DecisionTraceEntry = {
      timestamp: "T",
      kind: "ping",
      mode: "none",
      status: "success",
      latencyMs: 1,
    };
    await expect(exportSwing([{ symbol: "S" } as SwingStock])).resolves.toBe("disabled");
    await expect(exportDailyRecs({ runId: "r", runDate: "d" }, [])).resolves.toBe("disabled");
    await expect(exportScreeners([])).resolves.toBe("disabled");
    await expect(
      exportCustomScan({ runAt: "T", configId: "c", configName: "n", userId: "1", filters: {}, matchCount: 0 }, [])
    ).resolves.toBe("disabled");
    await expect(exportDecision(entry)).resolves.toBe("disabled");
    expect(mockAuth.getSheetsClient).not.toHaveBeenCalled();
  });

  test("every wrapper is a no-op with zero rows while enabled", async () => {
    await expect(exportSwing([])).resolves.toBe("enabled");
    await expect(exportDailyRecs({ runId: "r", runDate: "d" }, [])).resolves.toBe("enabled");
    await expect(exportScreeners([])).resolves.toBe("enabled");
    await expect(
      exportCustomScan({ runAt: "T", configId: "c", configName: "n", userId: "1", filters: {}, matchCount: 0 }, [])
    ).resolves.toBe("enabled");
    expect(mockAuth.getSheetsClient).not.toHaveBeenCalled();
  });
});
