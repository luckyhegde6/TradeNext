// lib/services/chartinkScanService.ts
// Fetch screener results from Chartink's /screener/process endpoint using a
// template's native scan_clause DSL. Unlike chartinkService (which sends
// `{template: "tpl_x"}` or `{query}` bodies), this hits the same endpoint the
// Chartink web UI uses, so results match the site exactly.
//
// Response shape (DataTables-style, captured from the live site):
//   { draw, recordsTotal, recordsFiltered, data: [...rows...], link }
// where each row is keyed by the aliases in the template's column_clause,
// e.g. scan-column-default-close, scan-column-default-percent-change.

import logger from "@/lib/logger";
import { staticCache } from "@/lib/cache";
import {
  getChartinkTemplate,
  type ChartinkTemplate,
} from "@/lib/services/chartinkTemplates";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A normalised stock row from a Chartink scan (keyed by column aliases). */
export interface ChartinkScanStock {
  /** NSE symbol (upper-cased nsecode). */
  symbol: string;
  /** Company name. */
  name: string;
  /** BSE code when Chartink provides one. */
  bsecode?: string;
  /** Latest close (₹) — scan-column-default-close. */
  close: number;
  /** % change vs previous close — scan-column-default-percent-change. */
  changePercent: number;
  /** Volume — scan-column-default-volume (numeric). */
  volume: number;
  /** Conditional-filter colour flag (1 = up, 2 = down) when requested. */
  conditionFlag?: number;
  /** Raw Chartink row for downstream consumers that need the original shape. */
  raw: Record<string, unknown>;
}

/** The DataTables-style payload returned by /screener/process. */
export interface ChartinkScanResponse {
  draw: number;
  recordsTotal: number;
  recordsFiltered: number;
  data: Array<Record<string, unknown>>;
  /** e.g. "scanlink:2b8d4c5b0b06fa288b9bf08a3487f52b" */
  link?: string;
}

/** Result of a template scan run. */
export interface ChartinkScanResult {
  templateId: string;
  templateName: string;
  /** De-duplicated, normalised stocks. */
  stocks: ChartinkScanStock[];
  /** Source link from Chartink (scanlink id). */
  link?: string;
  /** recordsTotal from the response. */
  recordsTotal: number;
  /** Epoch ms when the scan was fetched. */
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHARTINK_SCAN_URL = "https://chartink.com/screener/process";

/** Browser-like headers; Chartink rejects plain curl/undici defaults. */
const CHARTINK_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Referer: "https://chartink.com/screener",
  Accept: "application/json, text/plain, */*",
};

/** Cache prefix for template scan results. */
const CACHE_PREFIX = "chartink-scan";
/** Cache TTL: 5 minutes (matches chartinkService). */
const CACHE_TTL = 300;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Extract NSE code from a row's nsecode field (may be null/undefined). */
function extractSymbol(row: Record<string, unknown>): string {
  const v = row["nsecode"] ?? row["nse_script_code"] ?? row["symbol"];
  return String(v ?? "").trim().toUpperCase();
}

// ---------------------------------------------------------------------------
// Core fetch + parse
// ---------------------------------------------------------------------------

/**
 * Fetch a template's scan results directly from Chartink.
 * Returns an empty list + recordsTotal 0 when the response has no data.
 */
export async function fetchChartinkScan(
  template: ChartinkTemplate,
  options: { forceRefresh?: boolean } = {},
): Promise<ChartinkScanResult> {
  const { forceRefresh = false } = options;
  const cacheKey = `${CACHE_PREFIX}:${template.id}`;

  if (!forceRefresh) {
    const cached = staticCache.get(cacheKey);
    if (cached) {
      logger.debug({ msg: "Chartink scan cache hit", templateId: template.id });
      return cached as ChartinkScanResult;
    }
  }

  // Catalog-only templates (clause not yet provided) can't be scanned yet.
  if (!template.scanClause) {
    throw new Error(
      `Chartink template has no scan_clause yet (catalog-only): ${template.id}`,
    );
  }

  const body: Record<string, unknown> = { scan_clause: template.scanClause };
  if (template.debugClause) body["debug_clause"] = template.debugClause;
  if (template.columnClause) body["column_clause"] = template.columnClause;

  logger.info({
    msg: "Fetching Chartink scan",
    templateId: template.id,
    templateName: template.name,
  });

  const start = Date.now();
  const response = await fetch(CHARTINK_SCAN_URL, {
    method: "POST",
    headers: CHARTINK_HEADERS,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Chartink scan HTTP ${response.status}`);
  }

  const json = (await response.json()) as Partial<ChartinkScanResponse>;
  const rows = Array.isArray(json.data) ? json.data : [];

  // Normalise each row into a ChartinkScanStock. NSE codes without a value
  // are skipped. OTC/inactive rows sometimes carry no nsecode.
  const stocks: ChartinkScanStock[] = [];
  for (const row of rows) {
    const symbol = extractSymbol(row);
    if (!symbol) continue;

    stocks.push({
      symbol,
      name: String(
        row["name"] ?? row["company_name"] ?? symbol,
      ).trim(),
      bsecode: row["bsecode"] ? String(row["bsecode"]) : undefined,
      close: toNumber(row["scan-column-default-close"] ?? row["close"]),
      changePercent: toNumber(
        row["scan-column-default-percent-change"] ??
          row["pChange"] ??
          row["change_percent"],
      ),
      volume: toNumber(
        row["scan-column-default-volume"] ??
          row["volume"] ??
          row["total_volume"],
      ),
      conditionFlag: toNumber(
        row["default-percent-change-conditional-filters-color"],
      ) || undefined,
      raw: row,
    });
  }

  const result: ChartinkScanResult = {
    templateId: template.id,
    templateName: template.name,
    stocks,
    link: json.link,
    recordsTotal: json.recordsTotal ?? stocks.length,
    fetchedAt: Date.now(),
  };

  logger.info({
    msg: "Chartink scan fetched",
    templateId: template.id,
    stocks: stocks.length,
    elapsed: Date.now() - start,
  });

  staticCache.set(cacheKey, result, CACHE_TTL);
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a template scan by id.  Convenience wrapper around
 * {@link fetchChartinkScan} for callers that only have an id.
 *
 * @throws When the template id is unknown.
 */
export async function runChartinkScanById(
  templateId: string,
  options: { forceRefresh?: boolean } = {},
): Promise<ChartinkScanResult> {
  const template = getChartinkTemplate(templateId);
  if (!template) {
    throw new Error(`Unknown Chartink template: ${templateId}`);
  }
  return fetchChartinkScan(template, options);
}

/**
 * Return all registered Chartink templates (re-export for callers that need
 * the registry alongside the scan service).
 */
export { getChartinkTemplates, getChartinkTemplate } from "@/lib/services/chartinkTemplates";