/**
 * Tracker tab registry + one-time header ensure (spec 19 §4.B).
 *
 * The user's spreadsheet already carries the 5 tabs; this module owns their
 * column contracts. Writes are strictly APPEND-ONLY — this file never deletes
 * or truncates, and it never rewrites a header row the user has customised.
 *
 * Header-ensure policy (resolves the spec §4.B vs §11 tension deliberately):
 *   - tab empty            → write the header row (spec §10.9)
 *   - first row matches    → no-op
 *   - first row differs    → DO NOT touch it; log `warn` and let the append
 *                            proceed by column position (spec §11 — rewriting
 *                            would shift columns under data the user owns)
 */
import logger from "@/lib/logger";
import { getSheetsClient, trackerSheetId } from "./auth";

/** The 5 tabs of the TradeNext Tracker spreadsheet. */
export type TrackerTab = "swing" | "daily-rec" | "screener" | "custom" | "decisions";

/**
 * Column contract per tab. The ORDER is the contract — encoders in `rows.ts`
 * emit positionally, and appended rows are never re-ordered.
 */
export const TRACKER_TABS: Record<TrackerTab, readonly string[]> = {
  swing: [
    "postedAt", "symbol", "name", "price", "change", "changePercent",
    "volume", "marketCap", "screenerCount", "screenerNames", "families",
    "templateIds", "source", "momentumScore", "indicators", "action",
    "confidence", "entryPrice", "targetPrice", "stopLoss", "timeHorizon",
    "logic", "riskFactors", "analysisError",
  ],
  "daily-rec": [
    "runDate", "runId", "symbol", "price", "change", "changePercent",
    "volume", "screenerAttribution", "screenerCount", "aiRecommendation",
    "confidence", "targetPrice", "stopLoss", "timeHorizon", "status",
    "reasoning",
  ],
  screener: [
    "capturedAt", "runId", "symbol", "name", "close", "changePercent",
    "volume", "screenerNames", "category", "source", "decisionScore",
    "decisionGate",
  ],
  custom: [
    "runAt", "configId", "configName", "userId", "filters", "matchCount",
    "symbol", "name", "price", "change", "pChange", "volume", "data",
  ],
  decisions: [
    "timestamp", "kind", "mode", "provider", "status", "latencyMs",
    "attempts", "error", "questionCount", "questionTypes", "gate", "reason",
    "scoredCount", "gateDistribution", "noulAmount", "allowed",
  ],
} as const;

declare global {
  /** Tabs whose header has been ensured in THIS process (one `values.get` per tab). */
  var _googleSheetsEnsuredTabs: Set<string> | undefined;
}

function ensuredTabs(): Set<string> {
  if (!global._googleSheetsEnsuredTabs) {
    global._googleSheetsEnsuredTabs = new Set<string>();
  }
  return global._googleSheetsEnsuredTabs;
}

/** Test seam — forget which tabs have been header-ensured. */
export function _resetHeaderGuard(): void {
  global._googleSheetsEnsuredTabs = undefined;
}

/** True when `tab` is a known tab (guards against a typo reaching the API). */
export function isTrackerTab(tab: string): tab is TrackerTab {
  return Object.prototype.hasOwnProperty.call(TRACKER_TABS, tab);
}

/**
 * Ensure `tab`'s header row exists, at most once per process per tab.
 *
 * Never throws — the exporter is fire-and-forget, and a header hiccup must not
 * cost us the data rows.
 */
export async function ensureHeaders(tab: TrackerTab): Promise<boolean> {
  const done = ensuredTabs();
  if (done.has(tab)) return true;

  // Mark before the IO so a concurrent fire-and-forget call cannot double-write
  // the header. On failure we un-mark so a later export can retry.
  done.add(tab);

  try {
    const spreadsheetId = trackerSheetId();
    if (!spreadsheetId) {
      logger.error({ msg: "Google Sheets header ensure skipped — GOOGLE_SHEET_ID unset", tab });
      return false;
    }

    const expected = TRACKER_TABS[tab];
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A1`,
      majorDimension: "ROWS",
    });
    const firstRow = res.data?.values?.[0];
    // A row of blanks is an empty tab (the API omits empty cells, so a stray
    // blank row is the realistic form of "nothing here yet").
    const isBlank = !firstRow || firstRow.every((c) => String(c ?? "").trim() === "");

    if (isBlank) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tab}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [expected as string[]] },
      });
      logger.info({ msg: "Google Sheets header row written", tab, columns: expected.length });
      return true;
    }

    const actual = firstRow.map((c) => String(c ?? ""));
    if (actual.length === expected.length && actual.every((c, i) => c === expected[i])) {
      return true;
    }

    // Non-empty but different — the user owns this tab now. Append by position.
    logger.warn({
      msg: "Google Sheets header mismatch — leaving tab untouched, appending by column position",
      tab,
      expected: expected.length,
      actual: actual.length,
    });
    return true;
  } catch (err) {
    done.delete(tab); // allow a later export to retry the ensure
    logger.error({
      msg: "Google Sheets header ensure failed",
      tab,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
