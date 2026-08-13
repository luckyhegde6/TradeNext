/**
 * scripts/chartink-capture/capture-core.ts
 *
 * Pure, dependency-free helpers for the Chartink capture tool. Kept separate
 * from the Playwright runner so the parsing/merging logic is unit-testable.
 *
 * Two capture paths produce the same `CapturedTemplate` shape:
 *   1. NETWORK INTERCEPTION (primary, preferred): Chartink's page fires a
 *      POST /screener/process on load carrying the EXACT scan_clause /
 *      debug_clause / column_clause in the request body and the full table +
 *      scanlink in the response. We capture request bodies (clauses) and
 *      response data (rows) without any browser clicks.
 *   2. CLIPBOARD (fallback): "Copy group to clipboard" copies the clause/
 *      logic; "Copy" → "Copy table" copies the result table as TSV.
 */

import type { ChartinkTemplate } from "@/lib/services/chartinkScansTypes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Everything captured for one Chartink template page. */
export interface CapturedTemplate {
  template: ChartinkTemplate;
  /** Exact DSL sent by the Chartink UI to /screener/process. */
  scanClause?: string;
  debugClause?: string;
  columnClause?: string;
  /** max_rows observed on /backtest/process (string in the wire body). */
  backtestMaxRows?: number;
  /** Raw table rows from the /screener/process response (wire aliases). */
  rows: Array<Record<string, unknown>>;
  /** Response `link` (scanlink:<id>) when captured. */
  scanlinkId?: string;
  /** Backtest page URL when the Backtest button was followed. */
  backtestUrl?: string;
}

// ---------------------------------------------------------------------------
// Clipboard TSV parsing ("Copy table")
// ---------------------------------------------------------------------------

/**
 * Parse the TSV the "Copy table" button puts on the clipboard into raw row
 * objects keyed with the aliases chartink services expect where possible:
 *   - nsecode / name / bsecode stay as-is
 *   - close  ← "Daily Close" | "Close" | "LTP"
 *   - change ← "% change" | "Daily % change" | "Perc. change"
 *   - volume ← "Daily Volume" | "Volume"
 * Unknown columns keep their raw header (lower-case key). Tab-separated;
 * the first non-empty line is the header. Rows with no nsecode are dropped.
 */
export function parseClipboardTable(tsv: string): Array<Record<string, unknown>> {
  const lines = tsv
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split("\t").map((h) => h.trim());
  const col = (match: RegExp): number =>
    headers.findIndex((h) => match.test(h));

  const nsecodeIdx = col(/^nsecode$/i);
  if (nsecodeIdx === -1) return []; // not a screener table

  const nameIdx = col(/^(name|company)$/i);
  const bsIdx = col(/^bsecode$/i);
  const closeIdx = col(/^daily\s*close$|^close$|^ltp$/i);
  const changeIdx = col(/percent|change/i);
  const volumeIdx = col(/volume/i);
  const condIdx = col(/condition|filter.?color/i);

  const rows: Array<Record<string, unknown>> = [];
  for (const line of lines.slice(1)) {
    const cells = line.split("\t").map((c) => c.trim());
    const nsecode = cells[nsecodeIdx] ?? "";
    if (!nsecode) continue;

    const row: Record<string, unknown> = { nsecode };

    if (nameIdx >= 0) row["name"] = cells[nameIdx] ?? "";
    if (bsIdx >= 0) row["bsecode"] = cells[bsIdx] ?? "";
    if (closeIdx >= 0) row["scan-column-default-close"] = toNum(cells[closeIdx]);
    if (changeIdx >= 0) row["scan-column-default-percent-change"] = toNum(cells[changeIdx]);
    if (volumeIdx >= 0) row["scan-column-default-volume"] = toNum(cells[volumeIdx]);
    if (condIdx >= 0) row["default-percent-change-conditional-filters-color"] = toNum(cells[condIdx]);

    rows.push(row);
  }
  return rows;
}

function toNum(s: string | undefined): number {
  if (s === undefined || s === "") return 0;
  const cleaned = s.replace(/[,₹%\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Merge captured clauses back into JSON config entries
// ---------------------------------------------------------------------------

/**
 * Merge a capture into a template config entry. First value wins unless the
 * existing value is absent (JSON configs stay the source of truth; a re-run
 * never stomps a better hand-curated clause with an identical capture).
 */
export function mergeCapturedClause(
  template: ChartinkTemplate,
  captured: Pick<
    CapturedTemplate,
    "scanClause" | "debugClause" | "columnClause" | "backtestMaxRows"
  >,
): ChartinkTemplate {
  const out: ChartinkTemplate = { ...template };
  if (captured.scanClause && !out.scanClause) out.scanClause = captured.scanClause;
  if (captured.debugClause && !out.debugClause) out.debugClause = captured.debugClause;
  if (captured.columnClause && !out.columnClause) out.columnClause = captured.columnClause;
  if (captured.backtestMaxRows && !out.backtestMaxRows) {
    out.backtestMaxRows = captured.backtestMaxRows;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Small CLI arg parser (no deps)
// ---------------------------------------------------------------------------

/** Parse "--flag value" / "--flag=value" / bare "--flag" CLI args. */
export function parseArgs(
  argv: string[],
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[arg.slice(2)] = next;
        i++;
      } else {
        out[arg.slice(2)] = true;
      }
    }
  }
  return out;
}

/** Comma-separated list value helper. */
export function listValue(v: string | boolean | undefined): string[] {
  if (typeof v !== "string" || v === "") return [];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}