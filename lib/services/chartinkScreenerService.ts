// lib/services/chartinkScreenerService.ts
// DB sync for the Chartink template screener catalog + captured tables.
//
// Data model (see prisma/schema.prisma — v3.5.5):
//   ChartinkScreener        — one row per template (JSON config id), the
//                             definition: url / categoryId / scanClause /
//                             debugClause / columnClause / backtestMaxRows /
//                             scanlinkId / backtestUrl. Kept in sync with the
//                             JSON configs (lib/services/chartink-scans/*.json).
//   ChartinkScreenerRun     — one row per full run (the "capture" or "sync"
//                             batch). Every full run CLEANS the results table
//                             and re-inserts the whole screener dataset.
//   ChartinkScreenerResult  — captured table rows (symbol, name, close,
//                             changePercent, volume, raw). Each row carries a
//                             72h TTL (expiresAt = capturedAt + ttlHours) —
//                             after it passes, the row is stale and is pruned
//                             on the next run / maintenance call.
//
// Run semantics (per product requirement):
//   - A full run deletes ALL ChartinkScreenerResult rows, then re-inserts the
//     whole captured dataset under a new run id. Old runs keep their status
//     history (audit) but their rows are gone (cascade via onDelete).
//   - TTL = 72h OR until the next full run, whichever comes first.
//   - Reads only surface fresh rows (expiresAt > now) unless
//     options.includeStale is set.

import logger from "@/lib/logger";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { staticCache } from "@/lib/cache";
import { isDbUnavailableError } from "@/lib/db-utils";
import type { ChartinkTemplate } from "@/lib/services/chartinkTemplates";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A normalised captured table row (mirrors ChartinkScanStock). */
export interface ChartinkCapturedRow {
  /** NSE symbol (upper-cased nsecode). */
  symbol: string;
  /** Company name (optional — some tables only carry codes). */
  name?: string;
  /** BSE code when Chartink provides one. */
  bsecode?: string;
  /** Latest close (₹). */
  close: number;
  /** % change vs previous close. */
  changePercent: number;
  /** Volume. */
  volume: number;
  /** Conditional-filter colour flag (1 = up, 2 = down). */
  conditionFlag?: number;
  /** Original Chartink row (all captured columns). */
  raw: Record<string, unknown>;
}

/** Descriptor exposed by the read API. */
export interface ChartinkScreenerOverview {
  id: string;
  name: string;
  url: string;
  categoryId: string;
  categoryName: string;
  /** Whether this template can be fetched (has a scan clause). */
  fetchable: boolean;
  enabled: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  resultCount: number;
  /** True when resultCount > 0 but all rows have expired their 72h TTL. */
  stale: boolean;
}

/** Options for read APIs. */
export interface ChartinkScreenerReadOptions {
  categoryId?: string;
  /** Include rows past their TTL expiry (default: only fresh rows). */
  includeStale?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default TTL for captured rows (hours) — 72h per product requirement. */
export const CHARTINK_SCREENER_TTL_HOURS = 72;

/** createMany batch size (avoid oversized inserts for wide captures). */
const INSERT_CHUNK = 250;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Bounded-concurrency batch helper (mirrors dailyRecommendationService).
 * NEVER use an interactive $transaction for large batches (5s timeout).
 */
async function runInChunks<T>(
  items: T[],
  chunkSize: number,
  fn: (chunk: T[]) => Promise<unknown[]>,
): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    await fn(chunk);
  }
}

/** Extract the NSE code from a captured row's nsecode field. */
function extractSymbol(row: Record<string, unknown>): string {
  const v = row["nsecode"] ?? row["nse_script_code"] ?? row["symbol"];
  return String(v ?? "").trim().toUpperCase();
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Normalise raw Chartink table rows into ChartinkCapturedRow[]. */
export function normalizeCapturedRows(
  rows: Array<Record<string, unknown>>,
): ChartinkCapturedRow[] {
  const out: ChartinkCapturedRow[] = [];
  for (const row of rows) {
    const symbol = extractSymbol(row);
    if (!symbol) continue; // OTC/inactive rows sometimes carry no nsecode
    out.push({
      symbol,
      name: row["name"] ? String(row["name"]).trim() : undefined,
      bsecode: row["bsecode"] ? String(row["bsecode"]) : undefined,
      close: toNumber(row["scan-column-default-close"] ?? row["close"]),
      changePercent: toNumber(
        row["scan-column-default-percent-change"] ??
          row["pChange"] ??
          row["change_percent"],
      ),
      volume: toNumber(
        row["scan-column-default-volume"] ?? row["volume"] ?? row["total_volume"],
      ),
      conditionFlag:
        toNumber(row["default-percent-change-conditional-filters-color"]) ||
        undefined,
      raw: row,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Definition sync (ChartinkScreener upserts)
// ---------------------------------------------------------------------------

/**
 * Upsert a ChartinkScreener definition row from a registry template.
 * The JSON configs (lib/services/chartink-scans/*.json) remain the source of
 * truth; this mirrors them into the DB for admin/read APIs.
 */
export async function upsertChartinkScreener(
  template: ChartinkTemplate,
  categoryName: string,
): Promise<void> {
  const data = {
    name: template.name,
    url: template.url,
    categoryId: template.categoryId,
    categoryName,
    scanClause: template.scanClause ?? null,
    debugClause: template.debugClause ?? null,
    columnClause: template.columnClause ?? null,
    backtestMaxRows: template.backtestMaxRows ?? null,
  };

  await prisma.chartinkScreener.upsert({
    where: { id: template.id },
    update: data,
    create: { id: template.id, ...data },
  });
}

/**
 * Persist a captured scanlink id (and optional backtest url) on a definition.
 * Called after a capture so "Copy" links survive restarts.
 */
export async function updateChartinkScreenerLink(
  templateId: string,
  link: { scanlinkId?: string; backtestUrl?: string },
): Promise<void> {
  const data: { scanlinkId?: string; backtestUrl?: string } = {};
  if (link.scanlinkId) data.scanlinkId = link.scanlinkId;
  if (link.backtestUrl) data.backtestUrl = link.backtestUrl;
  if (Object.keys(data).length === 0) return;

  await prisma.chartinkScreener.update({
    where: { id: templateId },
    data,
  });
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

/** Open a new full run. Returns the run id. */
export async function startChartinkRun(ttlHours = CHARTINK_SCREENER_TTL_HOURS): Promise<string> {
  const run = await prisma.chartinkScreenerRun.create({
    data: { status: "running", ttlHours },
  });
  logger.info({ msg: "Chartink run started", runId: run.id, ttlHours });
  return run.id;
}

/**
 * Insert captured rows for ONE template under a given run.
 * Rows get expiresAt = capturedAt + run.ttlHours (72h default).
 */
export async function insertChartinkRunResults(
  runId: string,
  screenerId: string,
  rows: ChartinkCapturedRow[],
  ttlHours = CHARTINK_SCREENER_TTL_HOURS,
): Promise<void> {
  if (rows.length === 0) return;

  const capturedAt = new Date();
  const expiresAt = new Date(capturedAt.getTime() + ttlHours * 60 * 60 * 1000);

  await runInChunks(rows, INSERT_CHUNK, async (chunk) => {
    await prisma.chartinkScreenerResult.createMany({
      data: chunk.map((row) => ({
        runId,
        screenerId,
        symbol: row.symbol,
        name: row.name ?? null,
        bsecode: row.bsecode ?? null,
        close: row.close || null,
        changePercent: row.changePercent || null,
        conditionFlag: row.conditionFlag ?? null,
        volume: row.volume || null,
        raw: row.raw as unknown as Prisma.InputJsonValue,
        capturedAt,
        expiresAt,
      })),
    });
    return [];
  });
}

/** Record per-template stats + timestamps after a successful capture. */
export async function completeChartinkTemplateRun(
  screenerId: string,
  rowCount: number,
  ttlHours = CHARTINK_SCREENER_TTL_HOURS,
  link?: { scanlinkId?: string; backtestUrl?: string },
): Promise<void> {
  const now = new Date();
  const nextRunAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

  await Promise.all([
    prisma.chartinkScreener.update({
      where: { id: screenerId },
      data: { lastRunAt: now, nextRunAt, resultCount: rowCount },
    }),
    link && Object.keys(link).length > 0
      ? updateChartinkScreenerLink(screenerId, link)
      : Promise.resolve(),
  ]);
}

/** Mark a run as failed. */
export async function failChartinkRun(runId: string, error: string): Promise<void> {
  await prisma.chartinkScreenerRun.update({
    where: { id: runId },
    data: { status: "failed", error, finishedAt: new Date() },
  });
  logger.error({ msg: "Chartink run failed", runId, error });
}

/** Mark a run as completed. */
export async function completeChartinkRun(
  runId: string,
  screenersRun: number,
  rowsInserted: number,
): Promise<void> {
  await prisma.chartinkScreenerRun.update({
    where: { id: runId },
    data: { status: "completed", finishedAt: new Date(), screenersRun, rowsInserted },
  });
  logger.info({
    msg: "Chartink run completed",
    runId,
    screenersRun,
    rowsInserted,
  });
}

// ---------------------------------------------------------------------------
// Full run (clean + re-insert) + TTL maintenance
// ---------------------------------------------------------------------------

/**
 * Delete ALL captured result rows — the "clean table" step of a full run.
 * Defs (ChartinkScreener) and run history are kept.
 */
export async function clearChartinkResults(): Promise<number> {
  const { count } = await prisma.chartinkScreenerResult.deleteMany({});
  logger.info({ msg: "Chartink results cleared (full run)", count });
  return count;
}

/**
 * Prune rows whose 72h TTL has passed. Safe to call any time — also runs
 * implicitly as part of a full sync (clean table supersedes it).
 */
export async function pruneExpiredChartinkResults(
  now = new Date(),
): Promise<number> {
  const { count } = await prisma.chartinkScreenerResult.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  if (count > 0) logger.info({ msg: "Chartink expired rows pruned", count });
  return count;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Return screener definitions with run metadata (counts + staleness).
 * Used by admin/UI listings and the capture tool's dry-run report.
 *
 * Cached in memory for 5 minutes — template definitions rarely change and
 * every page load hits this. Saves 1 DB op per request under normal load,
 * and prevents 500 cascades when DB is unavailable.
 */
const CHARTINK_SCREENERS_CACHE_KEY = "chartink:screeners:overview";
const CHARTINK_SCREENERS_CACHE_TTL = 15 * 60; // 15 minutes (was 5m) — DB read gate

export async function getChartinkScreeners(
  options: ChartinkScreenerReadOptions = {},
): Promise<ChartinkScreenerOverview[]> {
  const { categoryId } = options;

  // Cache-only for unfiltered listing (most common path — admin + TemplatesPanel).
  // Category-filtered queries skip cache (rare, small result set).
  if (!categoryId) {
    const cached = staticCache.get<ChartinkScreenerOverview[]>(CHARTINK_SCREENERS_CACHE_KEY);
    if (cached) return cached;
  }

  try {
    const defs = await prisma.chartinkScreener.findMany({
      where: categoryId ? { categoryId } : undefined,
      orderBy: [{ categoryId: "asc" }, { name: "asc" }],
    });

    // A screener is "stale" when its rows' TTL has passed (or was never run).
    // nextRunAt = lastRunAt + TTL, so nextRunAt <= now ⇒ all rows expired.
    const nowMs = Date.now();
    const result = defs.map((d) => {
      const stale = d.lastRunAt === null || d.nextRunAt === null || d.nextRunAt.getTime() <= nowMs;
      return {
        id: d.id,
        name: d.name,
        url: d.url,
        categoryId: d.categoryId,
        categoryName: d.categoryName,
        fetchable: !!d.scanClause,
        enabled: d.enabled,
        lastRunAt: d.lastRunAt,
        nextRunAt: d.nextRunAt,
        resultCount: d.resultCount,
        stale,
      };
    });

  // Cache the unfiltered listing (common path). DB-unavailable callers
  // get stale data instead of 500.
  if (!categoryId) {
    staticCache.set(CHARTINK_SCREENERS_CACHE_KEY, result, CHARTINK_SCREENERS_CACHE_TTL);
  }

  return result;
  } catch (err) {
    // DB unavailable — return stale cache or empty array.
    if (!categoryId) {
      const staleCache = staticCache.get<ChartinkScreenerOverview[]>(CHARTINK_SCREENERS_CACHE_KEY);
      if (staleCache) {
        logger.warn({ msg: "Chartink screeners: DB unavailable — serving stale cache" });
        return staleCache;
      }
    }
    if (isDbUnavailableError(err)) {
      logger.warn({
        msg: "Chartink screeners: DB unavailable — returning empty",
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
    throw err;
  }
}

/**
 * Return the fresh captured rows for ONE screener.
 * When includeStale is false, expired rows are filtered out and the caller
 * sees an empty array once the 72h TTL passes (they're pruned on next run).
 */
export async function getChartinkScreenerResults(
  screenerId: string,
  options: ChartinkScreenerReadOptions = {},
): Promise<ChartinkCapturedRow[]> {
  const { includeStale = false } = options;

  const runs = await prisma.chartinkScreenerRun.findMany({
    where: { results: { some: { screenerId } } },
    orderBy: { startedAt: "desc" },
    take: 1,
    select: { id: true, ttlHours: true, startedAt: true },
  });

  if (runs.length === 0) return [];

  // Fresh = capturedAt + ttlHours > now. The run's max TTL bounds freshness;
  // per-row expiresAt is authoritative, so filter on it directly.
  const where: Record<string, unknown> = {
    runId: runs[0].id,
    screenerId,
  };
  if (!includeStale) where["expiresAt"] = { gt: new Date() };

  const rows = await prisma.chartinkScreenerResult.findMany({
    where,
    orderBy: { symbol: "asc" },
  });

  return rows.map((r) => ({
    symbol: r.symbol,
    name: r.name ?? undefined,
    bsecode: r.bsecode ?? undefined,
    close: r.close ? Number(r.close) : 0,
    changePercent: r.changePercent ? Number(r.changePercent) : 0,
    volume: r.volume ? Number(r.volume) : 0,
    conditionFlag: r.conditionFlag ?? undefined,
    raw: (r.raw ?? {}) as Record<string, unknown>,
  }));
}

// ---------------------------------------------------------------------------
// Orchestration: full run
// ---------------------------------------------------------------------------

/**
 * Full run: clean results table, then capture/insert every provided
 * (templateId -> rows) pair under ONE new run id, marking lifecycle state.
 *
 * This is the "next full run cleans the table + re-inserts the whole
 * screener data" requirement. Callers pass captured rows (from the Playwright
 * capture tool) or API-fetched results (via fetchChartinkScan).
 */
export async function runFullChartinkSync(
  captures: Array<{
    templateId: string;
    rows: ChartinkCapturedRow[];
    link?: { scanlinkId?: string; backtestUrl?: string };
  }>,
  ttlHours = CHARTINK_SCREENER_TTL_HOURS,
): Promise<{ runId: string; screenersRun: number; rowsInserted: number }> {
  const runId = await startChartinkRun(ttlHours);
  let screenersRun = 0;
  let rowsInserted = 0;

  try {
    // Step 1: clean the ENTIRE result table (full-run semantics).
    await clearChartinkResults();

    // Step 2: insert each template's whole capture under the new run.
    await runInChunks(captures, 1, async ([capture]) => {
      const { templateId, rows, link } = capture;
      await insertChartinkRunResults(runId, templateId, rows, ttlHours);
      await completeChartinkTemplateRun(templateId, rows.length, ttlHours, link);
      screenersRun += 1;
      rowsInserted += rows.length;
      return [];
    });

    await completeChartinkRun(runId, screenersRun, rowsInserted);
    // Invalidate screeners listing cache so next read picks up fresh data.
    staticCache.del(CHARTINK_SCREENERS_CACHE_KEY);
    return { runId, screenersRun, rowsInserted };
  } catch (error) {
    await failChartinkRun(
      runId,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}