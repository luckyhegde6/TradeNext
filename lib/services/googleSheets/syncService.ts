/**
 * Spec 20 §5.B — manual per-tab "Sync now".
 *
 * DESIGN (this supersedes the spec's original "re-derive rows from the source
 * tables" idea, which turned out to be unfaithful for 2 of the 4 stream tabs):
 *
 * The four stream tabs (swing / daily-rec / screener / custom) keep NOTHING
 * queryable — unified screener uses a throwaway runId and an in-memory cache,
 * custom scans run live and hand rows straight to the exporter. There is no
 * table to re-read, so a re-derivation would either fabricate history that never
 * existed or silently differ from what the live export writes.
 *
 * Instead `exporter.exportRows` records the ENCODED row in the SQLite ledger on
 * EVERY export attempt, carrying a `delivered` marker. "Sync now" simply DRAINS
 * the rows still marked undelivered. Consequences:
 *
 *  - Byte-identical rows: the drain replays the exact cell array the sheet was
 *    meant to receive, not a re-query that could drift.
 *  - No duplicates: a row is marked delivered only after its append returns
 *    "enabled", so a delivered row is never re-queued and cannot be replayed
 *    onto the sheet. At-least-once holds; exactly-once does not, and cannot,
 *    because an interrupted append is indistinguishable from a lost one — the
 *    only ambiguity left is the single in-flight batch during a crash.
 *  - Full audit: the ledger also holds successful rows (delivered=1) until the
 *    retention prune, so "what did we export" is answerable after the fact.
 *    `queued` (undelivered) is what remains owed; `retained` is the audit total.
 *  - No re-scan: history that was never captured cannot be invented, and a
 *    fresh scan is a *different* feature (a manual trigger that burns NSE/TV
 *    quota and produces new rows, not a sync of old ones). See `rescanScreenerTab`
 *    for that, which is explicitly opt-in and never runs as part of a drain.
 *
 * SQLite-first: every read and the cursor write go to the mirror, so this works
 * unchanged under the P6003 plan-limit hold.
 */

import { getSqliteFallback, type GoogleSheetsLedgerCounts } from "@/lib/sqlite";
import logger from "@/lib/logger";

import { TRACKER_TABS, isTrackerTab, type TrackerTab } from "./tabs";
import { exportRowsFromSync } from "./exporter";
import { ledgerRowIsUnreadable } from "./rows";
import { getConfig, setTabMark, isTrackingActive } from "./configService";

/** Rows per tab per drain. Bounded so one click cannot blow past the Sheets quota. */
export const SYNC_ROW_CAP = 200;
/** Above this the route must pass confirmed=true — a bulk append deserves a click. */
export const SYNC_CONFIRM_THRESHOLD = 100;
/** Rows kept in the ledger after a drain before pruning. Bounds unbounded growth. */
const LEDGER_KEEP = 5000;

/** Tabs the spec excludes from sync: a bounded in-memory ring buffer, by design. */
export const EXCLUDED_TABS: readonly TrackerTab[] = ["decisions"];

export type SyncTabStatus =
  | "drained"
  | "empty"
  /** Nothing appendable, but unreadable rows are parked and need operator removal. */
  | "unreadable"
  | "skipped"
  | "needs-confirmation"
  | "failed";

export interface SyncTabResult {
  tab: TrackerTab;
  status: SyncTabStatus;
  /** Rows handed to the Sheets append (0 when skipped or empty). */
  rows: number;
  /** Rows still OWE a live append for this tab (undelivered), after the drain. */
  remaining: number;
  /** Drain cursor after the run (monotonic ledger seq), or the previous value. */
  cursor: string | null;
  /**
   * Ledger seqs whose `row_json` is not a non-empty array, so they can never be
   * appended. They stay undelivered (visible in `remaining`) and are NOT dropped
   * or silently skipped past: the operator removes them via the ledger DELETE
   * endpoint, after which the tab re-syncs clean. The row held no parsable data,
   * so "rewrite" means regenerate via the re-scan path, not repair the cell array.
   */
  unreadableSeqs?: number[];
  detail?: string;
}

export interface SyncRunResult {
  status: "ok" | "needs-confirmation" | "partial" | "failed";
  tabs: SyncTabResult[];
  startedAt: string;
  finishedAt: string;
}

/** Reads the stored drain cursor for a tab. A missing/invalid mark means 0. */
export function readTabCursor(tab: TrackerTab): number {
  const raw = getConfig().tabMarks?.[tab];
  const n = raw == null ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Ledger counts per tab, for the console. `queued` is what still owes an append;
 * `retained` is the full audit total (delivered rows kept for the retention
 * window). Never throws.
 */
export function getBacklogCounts(): Record<string, GoogleSheetsLedgerCounts> {
  return getSqliteFallback()?.getGoogleSheetsLedgerCounts() ?? {};
}

/** How many unreadable seqs a single tab will report. Bounds the status read:
 *  the scan below touches rows, so it must not grow with the backlog. */
export const UNREADABLE_REPORT_CAP = 200;

/**
 * Seq numbers of rows in a tab that can never append, i.e. the ones a drain will
 * stop on. Read-only: nothing is marked or deleted here, the console just needs
 * to show the operator *which* rows are stuck so they can remove them.
 *
 * Scans from seq 0, NOT from the drain cursor. A row that is unreadable but sits
 * behind the cursor is the worst case — the drain walks straight past it and
 * reports success, so it is exactly the row an operator must be told about.
 * Excluded tabs are in-memory only and have no ledger rows.
 */
export function getUnreadableSeqs(tab: TrackerTab, limit = UNREADABLE_REPORT_CAP): number[] {
  if (!isTrackerTab(tab) || EXCLUDED_TABS.includes(tab)) return [];
  const sqlite = getSqliteFallback();
  if (!sqlite) return [];
  // afterSeq 0 = every undelivered row, cursor position deliberately ignored.
  const rows = sqlite.getGoogleSheetsLedgerBacklog(tab, 0, limit + 1);
  const seqs: number[] = [];
  for (const r of rows) {
    if (seqs.length >= limit) break;
    if (ledgerRowIsUnreadable(r.rowJson)) seqs.push(r.seq);
  }
  return seqs;
}

/**
 * Drains one tab's backlog.
 *
 * @param confirmed Set by the route when the operator acknowledged a >100-row
 *   drain. Without it a large backlog is reported, not appended — an accidental
 *   double-click must not push thousands of rows.
 */
export async function syncTab(tab: TrackerTab, confirmed = false): Promise<SyncTabResult> {
  if (!isTrackerTab(tab) || !(tab in TRACKER_TABS)) {
    return { tab, status: "failed", rows: 0, remaining: 0, cursor: null, detail: "unknown tab" };
  }
  if (EXCLUDED_TABS.includes(tab)) {
    return {
      tab,
      status: "skipped",
      rows: 0,
      remaining: 0,
      cursor: null,
      detail: "excluded by spec (in-memory only, not syncable)",
    };
  }

  const sqlite = getSqliteFallback();
  if (!sqlite) {
    return {
      tab,
      status: "failed",
      rows: 0,
      remaining: 0,
      cursor: null,
      detail: "SQLite mirror not ready",
    };
  }

  const cursor = readTabCursor(tab);
  const pending = sqlite.getGoogleSheetsLedgerBacklog(tab, cursor, SYNC_ROW_CAP + 1);

  // A corrupt row must not silently become an empty append. It is reported WITH
  // its seq and left undelivered so the operator can remove it, rather than being
  // dropped (lost audit) or appended as `[]` (garbage on the sheet).
  // seq travels WITH each row so the cursor advance below cannot be confused by
  // two identical rows in the same backlog.
  const usable: Array<{ seq: number; row: string[] }> = [];
  const unreadableSeqs: number[] = [];
  for (const entry of pending) {
    const row = entry.rowJson;
    // Shared predicate, so this and the admin DELETE guard can never disagree
    // about which rows are corrupt.
    if (ledgerRowIsUnreadable(row)) {
      unreadableSeqs.push(entry.seq);
      continue;
    }
    usable.push({ seq: entry.seq, row });
  }

  const unreadableDetail =
    unreadableSeqs.length > 0
      ? `${unreadableSeqs.length} unreadable ledger row(s) parked — remove them to finish this tab`
      : undefined;
  const queued = () => sqlite.getGoogleSheetsLedgerCounts()[tab]?.queued ?? 0;

  // The cursor must NEVER jump past an unreadable row. Two reasons, both fatal:
  //  1. The backlog query only reads `seq > cursor`, so a cursor past seq N makes
  //     that corrupt row permanently invisible — it stays counted in `queued`
  //     forever, but no drain can ever report its seq again, so the operator has
  //     no id to delete. That is the "silently abandoned" outcome the design
  //     explicitly forbids.
  //  2. The ledger is the sheet's ordering. Appending seq 3 while parking seq 2
  //     reorders a time-ordered tracker.
  // So the drain stops at the FIRST unreadable row and parks the cursor directly
  // below it; later rows are picked up on the pass after the operator removes it.
  const firstUnreadable =
    unreadableSeqs.length > 0 ? Math.min(...unreadableSeqs) : Number.POSITIVE_INFINITY;
  const sendable = usable.filter((u) => u.seq < firstUnreadable);

  // Nothing appendable. Unreadable rows still count as owed work (the operator
  // must remove them), so the tab is not reported as cleanly empty.
  if (sendable.length === 0) {
    return {
      tab,
      status: unreadableSeqs.length > 0 ? "unreadable" : "empty",
      rows: 0,
      remaining: queued(),
      cursor: cursor > 0 ? String(cursor) : null,
      unreadableSeqs: unreadableSeqs.length > 0 ? unreadableSeqs : undefined,
      detail: unreadableDetail,
    };
  }

  if (sendable.length > SYNC_CONFIRM_THRESHOLD && !confirmed) {
    return {
      tab,
      status: "needs-confirmation",
      rows: 0,
      remaining: queued(),
      cursor: cursor > 0 ? String(cursor) : null,
      unreadableSeqs: unreadableSeqs.length > 0 ? unreadableSeqs : undefined,
      detail: `${sendable.length} rows queued; re-run with confirmed=true to append (cap ${SYNC_ROW_CAP})`,
    };
  }

  const batch = sendable.slice(0, SYNC_ROW_CAP);
  const result = await exportRowsFromSync(tab, batch.map((u) => u.row));

  if (result !== "enabled") {
    // Cursor NOT advanced and nothing marked delivered, so the same batch is
    // re-appended on the next attempt. At-least-once by construction.
    return {
      tab,
      status: "failed",
      rows: 0,
      remaining: queued(),
      cursor: cursor > 0 ? String(cursor) : null,
      unreadableSeqs: unreadableSeqs.length > 0 ? unreadableSeqs : undefined,
      detail: `append returned "${result}" — cursor not advanced, so the retry re-appends`,
    };
  }

  // The append landed: mark exactly these rows delivered, then advance the cursor.
  //
  // The CURSOR is the primary replay guard, so it must be advanced even if the
  // marker write fails. A throw here would abort before `setTabMark`, leaving the
  // cursor below rows that are already on the sheet — the next drain would then
  // re-append them as duplicates. The marker is the secondary guard (it keeps
  // retained audit rows unreplayable even if a cursor is ever moved back), so its
  // failure is a warning, never a reason to withhold the cursor advance.
  const deliveredSeqs = batch.map((u) => u.seq);
  let marked = 0;
  try {
    marked = sqlite.markGoogleSheetsLedgerDelivered(deliveredSeqs);
    if (marked !== deliveredSeqs.length) {
      logger.warn({
        msg: "Google Sheets sync could not mark all rows delivered",
        tab,
        marked,
        expected: deliveredSeqs.length,
      });
    }
  } catch (err) {
    logger.warn({ msg: "Google Sheets mark-delivered failed; cursor still advances", tab, error: err });
  }

  // Advance past the rows we actually sent, using the ledger seq of the last
  // queued entry we included. Ties cannot happen (seq is monotonic), so this
  // cannot skip a row.
  const lastSeq = batch[batch.length - 1]?.seq ?? cursor;
  setTabMark(tab, String(lastSeq));

  // `remaining` is the UNDELIVERED count, not the retention total. It is a
  // superset of the rows still owed an append: it also counts marker-write
  // residue (append landed, `delivered` flag write failed) which is deliberately
  // never replayed, and which ages out with the retention window. So `remaining`
  // not reaching 0 is not by itself a stuck drain.
  const remaining = queued();
  sqlite.pruneGoogleSheetsLedger(lastSeq, LEDGER_KEEP);

  if (unreadableSeqs.length > 0) {
    logger.warn({
      msg: "Google Sheets sync parked unreadable ledger rows",
      tab,
      unreadable: unreadableSeqs.length,
    });
  }
  logger.info({ msg: "Google Sheets tab drained", tab, rows: batch.length, cursor: lastSeq });
  // Rows held back behind the corrupt row are NOT lost — `remaining` counts them
  // and the next drain (after removal) appends them in order. Say so explicitly,
  // so a partial drain never reads as "finished".
  const held = usable.length - batch.length;
  const detail =
    unreadableSeqs.length > 0
      ? `${unreadableDetail}. Paused at the first unreadable row` +
        (held > 0 ? ` — ${held} later row(s) held back in order` : "")
      : undefined;
  return {
    tab,
    status: "drained",
    rows: batch.length,
    remaining,
    cursor: String(lastSeq),
    unreadableSeqs: unreadableSeqs.length > 0 ? unreadableSeqs : undefined,
    detail,
  };
}

/**
 * Drains the requested tabs SEQUENTIALLY. Parallel drains would interleave
 * appends into different tabs of the same spreadsheet and race on the singleton
 * config row when each advances its own mark.
 */
export async function syncTabs(
  tabs: readonly TrackerTab[],
  confirmed = false,
): Promise<SyncRunResult> {
  const startedAt = new Date().toISOString();

  if (!isTrackingActive()) {
    return {
      status: "failed",
      tabs: tabs.map((tab) => ({
        tab,
        status: "skipped" as const,
        rows: 0,
        remaining: getBacklogCounts()[tab]?.queued ?? 0,
        cursor: null,
        detail: "tracking is disabled (env master off, or the console switch is off)",
      })),
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  const results: SyncTabResult[] = [];
  for (const tab of tabs) {
    try {
      results.push(await syncTab(tab, confirmed));
    } catch (err) {
      // One tab must not abort the run: a single bad tab should not strand the
      // backlogs of the others.
      logger.error({ msg: "Google Sheets sync tab threw", tab, error: err });
      results.push({
        tab,
        status: "failed",
        rows: 0,
        remaining: getBacklogCounts()[tab]?.queued ?? 0,
        cursor: null,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const anyConfirm = results.some((r) => r.status === "needs-confirmation");
  const anyFail = results.some((r) => r.status === "failed");
  const status: SyncRunResult["status"] = anyConfirm
    ? "needs-confirmation"
    : anyFail
      ? "partial"
      : "ok";

  const finishedAt = new Date().toISOString();

  // Audit is a fire-and-forget side effect; a run must never fail because of it.
  // Dynamically imported (not statically) to keep this module free of a
  // hard audit dependency, matching exporter.ts / configService.ts.
  try {
    const { createAuditLog } = await import("@/lib/audit");
    await createAuditLog({
      action: "GOOGLE_SHEETS_SYNC_RUN",
      resource: "google_sheets_tracker",
      resourceId: "sync",
      metadata: { status, tabs: results.length },
    });
  } catch (err) {
    logger.warn({ msg: "Google Sheets sync audit failed", error: err });
  }

  return { status, tabs: results, startedAt, finishedAt };
}
