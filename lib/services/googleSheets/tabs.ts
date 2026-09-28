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
import { getSheetsClient } from "./auth";
import { resolveSheetId } from "./configService";

/**
 * The TradeNext Tracker spreadsheet tabs.
 *
 * Spec 19 shipped 5 tabs (swing / daily-rec / screener / custom / decisions).
 * Spec 20 appends `metrics` as the 5th SYNCABLE tab — it sits after `decisions`
 * in the union only because the union is append-only, and `decisions` is
 * excluded from sync, so `metrics` is the 5th tab a drain can actually reach.
 *
 * The 5 spec-19 contracts are frozen at 24/16/12/13/16 columns and MUST NOT
 * change: the sheets are append-only, so a column inserted anywhere but the end
 * silently shifts every historical row under the wrong header (Lesson 141).
 */
export type TrackerTab =
  | "swing"
  | "daily-rec"
  | "screener"
  | "custom"
  | "decisions"
  | "metrics";

/** Every valid tab, for "sync all" iteration. */
export const TRACKER_TAB_KEYS = [
  "swing",
  "daily-rec",
  "screener",
  "custom",
  "decisions",
  "metrics",
] as const;

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
  // Spec 20 — 11 columns. A KPI SNAPSHOT, not a per-stock row: one row per
  // "Append KPI snapshot" click, so the sheet becomes a time series of portfolio
  // health the user can chart. Derived entirely from data TradeNext already
  // holds; it is a projection, never a new source of truth.
  metrics: [
    "snapshotAt", "totalTracked", "active", "targetAchieved", "stopLossHit",
    "expired", "winRate", "netPnlAbs", "netPnlPct", "avgReturnPct",
    "grossPnlAbs",
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

/**
 * How a tab's live header compares to its expected contract.
 *
 * `unknown` is reserved for "could not tell" (no spreadsheet configured, OAuth
 * failure, network error) — it is deliberately distinct from `absent` so the
 * admin console never shows a false "no data" for an unreadable tab.
 */
export type HeaderState = "matched" | "drifted" | "absent" | "unknown";

/**
 * Classify a fetched first row against a tab's expected header. Pure.
 *
 * A row of blanks is `absent` (the API omits empty cells, so a stray blank row
 * is the realistic form of "nothing here yet"). Any other non-matching row is
 * `drifted` — the user owns the tab, so we append by position and never rewrite.
 */
export function classifyHeader(
  firstRow: unknown[] | undefined,
  expected: readonly string[]
): HeaderState {
  if (!firstRow || firstRow.every((c) => String(c ?? "").trim() === "")) return "absent";
  const actual = firstRow.map((c) => String(c ?? ""));
  const matched =
    actual.length === expected.length && actual.every((c, i) => c === expected[i]);
  return matched ? "matched" : "drifted";
}

/**
 * READ-ONLY probe of a tab's header, for the admin console (spec 20 §5.C).
 *
 * Never throws and never writes — a status read must not be able to mutate the
 * user's sheet. Returns `unknown` rather than throwing so one unreadable tab
 * cannot break the whole status payload.
 */
export async function readHeaderState(tab: TrackerTab): Promise<HeaderState> {
  try {
    const spreadsheetId = await resolveSheetId();
    if (!spreadsheetId) return "unknown";

    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      // Full first row, not `A1`: a 1x1 probe can never match a multi-column
      // header and misreports every populated tab as "drifted" (found live).
      range: `${tab}!1:1`,
      majorDimension: "ROWS",
    });
    return classifyHeader(res.data?.values?.[0], TRACKER_TABS[tab]);
  } catch (err) {
    logger.debug({
      msg: "Google Sheets header state read failed",
      tab,
      error: err instanceof Error ? err.message : String(err),
    });
    return "unknown";
  }
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
    // DB-first, env fallback (spec 20 §5.A) — a sheet id set through the admin
    // console must be honoured here too, or the header is never written and
    // every row lands under a blank first line.
    const spreadsheetId = await resolveSheetId();
    if (!spreadsheetId) {
      logger.error({ msg: "Google Sheets header ensure skipped — spreadsheet id unset", tab });
      return false;
    }

    const expected = TRACKER_TABS[tab];
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      // Full first row, not `A1`: a 1x1 probe can never match a multi-column
      // header and would treat every populated tab as user-drifted, logging a
      // spurious warn on every sync (found live).
      range: `${tab}!1:1`,
      majorDimension: "ROWS",
    });

    const state = classifyHeader(res.data?.values?.[0], expected);

    if (state === "absent") {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tab}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [expected as string[]] },
      });
      logger.info({ msg: "Google Sheets header row written", tab, columns: expected.length });
      return true;
    }

    if (state === "matched") return true;

    // `drifted` — the user owns this tab now. Append by position.
    logger.warn({
      msg: "Google Sheets header mismatch — leaving tab untouched, appending by column position",
      tab,
      expected: expected.length,
      actual: (res.data?.values?.[0] ?? []).length,
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
