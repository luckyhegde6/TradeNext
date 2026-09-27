// lib/__tests__/googleSheetsLedgerCapture.test.ts
// Spec 20 §5.B — EVERY export attempt is recorded in the SQLite ledger with an
// explicit `delivered` flag (this is the regression net for the
// failures-only -> every-outcome change in exporter.ts).
//
// The contract under test:
//   success            -> delivered: true,  reason "appended"
//   non-transient err  -> delivered: false, reason "failed"
//   transient exhausted-> delivered: false, reason "failed"
//   no spreadsheet id  -> delivered: false, reason "no-spreadsheet"
//   gate off / empty   -> NOT recorded (the feature is off, or there is nothing)
//   fromSync drain     -> NEVER recorded (the drain owns those rows; recording
//                         would duplicate every replayed row and, on a failing
//                         drain, grow the backlog without bound)
//   decisions tab      -> NEVER recorded (excluded from syncing by spec)
//   SQLite failure     -> never throws into the producer, result unchanged
//
// Zero network: the auth seam is mocked. Zero Prisma: the config service is
// SQLite-first, and @/lib/sqlite is mocked wholesale.

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

// The exporter + configService read the mirror through this one seam, so mocking
// it gives deterministic control over BOTH the ledger writes and the config row.
jest.mock("@/lib/sqlite", () => ({ getSqliteFallback: jest.fn() }));

jest.mock("@/lib/services/decision/monitoring", () => ({
  registerDecisionTraceSink: jest.fn(),
}));

import {
  exportCustomScan,
  exportDailyRecs,
  exportRows,
  exportRowsFromSync,
  exportScreeners,
  exportSwing,
} from "@/lib/services/googleSheets/exporter";
import { _resetHeaderGuard } from "@/lib/services/googleSheets/tabs";
import type { SwingStock } from "@/lib/services/swing-types";
import type { DailyRecStockInput, ScreenerRowInput } from "@/lib/services/googleSheets/rows";

const mockAuth = jest.requireMock("@/lib/services/googleSheets/auth") as {
  isTrackingEnabled: jest.Mock<boolean, []>;
  trackerSheetId: jest.Mock<string | null, []>;
  getSheetsClient: jest.Mock;
};
const { getSqliteFallback } = jest.requireMock("@/lib/sqlite") as {
  getSqliteFallback: jest.Mock;
};

const valuesGet = jest.fn();
const valuesUpdate = jest.fn();
const valuesAppend = jest.fn();

/** The single ledger write seam. Every assertion below inspects its calls. */
const insertLedger = jest.fn();

const SHEET_ID = "1mRDK40yv2_RAgRitEZZutF1UmMJEBy9ccrjxeDYDXzQ";

interface MirrorRow {
  sheetId: string | null;
  displayName: string | null;
  enabled: boolean;
  lastSyncAt: string | null;
  tabMarks: Record<string, string>;
}

let configRow: MirrorRow | null = null;
let sqliteReady = true;

/** Gaxios-shaped error with a numeric status, so `isTransient` can read it. */
function httpError(status: number): Error & { response: { status: number } } {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status } });
}

function arm(enabled = true, sheetId: string | null = SHEET_ID): void {
  mockAuth.isTrackingEnabled.mockReturnValue(enabled);
  mockAuth.trackerSheetId.mockReturnValue(sheetId);
  configRow = { sheetId: null, displayName: "Tracker", enabled: true, lastSyncAt: null, tabMarks: {} };
  sqliteReady = true;
  insertLedger.mockReset();
  insertLedger.mockReturnValue([]);
  getSqliteFallback.mockImplementation(() =>
    sqliteReady
      ? { getGoogleSheetsConfig: () => configRow, insertGoogleSheetsLedgerRows: insertLedger }
      : null
  );
}

/** The single ledger row written by the last export, for precise assertions. */
function lastLedgerRow(): { tab: string; rowJson: string; runId: string | null; reason: string; delivered: boolean } {
  const batch = insertLedger.mock.calls[insertLedger.mock.calls.length - 1][0] as Array<{
    tab: string;
    rowJson: string;
    runId: string | null;
    reason: string;
    delivered: boolean;
  }>;
  return batch[0];
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
  arm();
});

// ─── The happy path records an audit-only row ────────────────────────────

describe("export ledger capture: success", () => {
  test("a successful append is recorded with delivered: true and the runId", async () => {
    const result = await exportRows("swing", [["RELIANCE", "1"]], "job-77");

    expect(result).toBe("enabled");
    expect(insertLedger).toHaveBeenCalledTimes(1);

    const row = lastLedgerRow();
    expect(row).toMatchObject({
      tab: "swing",
      runId: "job-77",
      reason: "appended",
      delivered: true,
    });
    expect(JSON.parse(row.rowJson)).toEqual(["RELIANCE", "1"]);
  });

  test("a delivered row is never replayable — it is written, not queued", async () => {
    await exportRows("swing", [["A"]], "job-1");
    // `delivered: true` is the ONLY thing that keeps a successful export out of
    // the drain's `delivered = 0` backlog query, so assert the flag itself
    // rather than the absence of a second write.
    expect(lastLedgerRow().delivered).toBe(true);
  });

  test("one ledger row is written per exported row", async () => {
    await exportRows("swing", [["A"], ["B"], ["C"]], "job-2");

    const batch = insertLedger.mock.calls[0][0] as unknown[];
    expect(batch).toHaveLength(3);
    expect(batch.every((r) => (r as { delivered: boolean }).delivered === true)).toBe(true);
  });
});

// ─── Every failure mode records UNDELIVERED ─────────────────────────────

describe("export ledger capture: failures stay queued", () => {
  test("a non-transient append error records delivered: false", async () => {
    valuesAppend.mockRejectedValue(httpError(403));

    const result = await exportRows("swing", [["A"]], "job-3");

    expect(result).toBe("failed");
    expect(lastLedgerRow()).toMatchObject({
      tab: "swing",
      runId: "job-3",
      reason: "failed",
      delivered: false,
    });
  });

  test("an exhausted transient error records delivered: false", async () => {
    valuesAppend.mockRejectedValue(httpError(503));

    const result = await exportRows("swing", [["A"]], "job-4");

    expect(result).toBe("failed");
    expect(valuesAppend).toHaveBeenCalledTimes(2); // one retry, then give up
    expect(lastLedgerRow()).toMatchObject({ reason: "failed", delivered: false });
  });

  test("a missing spreadsheet id records delivered: false without any network call", async () => {
    arm(true, null); // env has no id and the mirror has none

    const result = await exportRows("swing", [["A"]], "job-5");

    expect(result).toBe("failed");
    expect(valuesAppend).not.toHaveBeenCalled();
    expect(lastLedgerRow()).toMatchObject({
      reason: "no-spreadsheet",
      delivered: false,
      runId: "job-5",
    });
  });

  test("the mirror's sheet id takes precedence over the env id", async () => {
    configRow = { sheetId: SHEET_ID, displayName: "Tracker", enabled: true, lastSyncAt: null, tabMarks: {} };
    mockAuth.trackerSheetId.mockReturnValue("env-should-not-be-used");

    const result = await exportRows("swing", [["A"]]);

    expect(result).toBe("enabled");
    expect(valuesAppend).toHaveBeenCalledWith(
      expect.objectContaining({ spreadsheetId: SHEET_ID })
    );
  });
});

// ─── Cases that must NOT record ─────────────────────────────────────────

describe("export ledger capture: what is deliberately not recorded", () => {
  test("the sync drain never records — no duplicate audit rows", async () => {
    const result = await exportRowsFromSync("swing", [["A"]]);

    expect(result).toBe("enabled");
    expect(valuesAppend).toHaveBeenCalledTimes(1);
    expect(insertLedger).not.toHaveBeenCalled();
  });

  test("a failing drain does not re-queue (bounds the backlog)", async () => {
    valuesAppend.mockRejectedValue(httpError(403));

    const result = await exportRowsFromSync("swing", [["A"]]);

    expect(result).toBe("failed");
    expect(insertLedger).not.toHaveBeenCalled();
  });

  test("the decisions tab is never recorded", async () => {
    const result = await exportRows("decisions", [["x"]], "run-d");

    expect(result).toBe("enabled");
    expect(insertLedger).not.toHaveBeenCalled();
  });

  test("the env gate being off records nothing", async () => {
    arm(false, SHEET_ID);

    const result = await exportRows("swing", [["A"]], "job-6");

    expect(result).toBe("disabled");
    expect(valuesAppend).not.toHaveBeenCalled();
    expect(insertLedger).not.toHaveBeenCalled();
  });

  test("the DB switch being off records nothing even when the env is on", async () => {
    configRow = { ...configRow!, enabled: false };

    const result = await exportRows("swing", [["A"]], "job-7");

    expect(result).toBe("disabled");
    expect(insertLedger).not.toHaveBeenCalled();
  });

  test("an empty batch records nothing", async () => {
    const result = await exportRows("swing", [], "job-8");

    expect(result).toBe("enabled");
    expect(insertLedger).not.toHaveBeenCalled();
  });
});

// ─── Ledger writes can never reach the producer ──────────────────────────

describe("export ledger capture: the mirror is best-effort", () => {
  test("a throwing insert does not turn a successful append into a failure", async () => {
    insertLedger.mockImplementation(() => {
      throw new Error("mirror exploded");
    });

    await expect(exportRows("swing", [["A"]], "job-9")).resolves.toBe("enabled");
  });

  test("a missing mirror does not turn a successful append into a failure", async () => {
    sqliteReady = false;

    await expect(exportRows("swing", [["A"]], "job-10")).resolves.toBe("enabled");
  });

  test("a missing mirror on the failure path still reports failed", async () => {
    valuesAppend.mockRejectedValue(httpError(403));
    sqliteReady = false;

    await expect(exportRows("swing", [["A"]])).resolves.toBe("failed");
  });
});

// ─── runId provenance threading ─────────────────────────────────────────

describe("export ledger capture: runId provenance", () => {
  test("swing records the job id that produced the picks", async () => {
    await exportSwing([{ symbol: "RELIANCE" } as SwingStock], "job-42");

    expect(lastLedgerRow()).toMatchObject({ tab: "swing", runId: "job-42", delivered: true });
  });

  test("daily-rec records the run id from its context", async () => {
    const stock = {
      symbol: "TCS",
      price: 100,
      change: 1,
      changePercent: 1,
      volume: 10,
    } as DailyRecStockInput;

    await exportDailyRecs({ runId: "run-99", runDate: "2026-09-27" }, [stock]);

    expect(lastLedgerRow()).toMatchObject({ tab: "daily-rec", runId: "run-99", delivered: true });
  });

  test("screener records the scan run id", async () => {
    const hit = { symbol: "INFY", close: 10, change: 1 } as unknown as ScreenerRowInput;

    await exportScreeners([hit], { runId: "scan-1" });

    expect(lastLedgerRow()).toMatchObject({ tab: "screener", runId: "scan-1", delivered: true });
  });

  test("a screener pass with no run id records null rather than undefined", async () => {
    const hit = { symbol: "INFY", close: 10, change: 1 } as unknown as ScreenerRowInput;

    await exportScreeners([hit]);

    expect(lastLedgerRow()).toMatchObject({ tab: "screener", runId: null });
  });

  test("custom records the run id without changing the 13-column row contract", async () => {
    await exportCustomScan(
      {
        runAt: "2026-09-27T00:00:00.000Z",
        configId: "c1",
        configName: "Breakout",
        userId: "1",
        filters: {},
        matchCount: 1,
      },
      [{ symbol: "SBIN" }],
      "scan-2"
    );

    const row = lastLedgerRow();
    expect(row).toMatchObject({ tab: "custom", runId: "scan-2", delivered: true });
    // The run id is ledger provenance only — it must not leak into the sheet row.
    expect(JSON.parse(row.rowJson)).toHaveLength(13);
    expect(JSON.parse(row.rowJson)).not.toContain("scan-2");
  });
});
