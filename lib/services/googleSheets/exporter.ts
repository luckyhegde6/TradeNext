/**
 * Fire-and-forget exporter for the Tracker spreadsheet (spec 19 §4.D).
 *
 * Contract with the producers — NONE of them may await or be affected by an
 * export:
 *   1. `GOOGLE_SHEETS_TRACKING_ENABLED !== "true"` → return `"disabled"`,
 *      zero network calls, byte-identical current behaviour.
 *   2. Enabled → ensure headers once per process, then ONE batched
 *      `values.append` per producer-run (hundreds of rows, one request).
 *   3. Transient failure (401/429/5xx) → one retry after ~1s, then give up.
 *   4. Nothing in this file ever throws into business logic. Every failure is
 *      logged, audited (best-effort), and reported as `"failed"`.
 *
 * On the audit asymmetry: `GOOGLE_SHEETS_APPEND_SUCCESS` is emitted for the
 * four low-frequency run-level tabs but NOT for `decisions`, which fires once
 * per engine evaluation — auditing that would be one Prisma write per trace and
 * would blow the plan-limit write budget that the rest of the repo works hard to
 * protect (v3.19+ write-behind discipline). Success is still logged via pino.
 *
 * Ledger capture (spec 20 §5.B) is NOT subject to that asymmetry in the same way,
 * because the SQLite ledger is the write-behind mirror, not Prisma: one local
 * insert per export attempt, no Prisma op. `decisions` is still excluded because
 * the spec excludes it from syncing and its ring buffer is already bounded.
 */
import logger from "@/lib/logger";
import { getSqliteFallback } from "@/lib/sqlite";
import { getSheetsClient } from "./auth";
import { isTrackingActive, resolveSheetId } from "./configService";
import { ensureHeaders, isTrackerTab, type TrackerTab } from "./tabs";
import {
  cell,
  customScanRow,
  dailyRecRow,
  decisionRow,
  metricsRow,
  screenerRow,
  swingRow,
  type CustomScanRowContext,
  type DailyRecRunContext,
  type DailyRecStockInput,
  type MetricsRowInput,
  type ScreenerRowContext,
  type ScreenerRowInput,
} from "./rows";
import { registerDecisionTraceSink } from "@/lib/services/decision/monitoring";
import type { DecisionTraceEntry } from "@/lib/services/decision/monitoring";
import type { SwingStock } from "@/lib/services/swing-types";

/** Outcome of an export. Never an exception — producers only ever see this. */
export type ExportResult = "enabled" | "disabled" | "failed";

/** Backoff before the single retry (spec §4.D: "~1s"). */
const RETRY_BACKOFF_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** HTTP status carried by a Gaxios/API error, or null when there isn't one. */
function httpStatus(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: unknown; response?: { status?: unknown } };
  if (typeof e.response?.status === "number") return e.response.status;
  if (typeof e.code === "number") return e.code;
  return null;
}

/**
 * Transient = worth one more try. 401 is included because a failed access-token
 * refresh (e.g. an expired test-mode refresh token) can clear on the next
 * attempt, and one 1s retry is cheap insurance.
 */
function isTransient(err: unknown): boolean {
  const status = httpStatus(err);
  if (status === null) return false;
  return status === 401 || status === 408 || status === 429 || (status >= 500 && status <= 599);
}

/** Best-effort audit — never allowed to affect the export or the producer. */
async function audit(
  action: "GOOGLE_SHEETS_APPEND_SUCCESS" | "GOOGLE_SHEETS_APPEND_FAILED",
  tab: string,
  rows: number,
  errorMessage?: string
): Promise<void> {
  try {
    const { createAuditLog } = await import("@/lib/audit");
    await createAuditLog({
      action,
      resource: "google_sheets_tracker",
      resourceId: tab,
      metadata: { tab, rows },
      errorMessage,
    });
  } catch {
    // Audit is observability, not correctness — a failure here is not ours to fix.
  }
}

/**
 * Append `rows` to `tab`, header-ensuring first. One batched request, one
 * retry on a transient error. Never throws.
 */
/**
 * Records the encoded rows in the SQLite ledger (spec 20 §5.B) — on EVERY export
 * outcome, not just failures.
 *
 * The `delivered` flag is the whole point: a successful append is recorded with
 * `delivered: true` (a durable audit row that the drain can never replay), while
 * `disabled` / `no-spreadsheet` / `failed` are recorded with `delivered: false`
 * so "Sync now" drains them later. `exportRowsInternal` is the single writer, so
 * a row can never be recorded twice for one attempt.
 *
 * `fromSync` rows are NOT recorded: the drain owns the existing ledger rows and
 * marks them delivered itself. Re-recording on a drain failure would grow the
 * backlog without bound on every retry of a permanently-broken sheet.
 *
 * Best-effort and NEVER throws: a failure to write the ledger must not turn a
 * non-fatal export into a producer-visible error. Deliberately silent on the
 * `decisions` tab, which the spec excludes from syncing and which is already a
 * bounded in-memory ring buffer.
 */
function recordLedger(
  tab: TrackerTab,
  rows: string[][],
  reason: string,
  delivered: boolean,
  runId: string | null,
  fromSync: boolean,
): void {
  if (fromSync || tab === "decisions" || !rows.length) return;
  try {
    const sqlite = getSqliteFallback();
    if (!sqlite) return; // mirror not ready — nothing to do, and no throw
    sqlite.insertGoogleSheetsLedgerRows(
      rows.map((r) => ({ tab, rowJson: JSON.stringify(r), runId, reason, delivered })),
    );
  } catch (err) {
    logger.debug({ msg: "Google Sheets ledger record failed (non-fatal)", tab, reason, error: err });
  }
}

/** Spec 20 sync drain entry point. Identical append semantics, but the drain
 *  owns retry accounting and the delivered-marking, so nothing is re-recorded. */
export async function exportRowsFromSync(
  tab: TrackerTab,
  rows: string[][],
): Promise<ExportResult> {
  return exportRowsInternal(tab, rows, true, null);
}

export async function exportRows(
  tab: TrackerTab,
  rows: string[][],
  runId: string | null = null,
): Promise<ExportResult> {
  return exportRowsInternal(tab, rows, false, runId);
}

async function exportRowsInternal(
  tab: TrackerTab,
  rows: string[][],
  fromSync: boolean,
  runId: string | null,
): Promise<ExportResult> {
  if (!isTrackingActive()) {
    logger.debug({ msg: "Google Sheets export skipped (disabled)", tab, rows: rows.length });
    // The gate is off, so the whole feature is off: the drain is gated by the
    // same flag and would refuse to run, so queueing would only accumulate rows
    // nobody can ever drain. Correctly dropped instead of recorded.
    return "disabled";
  }
  if (rows.length === 0) {
    logger.debug({ msg: "Google Sheets export skipped (no rows)", tab });
    return "enabled";
  }
  if (!isTrackerTab(tab)) {
    logger.error({ msg: "Google Sheets export skipped (unknown tab)", tab });
    return "failed";
  }

  try {
    // DB-first with env fallback (Spec 20) so the admin console can relink the
    // sheet without a redeploy; env-only deployments resolve exactly as before.
    const spreadsheetId = resolveSheetId();
    if (!spreadsheetId) {
      logger.error({ msg: "Google Sheets export failed - GOOGLE_SHEET_ID unset", tab });
      await audit("GOOGLE_SHEETS_APPEND_FAILED", tab, rows.length, "spreadsheet id unset");
      recordLedger(tab, rows, "no-spreadsheet", false, runId, fromSync);
      return "failed";
    }

    await ensureHeaders(tab);

    const sheets = await getSheetsClient();
    const attempt = async (): Promise<void> => {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${tab}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: rows },
      });
    };

    try {
      await attempt();
    } catch (err) {
      if (!isTransient(err)) throw err;
      logger.warn({
        msg: "Google Sheets append transient failure — retrying once",
        tab,
        status: httpStatus(err),
      });
      await sleep(RETRY_BACKOFF_MS);
      await attempt();
    }

    logger.info({ msg: "Google Sheets rows appended", tab, rows: rows.length });
    // See header note: skip the success audit for the high-frequency `decisions` tab.
    if (tab !== "decisions") {
      await audit("GOOGLE_SHEETS_APPEND_SUCCESS", tab, rows.length);
    }
    // Recorded as DELIVERED: the rows are on the sheet, so this is an audit row
    // only. The drain's `delivered = 0` filter can never replay it.
    recordLedger(tab, rows, "appended", true, runId, fromSync);
    return "enabled";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ msg: "Google Sheets append failed (non-fatal)", tab, error: message });
    await audit("GOOGLE_SHEETS_APPEND_FAILED", tab, rows.length, message);
    // A transient-but-exhausted append stays undelivered so the next "Sync now"
    // re-appends the identical row.
    recordLedger(tab, rows, "failed", false, runId, fromSync);
    return "failed";
  }
}

// ─── Producer wrappers ───────────────────────────────────────────────────

/** Swing picks (with AI analysis) → `swing`. */
export async function exportSwing(
  stocks: SwingStock[],
  runId: string | null = null,
): Promise<ExportResult> {
  if (!isTrackingActive() || stocks.length === 0) {
    return isTrackingActive() ? "enabled" : "disabled";
  }
  try {
    const postedAt = new Date().toISOString();
    return await exportRows(
      "swing",
      stocks.map((s) => swingRow(s, postedAt)),
      runId,
    );
  } catch (err) {
    logger.error({
      msg: "Google Sheets swing export failed (non-fatal)",
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}

/** Daily recommendation stocks → `daily-rec`. */
export async function exportDailyRecs(
  run: DailyRecRunContext,
  stocks: DailyRecStockInput[]
): Promise<ExportResult> {
  if (!isTrackingActive() || stocks.length === 0) {
    return isTrackingActive() ? "enabled" : "disabled";
  }
  try {
    return await exportRows(
      "daily-rec",
      stocks.map((s) => dailyRecRow(s, run)),
      run.runId,
    );
  } catch (err) {
    logger.error({
      msg: "Google Sheets daily-recs export failed (non-fatal)",
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}

/** Unified screener hits (post-POC-A) → `screener`. */
export async function exportScreeners(
  results: ScreenerRowInput[],
  ctx: ScreenerRowContext = {}
): Promise<ExportResult> {
  if (!isTrackingActive() || results.length === 0) {
    return isTrackingActive() ? "enabled" : "disabled";
  }
  try {
    const capturedAt = ctx.capturedAt ?? new Date().toISOString();
    return await exportRows(
      "screener",
      results.map((r) => screenerRow(r, { ...ctx, capturedAt })),
      ctx.runId ?? null,
    );
  } catch (err) {
    logger.error({
      msg: "Google Sheets screener export failed (non-fatal)",
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}

/**
 * Saved-config scan hits → `custom`.
 *
 * `runId` is passed separately (not via `CustomScanRowContext`) because the
 * context is the ROW contract, whose 13 columns are positional and must not
 * grow; the run id is ledger provenance only.
 */
export async function exportCustomScan(
  ctx: CustomScanRowContext,
  items: Record<string, unknown>[],
  runId: string | null = null,
): Promise<ExportResult> {
  if (!isTrackingActive() || items.length === 0) {
    return isTrackingActive() ? "enabled" : "disabled";
  }
  try {
    return await exportRows(
      "custom",
      items.map((i) => customScanRow(i, ctx)),
      runId,
    );
  } catch (err) {
    logger.error({
      msg: "Google Sheets custom scan export failed (non-fatal)",
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}

/**
 * One decision-engine trace → `decisions`.
 *
 * Registered as the decision trace sink (see `registerDecisionSheetSink`), so
 * all four trace kinds (evaluate / ping / poc-a-screener /
 * poc-b-autoseed-gate) export from this single function.
 */
export async function exportDecision(entry: DecisionTraceEntry): Promise<ExportResult> {
  if (!isTrackingActive()) return "disabled";
  try {
    return await exportRows("decisions", [[...decisionRow(entry)]]);
  } catch (err) {
    logger.error({
      msg: "Google Sheets decision export failed (non-fatal)",
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}

/**
 * One KPI snapshot → `metrics`.
 *
 * Unlike the other wrappers this is NOT producer-driven: no background job
 * appends a snapshot, because "how should the win rate be measured" is a
 * judgement the user owns, and a silently scheduled snapshot would bake one
 * answer into their sheet forever. It is called only from the admin console's
 * explicit "Append KPI snapshot" action.
 *
 * `runId` is null by design — a snapshot is not part of a scan run, and faking
 * provenance would corrupt the run-filtered ledger view.
 */
export async function exportMetricsSnapshot(snapshot: MetricsRowInput): Promise<ExportResult> {
  if (!isTrackingActive()) return "disabled";
  try {
    return await exportRows("metrics", [[...metricsRow(snapshot)]]);
  } catch (err) {
    logger.error({
      msg: "Google Sheets metrics export failed (non-fatal)",
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}

// ─── Decision trace sink wiring ──────────────────────────────────────────

/**
 * Register {@link exportDecision} as the decision-engine trace sink.
 *
 * Called lazily from `decision/monitoring.ts` on the first recorded trace (and
 * only when tracking is armed), so a process that serves ONLY
 * `/api/decision/evaluate` still exports, and a process with tracking off never
 * loads this module at all.
 */
export function registerDecisionSheetSink(): void {
  registerDecisionTraceSink((entry) => {
    // `exportDecision` never rejects (it swallows and audits), so a bare
    // `void` sink is safe and keeps the sink contract promise-free.
    void exportDecision(entry);
  });
}

// Re-exported so callers can build a one-cell row without importing rows.ts.
export { cell };
