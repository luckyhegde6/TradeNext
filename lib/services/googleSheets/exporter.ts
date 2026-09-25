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
 */
import logger from "@/lib/logger";
import { isTrackingEnabled, trackerSheetId, getSheetsClient } from "./auth";
import { ensureHeaders, isTrackerTab, type TrackerTab } from "./tabs";
import {
  cell,
  customScanRow,
  dailyRecRow,
  decisionRow,
  screenerRow,
  swingRow,
  type CustomScanRowContext,
  type DailyRecRunContext,
  type DailyRecStockInput,
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
export async function exportRows(tab: TrackerTab, rows: string[][]): Promise<ExportResult> {
  if (!isTrackingEnabled()) {
    logger.debug({ msg: "Google Sheets export skipped (disabled)", tab, rows: rows.length });
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
    const spreadsheetId = trackerSheetId();
    if (!spreadsheetId) {
      logger.error({ msg: "Google Sheets export failed — GOOGLE_SHEET_ID unset", tab });
      await audit("GOOGLE_SHEETS_APPEND_FAILED", tab, rows.length, "GOOGLE_SHEET_ID unset");
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
    return "enabled";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ msg: "Google Sheets append failed (non-fatal)", tab, error: message });
    await audit("GOOGLE_SHEETS_APPEND_FAILED", tab, rows.length, message);
    return "failed";
  }
}

// ─── Producer wrappers ───────────────────────────────────────────────────

/** Swing picks (with AI analysis) → `swing`. */
export async function exportSwing(stocks: SwingStock[]): Promise<ExportResult> {
  if (!isTrackingEnabled() || stocks.length === 0) {
    return isTrackingEnabled() ? "enabled" : "disabled";
  }
  try {
    const postedAt = new Date().toISOString();
    return await exportRows("swing", stocks.map((s) => swingRow(s, postedAt)));
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
  if (!isTrackingEnabled() || stocks.length === 0) {
    return isTrackingEnabled() ? "enabled" : "disabled";
  }
  try {
    return await exportRows("daily-rec", stocks.map((s) => dailyRecRow(s, run)));
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
  if (!isTrackingEnabled() || results.length === 0) {
    return isTrackingEnabled() ? "enabled" : "disabled";
  }
  try {
    const capturedAt = ctx.capturedAt ?? new Date().toISOString();
    return await exportRows(
      "screener",
      results.map((r) => screenerRow(r, { ...ctx, capturedAt }))
    );
  } catch (err) {
    logger.error({
      msg: "Google Sheets screener export failed (non-fatal)",
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}

/** Saved-config scan hits → `custom`. */
export async function exportCustomScan(
  ctx: CustomScanRowContext,
  items: Record<string, unknown>[]
): Promise<ExportResult> {
  if (!isTrackingEnabled() || items.length === 0) {
    return isTrackingEnabled() ? "enabled" : "disabled";
  }
  try {
    return await exportRows("custom", items.map((i) => customScanRow(i, ctx)));
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
  if (!isTrackingEnabled()) return "disabled";
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
