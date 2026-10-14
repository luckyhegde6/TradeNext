/**
 * Admin "re-scan" for the Tracker's `screener` and `custom` tabs (Spec 20).
 *
 * WHAT A RE-SCAN IS FOR
 * The console's Sync button drains the ledger — it moves rows that were already
 * produced into the sheet. It never produces anything. A re-scan is the
 * operator saying "go and get fresh results now", for a scan that has gone
 * stale (a screeners page whose captured data is days old, a saved config whose
 * picks have moved). It appends a NEW run's rows, exactly like the original
 * producer would have.
 *
 * WHY IT DELEGATES INSTEAD OF RE-IMPLEMENTING
 *   - `screener` — `runChartinkUnifiedScreeners` already appends to the `screener`
 *     tab on its fresh (uncached) path, with `runId` provenance and a randomUUID.
 *     Calling it with `forceRefresh: true` is therefore the whole feature; this
 *     service must NOT export as well, or every re-scan would write two runs.
 *   - `custom` — `runCustomScan` (extracted from the config-run route) returns
 *     the page; the export is the same `exportCustomScan` call the route makes,
 *     minus the `offset === 0` paging gate, because a re-scan has no pages. One
 *     explicit action is one run, so it always appends.
 *
 * THE CAP
 * `RESCAN_ROW_LIMIT` exists because a re-scan is a manual, synchronous operator
 * action and the drain that later appends these rows to the sheet is capped at
 * 200 (`SYNC_ROW_CAP`). Appending 2000 rows would be legal (the ledger is
 * unbounded) but the operator would have to click Sync ~10 times, and the common
 * case — "refresh my watchlist scan" — wants the top of the result set, not
 * every match on the exchange.
 *
 * ERRORS ARE RETURNED, NOT THROWN
 * Both callers are routes, and a route that throws produces a bare 500 with no
 * actionable text. `RescanResult` carries a discriminated reason so the console
 * can explain *why* nothing was appended — and, critically, so "the scan ran and
 * matched nothing" is visibly different from "the scan could not run".
 */
import { randomUUID } from "crypto";
import prisma from "@/lib/prisma";
import { asFilterGroup, runCustomScan } from "@/lib/screener/customScanRunner";
import { runChartinkUnifiedScreeners } from "@/lib/services/chartinkUnifiedScreenerService";
import { exportCustomScan } from "@/lib/services/googleSheets/exporter";
import { isDbUnavailableError, isPlanLimitBreakerOpen } from "@/lib/db-utils";
import type { TrackerTab } from "./tabs";
import logger from "@/lib/logger";

/** How many hits one re-scan may append. Matches the drain cap; see the note above. */
export const RESCAN_ROW_LIMIT = 200;

export type RescanResult =
  | {
      ok: true;
      tab: TrackerTab;
      /** Rows appended to the ledger for this run (0 when the scan matched nothing). */
      appended: number;
      /** Full match count for the scan, which may exceed `appended`. */
      total: number;
      executionMs: number;
      /** True when the producer appended on our behalf (the `screener` path). */
      delegatedExport: boolean;
    }
  | {
      ok: false;
      tab: TrackerTab;
      reason: "not_found" | "no_filter_group" | "db_unavailable" | "error";
      error: string;
    };

/** Re-run a Chartink/TradingView unified screener pass, bypassing the 5-min cache.
 *
 *  `forceRefresh: true` is the entire point: without it a re-scan would return
 *  the same cached rows the operator is trying to replace, and the sheet would
 *  gain a byte-identical duplicate run.
 */
export async function rescanScreener(
  options: { categoryId?: string; templateIds?: string[]; tvFallbackLimit?: number } = {},
): Promise<RescanResult> {
  const tab = "screener" as const;
  const startMs = Date.now();
  try {
    const results = await runChartinkUnifiedScreeners({
      forceRefresh: true,
      categoryId: options.categoryId,
      templateIds: options.templateIds,
      tvFallbackLimit: options.tvFallbackLimit ?? RESCAN_ROW_LIMIT,
    });
    const executionMs = Date.now() - startMs;
    // The producer appended these itself (see the header). We report the count so
    // the console can show something useful, and claim nothing about delivery:
    // that export is fire-and-forget and the ledger, not this function, is the
    // source of truth for what actually landed.
    logger.info({ msg: "Google Sheets screener re-scan complete", hits: results.length, executionMs });
    return {
      ok: true,
      tab,
      appended: results.length,
      total: results.length,
      executionMs,
      delegatedExport: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isDbUnavailableError(error)) {
      logger.warn({ msg: "Google Sheets screener re-scan: DB unavailable", message });
      return { ok: false, tab, reason: "db_unavailable", error: message };
    }
    logger.error({ msg: "Google Sheets screener re-scan failed", message });
    return { ok: false, tab, reason: "error", error: message };
  }
}

/**
 * The synchronous, scan-free half of a `custom` re-scan — everything that can be
 * decided from the database alone.
 *
 * Spec 27 split this out so the route can keep answering 404/409/503 IMMEDIATELY
 * (a typo'd config id must not be enqueued as a doomed task) while the scan moves
 * to the worker queue. `rescanCustomConfig` calls it first and REUSES the returned
 * config, so there is one read and one source of truth for the checks rather than
 * two copies that can drift apart.
 *
 * Never throws: a DB error is mapped to `db_unavailable` (plan-limit hold) or
 * `error` (anything else) so both callers get a discriminated reason instead of a
 * bare throw.
 */
export type CustomRescanPrecheck =
  | {
      ok: true;
      config: { id: string; name: string; userId: number; filters: unknown };
      filterGroup: NonNullable<ReturnType<typeof asFilterGroup>>;
    }
  | {
      ok: false;
      reason: "db_unavailable" | "not_found" | "no_filter_group" | "error";
      error: string;
    };

export async function precheckCustomRescan(configId: string): Promise<CustomRescanPrecheck> {
  if (isPlanLimitBreakerOpen()) {
    // `ScanConfig` is a Prisma-only model with no SQLite mirror, so there is no
    // fallback read: report it rather than pretending the config is missing.
    return { ok: false, reason: "db_unavailable", error: "Database unavailable" };
  }
  try {
    const config = await prisma.scanConfig.findUnique({ where: { id: configId } });
    if (!config) {
      return { ok: false, reason: "not_found", error: `Config not found: ${configId}` };
    }
    const filterGroup = asFilterGroup(config.filters);
    if (!filterGroup) {
      return {
        ok: false,
        reason: "no_filter_group",
        error: `Config ${configId} has no usable filter group`,
      };
    }
    return {
      ok: true,
      config: { id: config.id, name: config.name, userId: config.userId, filters: config.filters },
      filterGroup,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isDbUnavailableError(error)) {
      logger.warn({ msg: "Google Sheets custom re-scan precheck: DB unavailable", message });
      return { ok: false, reason: "db_unavailable", error: message };
    }
    logger.error({ msg: "Google Sheets custom re-scan precheck failed", configId, message });
    return { ok: false, reason: "error", error: message };
  }
}

/**
 * Re-run ONE saved scan config through the shared pipeline and append the results.
 *
 * `configId` is the only input: the config itself carries the filter group, the
 * display name, and the owner, all of which the `custom` row needs. The console
 * therefore cannot append rows for a config that does not exist, and cannot
 * invent a name for them.
 */
export async function rescanCustomConfig(configId: string): Promise<RescanResult> {
  const tab = "custom" as const;
  const pre = await precheckCustomRescan(configId);
  if (!pre.ok) {
    return { ok: false, tab, reason: pre.reason, error: pre.error };
  }
  const { config, filterGroup } = pre;
  try {
    const { stocks, total, executionMs } = await runCustomScan(
      { id: config.id, filters: config.filters },
      { limit: RESCAN_ROW_LIMIT, offset: 0, sortOrder: "desc" },
    );

    // Awaited, unlike the config route: this is the explicit operator action
    // whose result the console is about to report, so it must know whether the
    // ledger row exists before it says the re-scan worked.
    const outcome = await exportCustomScan(
      {
        runAt: new Date().toISOString(),
        configId: config.id,
        configName: config.name,
        userId: String(config.userId),
        filters: filterGroup,
        matchCount: total,
      },
      stocks,
      randomUUID(),
    );

    logger.info({ msg: "Google Sheets custom re-scan complete", configId, appended: stocks.length, total, outcome });
    return {
      ok: true,
      tab,
      // A disabled/failed export still ran the scan, but nothing was queued for
      // the sheet — reporting the row count alone would overstate the result.
      appended: outcome === "failed" || outcome === "disabled" ? 0 : stocks.length,
      total,
      executionMs,
      delegatedExport: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isDbUnavailableError(error)) {
      logger.warn({ msg: "Google Sheets custom re-scan: DB unavailable", message });
      return { ok: false, tab, reason: "db_unavailable", error: message };
    }
    logger.error({ msg: "Google Sheets custom re-scan failed", configId, message });
    return { ok: false, tab, reason: "error", error: message };
  }
}
