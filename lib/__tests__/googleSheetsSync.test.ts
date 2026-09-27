/**
 * Spec 20 §5.B — the manual per-tab "Sync now" drain.
 *
 * The drain is the piece with real teeth, so the tests target its failure modes
 * rather than the happy path alone:
 *
 *  - cursor discipline (the property that prevents both duplicate and skipped rows)
 *  - at-least-once: a failed append must NOT advance the cursor
 *  - the confirmation gate: a large backlog must not drain on an unconfirmed click
 *  - the exclusion and gate-off paths
 *  - a corrupt ledger row must not become an empty append
 *  - one throwing tab must not strand the others
 */
import {
  syncTab,
  syncTabs,
  readTabCursor,
  getBacklogCounts,
  getUnreadableSeqs,
  SYNC_ROW_CAP,
  SYNC_CONFIRM_THRESHOLD,
  UNREADABLE_REPORT_CAP,
} from "@/lib/services/googleSheets/syncService";

jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("@/lib/audit", () => ({ createAuditLog: jest.fn(async () => ({ id: 1 })) }));

jest.mock("@/lib/sqlite", () => ({
  getSqliteFallback: jest.fn(() => ({
    getGoogleSheetsLedgerBacklog: jest.fn(() => []),
    getGoogleSheetsLedgerCounts: jest.fn(() => ({})),
    markGoogleSheetsLedgerDelivered: jest.fn((seqs: number[]) => seqs.length),
    deleteGoogleSheetsLedgerRows: jest.fn(() => 0),
    pruneGoogleSheetsLedger: jest.fn(() => 0),
  })),
}));

jest.mock("@/lib/services/googleSheets/exporter", () => ({
  exportRowsFromSync: jest.fn(),
}));

jest.mock("@/lib/services/googleSheets/configService", () => ({
  isTrackingActive: jest.fn(() => true),
  getConfig: jest.fn(() => ({ tabMarks: {} })),
  setTabMark: jest.fn(),
}));

/** The live shape of the mocked mirror, so a test can retarget a single call. */
const mockSqlite = {
  getGoogleSheetsLedgerBacklog: jest.fn() as jest.Mock,
  getGoogleSheetsLedgerCounts: jest.fn() as jest.Mock,
  markGoogleSheetsLedgerDelivered: jest.fn() as jest.Mock,
  deleteGoogleSheetsLedgerRows: jest.fn() as jest.Mock,
  pruneGoogleSheetsLedger: jest.fn() as jest.Mock,
};

import { getSqliteFallback } from "@/lib/sqlite";
import { exportRowsFromSync } from "@/lib/services/googleSheets/exporter";
import { isTrackingActive, setTabMark, getConfig } from "@/lib/services/googleSheets/configService";

const mockExport = exportRowsFromSync as jest.Mock;
const mockActive = isTrackingActive as jest.Mock;
const mockSetTabMark = setTabMark as jest.Mock;
const mockGetConfig = getConfig as jest.Mock;

/** Build ledger entries with strictly increasing seq, as the real table does. */
function ledger(tab: string, start: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    seq: start + i,
    tab,
    rowJson: [`row-${start + i}-a`, "x"],
    runId: null,
    reason: "failed",
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  (getSqliteFallback as jest.Mock).mockImplementation(() => mockSqlite);
  mockActive.mockReturnValue(true);
  mockGetConfig.mockReturnValue({ tabMarks: {} });
  mockSqlite.getGoogleSheetsLedgerBacklog.mockReturnValue([]);
  mockSqlite.getGoogleSheetsLedgerCounts.mockReturnValue({});
  mockSqlite.markGoogleSheetsLedgerDelivered.mockImplementation((seqs: number[]) => seqs.length);
  mockSqlite.deleteGoogleSheetsLedgerRows.mockReturnValue(0);
  mockSqlite.pruneGoogleSheetsLedger.mockReturnValue(0);
  mockExport.mockResolvedValue("enabled");
});

describe("readTabCursor", () => {
  it("treats a missing, non-numeric or non-positive mark as 0", () => {
    mockGetConfig.mockReturnValue({ tabMarks: {} });
    expect(readTabCursor("swing")).toBe(0);
    mockGetConfig.mockReturnValue({ tabMarks: { swing: "not-a-number" } });
    expect(readTabCursor("swing")).toBe(0);
    mockGetConfig.mockReturnValue({ tabMarks: { swing: "-4" } });
    expect(readTabCursor("swing")).toBe(0);
  });

  it("reads a stored seq as a number", () => {
    mockGetConfig.mockReturnValue({ tabMarks: { swing: "340" } });
    expect(readTabCursor("swing")).toBe(340);
  });
});

/**
 * The corrupt-row discovery pass. It is separate from the drain on purpose, and
 * the two facts that make it correct are easy to "simplify" away:
 *
 *  1. it scans from seq 0, IGNORING the drain cursor. A drain that trips on an
 *     unappendable row refuses to advance the cursor, so the blocking row is
 *     always at or before the cursor. Reading from the cursor would find nothing
 *     and the console would offer no way to unblock the tab.
 *  2. it over-fetches by one (`limit + 1`) so the cap bounds REPORTED matches
 *     rather than scanned rows, and then trims — otherwise a backlog of 200
 *     clean rows followed by one bad row reports "0 unreadable".
 */
describe("getUnreadableSeqs", () => {
  /** Ledger rows for one tab: readable (2 cells) or corrupt (unparsable/empty). */
  const rows = (bad: number[], start = 1) =>
    Array.from({ length: 5 }, (_, i) => {
      const seq = start + i;
      return {
        seq,
        tab: "swing",
        // A corrupt row is what a crashed/degraded exporter leaves behind.
        rowJson: bad.includes(seq) ? "{not json" : JSON.stringify(["ok", seq]),
        runId: null,
        reason: "failed",
      };
    });

  it("scans from seq 0 even when the drain cursor is far ahead", () => {
    // The blocking row (seq 1) sits BEHIND the cursor, which is exactly the
    // state a failed drain leaves. Cursor-scoped discovery would return [].
    mockGetConfig.mockReturnValue({ tabMarks: { swing: "99" } });
    mockSqlite.getGoogleSheetsLedgerBacklog.mockReturnValue(rows([1]));

    expect(getUnreadableSeqs("swing")).toEqual([1]);
    expect(mockSqlite.getGoogleSheetsLedgerBacklog).toHaveBeenCalledWith("swing", 0, UNREADABLE_REPORT_CAP + 1);
  });

  it("caps the number of REPORTED seqs, not the number of rows scanned", () => {
    // Rows 1-2 clean, 3-5 corrupt, cap 2. Reading exactly `limit` rows would
    // report only seq 3 and hide the fact that 5 is also stuck.
    mockSqlite.getGoogleSheetsLedgerBacklog.mockReturnValue(rows([3, 4, 5]));

    expect(getUnreadableSeqs("swing", 2)).toEqual([3, 4]);
    expect(mockSqlite.getGoogleSheetsLedgerBacklog).toHaveBeenCalledWith("swing", 0, 3);
  });

  it("defaults to UNREADABLE_REPORT_CAP and over-fetches one row", () => {
    mockSqlite.getGoogleSheetsLedgerBacklog.mockReturnValue([]);
    getUnreadableSeqs("swing");
    expect(mockSqlite.getGoogleSheetsLedgerBacklog).toHaveBeenCalledWith(
      "swing",
      0,
      UNREADABLE_REPORT_CAP + 1,
    );
  });

  it("treats an unparsable, non-array or empty payload as unreadable", () => {
    const mixed = [
      { seq: 1, tab: "swing", rowJson: "{not json", runId: null, reason: "failed" },
      { seq: 2, tab: "swing", rowJson: JSON.stringify([]), runId: null, reason: "failed" },
      { seq: 3, tab: "swing", rowJson: JSON.stringify({ a: 1 }), runId: null, reason: "failed" },
      { seq: 4, tab: "swing", rowJson: JSON.stringify(["fine", 4]), runId: null, reason: "failed" },
    ];
    mockSqlite.getGoogleSheetsLedgerBacklog.mockReturnValue(mixed);

    // seq 4 is the only appendable row, so the other three are the blockers.
    expect(getUnreadableSeqs("swing")).toEqual([1, 2, 3]);
  });

  it("returns nothing for the excluded decisions tab", () => {
    expect(getUnreadableSeqs("decisions")).toEqual([]);
    expect(mockSqlite.getGoogleSheetsLedgerBacklog).not.toHaveBeenCalled();
  });

  it("returns nothing for an unknown tab", () => {
    expect(getUnreadableSeqs("nope" as never)).toEqual([]);
    expect(mockSqlite.getGoogleSheetsLedgerBacklog).not.toHaveBeenCalled();
  });

  it("returns nothing when the mirror is unavailable", () => {
    (getSqliteFallback as jest.Mock).mockReturnValue(null);
    expect(getUnreadableSeqs("swing")).toEqual([]);
  });

  it("returns nothing for a clean backlog", () => {
    mockSqlite.getGoogleSheetsLedgerBacklog.mockReturnValue(rows([]));
    expect(getUnreadableSeqs("swing")).toEqual([]);
  });
});

describe("syncTab — empty and corrupt backlogs", () => {
  it("reports empty without calling the exporter when nothing is queued", async () => {
    const r = await syncTab("swing");
    expect(r.status).toBe("empty");
    expect(r.rows).toBe(0);
    expect(mockExport).not.toHaveBeenCalled();
  });

  it("never appends a corrupt/empty row and parks it for operator removal", async () => {
    mockSqlite.getGoogleSheetsLedgerBacklog.mockReturnValue([
      { seq: 1, tab: "swing", rowJson: [], runId: null, reason: "failed" },
      { seq: 2, tab: "swing", rowJson: null, runId: null, reason: "failed" },
    ]);
    // The rows stay undelivered, so the console still shows them as owed work
    // until the operator removes them.
    mockSqlite.getGoogleSheetsLedgerCounts.mockReturnValue({ swing: { queued: 2, retained: 2 } });
    const r = await syncTab("swing");
    // Not "empty": unreadable rows are owed, so the tab is not finished.
    expect(r.status).toBe("unreadable");
    expect(r.remaining).toBe(2);
    // The seqs are surfaced so the operator can delete exactly these rows.
    expect(r.unreadableSeqs).toEqual([1, 2]);
    expect(r.detail).toMatch(/unreadable/);
    expect(mockExport).not.toHaveBeenCalled();
  });

  it("stops the drain AT the corrupt row instead of jumping over it", async () => {
    mockSqlite.getGoogleSheetsLedgerBacklog.mockReturnValue([
      { seq: 1, tab: "swing", rowJson: ["ok", "1"], runId: null, reason: "failed" },
      { seq: 2, tab: "swing", rowJson: [], runId: null, reason: "failed" },
      { seq: 3, tab: "swing", rowJson: ["ok", "3"], runId: null, reason: "failed" },
    ]);
    // The corrupt row is still owed after the drain.
    mockSqlite.getGoogleSheetsLedgerCounts.mockReturnValue({ swing: { queued: 2, retained: 3 } });
    const r = await syncTab("swing");

    expect(r.status).toBe("drained");
    // Only the rows BEFORE the corrupt one are appended: the backlog query reads
    // `seq > cursor`, so appending seq 3 would park the cursor past seq 2 and make
    // it permanently invisible (still counted in `queued`, never reportable again).
    expect(r.rows).toBe(1);
    expect(mockExport).toHaveBeenCalledWith("swing", [["ok", "1"]]);

    // The cursor parks directly BELOW the corrupt row, so every later drain
    // re-reads and re-reports it until the operator deletes it.
    expect(mockSetTabMark).toHaveBeenCalledWith("swing", "1");
    expect(r.cursor).toBe("1");

    // Still surfaced, and the held-back row is accounted for, not implied done.
    expect(r.unreadableSeqs).toEqual([2]);
    expect(r.remaining).toBe(2);
    expect(r.detail).toMatch(/paused at the first unreadable row/i);
    expect(r.detail).toMatch(/held back in order/i);
  });

  it("does not append rows after a corrupt row, preserving ledger order", async () => {
    mockSqlite.getGoogleSheetsLedgerBacklog.mockReturnValue([
      { seq: 1, tab: "swing", rowJson: null, runId: null, reason: "failed" },
      { seq: 2, tab: "swing", rowJson: ["ok", "2"], runId: null, reason: "failed" },
    ]);
    mockSqlite.getGoogleSheetsLedgerCounts.mockReturnValue({ swing: { queued: 2, retained: 2 } });
    const r = await syncTab("swing");

    // A corrupt FIRST row blocks the whole window: the tracker must not receive
    // seq 2 ahead of seq 1, so nothing is appended and the cursor never moves.
    expect(r.status).toBe("unreadable");
    expect(r.rows).toBe(0);
    expect(mockExport).not.toHaveBeenCalled();
    expect(mockSetTabMark).not.toHaveBeenCalled();
    expect(r.unreadableSeqs).toEqual([1]);
  });

  it("re-reports a parked corrupt row on every later drain (durable discovery)", async () => {
    // First drain parks the cursor at 1 and reports seq 2. The corrupt row is
    // still in the table, so the NEXT drain (cursor 1) must surface it again —
    // this is the property that makes the operator's DELETE actionable.
    mockSqlite.getGoogleSheetsLedgerBacklog.mockReturnValue([
      { seq: 2, tab: "swing", rowJson: [], runId: null, reason: "failed" },
      { seq: 3, tab: "swing", rowJson: ["ok", "3"], runId: null, reason: "failed" },
    ]);
    mockGetConfig.mockReturnValue({ tabMarks: { swing: "1" } });
    mockSqlite.getGoogleSheetsLedgerCounts.mockReturnValue({ swing: { queued: 2, retained: 3 } });

    const r = await syncTab("swing");

    // The property this guards: seq 2 is re-reported on the LATER drain even
    // though the cursor is already 1. That re-reporting is what gives the
    // operator the id their DELETE needs, however long they wait.
    expect(r.unreadableSeqs).toEqual([2]);
    // And the drain stays parked: it neither advances the cursor past seq 2 nor
    // appends seq 3 ahead of it.
    expect(r.status).toBe("unreadable");
    expect(r.rows).toBe(0);
    expect(mockExport).not.toHaveBeenCalled();
    expect(mockSetTabMark).not.toHaveBeenCalled();
  });

  it("drains the held-back rows once the corrupt row is removed", async () => {
    // Operator removed seq 2; the backlog now starts at seq 3 and the cursor is
    // still 1, so the remaining work flows normally.
    mockSqlite.getGoogleSheetsLedgerBacklog.mockReturnValue([
      { seq: 3, tab: "swing", rowJson: ["ok", "3"], runId: null, reason: "failed" },
    ]);
    mockGetConfig.mockReturnValue({ tabMarks: { swing: "1" } });
    mockSqlite.getGoogleSheetsLedgerCounts.mockReturnValue({ swing: { queued: 1, retained: 3 } });

    const r = await syncTab("swing");

    expect(r.status).toBe("drained");
    expect(r.rows).toBe(1);
    expect(r.unreadableSeqs).toBeUndefined();
    expect(mockSetTabMark).toHaveBeenCalledWith("swing", "3");
  });
});

describe("syncTab — delivered marker", () => {
  it("marks only the appended rows delivered, and never the parked ones", async () => {
    mockSqlite.getGoogleSheetsLedgerBacklog.mockReturnValue([
      { seq: 10, tab: "swing", rowJson: ["a"], runId: null, reason: "failed" },
      { seq: 11, tab: "swing", rowJson: [], runId: null, reason: "failed" },
      { seq: 12, tab: "swing", rowJson: ["b"], runId: null, reason: "failed" },
    ]);
    const r = await syncTab("swing");
    expect(r.status).toBe("drained");
    // Only seq 10 is appended: seq 11 blocks everything after it (appending 12
    // would put the sheet out of ledger order and strand 11). So the marker gets
    // 10 alone, and the corrupt 11 stays undelivered and visible for removal.
    expect(mockSqlite.markGoogleSheetsLedgerDelivered).toHaveBeenCalledWith([10]);
    expect(r.unreadableSeqs).toEqual([11]);
  });

  it("advances the cursor even if the delivered-marker write throws (no duplicate appends)", async () => {
    mockSqlite.getGoogleSheetsLedgerBacklog.mockReturnValue(ledger("swing", 5, 2));
    mockSqlite.markGoogleSheetsLedgerDelivered.mockImplementation(() => {
      throw new Error("marker unavailable");
    });
    const r = await syncTab("swing");
    // The rows ARE on the sheet, so the cursor must advance; otherwise the next
    // drain would re-append them as duplicates.
    expect(r.status).toBe("drained");
    expect(mockSetTabMark).toHaveBeenCalledWith("swing", "6");
  });

  // The second half of the invariant above, and the reason the console
  // explains "queued" instead of calling it a replay count. The rows are on the
  // sheet and the cursor moved past them, so the cursor-scoped backlog query
  // finds nothing — yet the undelivered count stays > 0 because the `delivered`
  // flag was never written. `status: empty` with `remaining: 1` is therefore a
  // NORMAL outcome, not a stuck queue, and it clears itself only when pruning
  // ages the row out. Replay must not "fix" it: doing so would duplicate a row
  // that already reached the sheet.
  it("leaves marker residue counted but unreplayable, and does not re-append it", async () => {
    mockGetConfig.mockReturnValue({ tabMarks: { swing: "6" } });
    // The cursor-scoped query legitimately returns nothing at seq > 6.
    mockSqlite.getGoogleSheetsLedgerBacklog.mockReturnValue([]);
    // ...but seq 5 is still counted undelivered, because the marker write threw.
    mockSqlite.getGoogleSheetsLedgerCounts.mockReturnValue({ swing: { queued: 1, retained: 2 } });

    const r = await syncTab("swing");

    expect(r.status).toBe("empty");
    expect(r.rows).toBe(0);
    expect(r.remaining).toBe(1);
    // The decisive assertion: a drain must not touch the exporter for residue.
    expect(mockExport).not.toHaveBeenCalled();
    expect(mockSqlite.markGoogleSheetsLedgerDelivered).not.toHaveBeenCalled();
    // The cursor is untouched, so the residue stays below it and stays unsent.
    expect(mockSetTabMark).not.toHaveBeenCalled();
  });
});

describe("syncTab — cursor discipline", () => {
  it("advances the cursor to the last row actually sent", async () => {
    mockSqlite.getGoogleSheetsLedgerBacklog.mockReturnValue(ledger("swing", 100, 3));
    const r = await syncTab("swing");
    expect(r.status).toBe("drained");
    expect(r.rows).toBe(3);
    expect(r.cursor).toBe("102");
    expect(mockSetTabMark).toHaveBeenCalledWith("swing", "102");
  });

  it("does NOT advance the cursor when the append fails, so the retry re-appends", async () => {
    mockSqlite.getGoogleSheetsLedgerBacklog.mockReturnValue(ledger("swing", 100, 3));
    mockSqlite.getGoogleSheetsLedgerCounts.mockReturnValue({ swing: { queued: 3, retained: 3 } });
    mockExport.mockResolvedValue("failed");
    const r = await syncTab("swing");
    expect(r.status).toBe("failed");
    expect(r.rows).toBe(0);
    // Nothing was delivered, so the same 3 rows are still owed.
    expect(r.remaining).toBe(3);
    expect(mockSetTabMark).not.toHaveBeenCalled();
    expect(mockSqlite.markGoogleSheetsLedgerDelivered).not.toHaveBeenCalled();
    expect(r.detail).toMatch(/cursor not advanced/);
  });

  it("does not advance the cursor on a no-spreadsheet result either", async () => {
    mockSqlite.getGoogleSheetsLedgerBacklog.mockReturnValue(ledger("swing", 1, 1));
    mockExport.mockResolvedValue("no-spreadsheet");
    const r = await syncTab("swing");
    expect(r.status).toBe("failed");
    expect(mockSetTabMark).not.toHaveBeenCalled();
  });

  it("handles two identical rows without skipping one", async () => {
    const dup = [
      { seq: 7, tab: "swing", rowJson: ["same"], runId: null, reason: "failed" },
      { seq: 8, tab: "swing", rowJson: ["same"], runId: null, reason: "failed" },
    ];
    mockSqlite.getGoogleSheetsLedgerBacklog.mockReturnValue(dup);
    const r = await syncTab("swing");
    expect(r.rows).toBe(2);
    expect(mockSetTabMark).toHaveBeenCalledWith("swing", "8");
  });
});

describe("syncTab — confirmation gate and caps", () => {
  it("refuses to append a large backlog without confirmation", async () => {
    mockSqlite.getGoogleSheetsLedgerBacklog.mockReturnValue(
      ledger("swing", 1, SYNC_CONFIRM_THRESHOLD + 1),
    );
    mockSqlite.getGoogleSheetsLedgerCounts.mockReturnValue({
      swing: { queued: SYNC_CONFIRM_THRESHOLD + 1, retained: SYNC_CONFIRM_THRESHOLD + 1 },
    });
    const r = await syncTab("swing", false);
    expect(r.status).toBe("needs-confirmation");
    expect(r.rows).toBe(0);
    expect(r.remaining).toBe(SYNC_CONFIRM_THRESHOLD + 1);
    expect(mockExport).not.toHaveBeenCalled();
    expect(mockSetTabMark).not.toHaveBeenCalled();
  });

  it("drains a large backlog when confirmed", async () => {
    mockSqlite.getGoogleSheetsLedgerBacklog.mockReturnValue(
      ledger("swing", 1, SYNC_CONFIRM_THRESHOLD + 1),
    );
    const r = await syncTab("swing", true);
    expect(r.status).toBe("drained");
    expect(r.rows).toBe(SYNC_CONFIRM_THRESHOLD + 1);
  });

  it("caps one drain at SYNC_ROW_CAP and leaves the rest queued", async () => {
    mockSqlite.getGoogleSheetsLedgerBacklog.mockReturnValue(ledger("swing", 1, SYNC_ROW_CAP + 50));
    const r = await syncTab("swing", true);
    expect(r.rows).toBe(SYNC_ROW_CAP);
    expect(r.cursor).toBe(String(SYNC_ROW_CAP));
  });

  it("drains a backlog at the threshold without needing confirmation", async () => {
    mockSqlite.getGoogleSheetsLedgerBacklog.mockReturnValue(
      ledger("swing", 1, SYNC_CONFIRM_THRESHOLD),
    );
    const r = await syncTab("swing", false);
    expect(r.status).toBe("drained");
  });
});

describe("syncTab — exclusions and guards", () => {
  it("skips the decisions tab with an explanation", async () => {
    const r = await syncTab("decisions");
    expect(r.status).toBe("skipped");
    expect(r.detail).toMatch(/excluded/);
    expect(mockExport).not.toHaveBeenCalled();
  });

  it("fails cleanly when the SQLite mirror is not ready", async () => {
    (getSqliteFallback as jest.Mock).mockReturnValueOnce(null);
    const r = await syncTab("swing");
    expect(r.status).toBe("failed");
    expect(r.detail).toMatch(/not ready/);
  });
});

describe("syncTabs", () => {
  it("refuses everything when tracking is disabled, and never calls the exporter", async () => {
    mockActive.mockReturnValue(false);
    const r = await syncTabs(["swing", "custom"]);
    expect(r.status).toBe("failed");
    expect(r.tabs.every((t) => t.status === "skipped")).toBe(true);
    expect(mockExport).not.toHaveBeenCalled();
  });

  it("drains tabs sequentially", async () => {
    const order: string[] = [];
    mockExport.mockImplementation(async (tab: string) => {
      order.push(tab);
      return "enabled";
    });
    mockSqlite.getGoogleSheetsLedgerBacklog.mockImplementation((tab: string) => ledger(tab, 1, 1));
    const r = await syncTabs(["swing", "screener", "custom"]);
    expect(order).toEqual(["swing", "screener", "custom"]);
    expect(r.status).toBe("ok");
  });

  it("keeps going when one tab throws, and reports partial", async () => {
    mockSqlite.getGoogleSheetsLedgerBacklog.mockImplementation((tab: string) => {
      if (tab === "swing") throw new Error("sqlite exploded");
      return ledger(tab, 1, 1);
    });
    const r = await syncTabs(["swing", "screener"]);
    expect(r.status).toBe("partial");
    expect(r.tabs.find((t) => t.tab === "swing")?.status).toBe("failed");
    expect(r.tabs.find((t) => t.tab === "swing")?.detail).toMatch(/sqlite exploded/);
    expect(r.tabs.find((t) => t.tab === "screener")?.status).toBe("drained");
  });

  it("reports needs-confirmation when any tab exceeds the threshold", async () => {
    mockSqlite.getGoogleSheetsLedgerBacklog.mockImplementation((tab: string) =>
      ledger(tab, 1, tab === "swing" ? SYNC_CONFIRM_THRESHOLD + 1 : 1),
    );
    const r = await syncTabs(["swing", "custom"], false);
    expect(r.status).toBe("needs-confirmation");
  });

  it("returns startedAt and finishedAt ISO stamps", async () => {
    const r = await syncTabs(["swing"]);
    expect(new Date(r.startedAt).toISOString()).toBe(r.startedAt);
    expect(new Date(r.finishedAt).toISOString()).toBe(r.finishedAt);
  });
});

describe("getBacklogCounts", () => {
  it("degrades to an empty object when the mirror is not ready", () => {
    (getSqliteFallback as jest.Mock).mockReturnValueOnce(null);
    expect(getBacklogCounts()).toEqual({});
  });
});
