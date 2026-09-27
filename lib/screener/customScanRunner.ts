/**
 * Reusable custom ("saved config") scan pipeline — extracted from
 * `app/api/screener/configs/[id]/run/route.ts` so the Google Sheets admin
 * console can re-run a config through the EXACT same code path (Spec 20).
 *
 * WHY THIS EXISTS
 * A re-scan that quietly used a different pipeline would produce rows the user
 * cannot reconcile with the runs already in their sheet: different columns,
 * different universe, different sort. So the console calls this, not a
 * re-implementation. There is exactly one definition of "run a saved config".
 *
 * WHAT IT DOES *NOT* DO
 *   - No auth. The two callers have different and non-negotiable rules: the
 *     config route must prove the config is the caller's (`config.userId ===
 *     session.user.id`), while the console must prove the caller is an admin.
 *     Forcing a single identity check here would mean one of those callers gets
 *     the weaker guarantee, so ownership stays with the caller and this function
 *     stays a pure pipeline.
 *   - No Google Sheets export. The caller decides whether this is an ordinary
 *     run or an explicit re-scan, and the run route's export is gated on
 *     `offset === 0` (paging must not re-append) whereas a re-scan always
 *     appends. That asymmetry belongs to the caller, not here.
 *   - No HTTP. `fetchMs`/`executionMs` are returned, not logged here, so the
 *     console can surface a real duration and the route can keep its own log.
 */
import { getRequiredColumns, type FilterGroup } from "@/lib/screener/condition-tree";
import { applyFilterGroup } from "@/lib/screener/filter-engine";
import { advancedScan, DEFAULT_COLUMNS } from "@/lib/services/tradingview-service";

/**
 * Everything the pipeline needs from a `ScanConfig`.
 *
 * Deliberately ONLY the filter group (plus the id, for error messages): `name`
 * and `userId` are not used to run a scan, and carrying them would suggest the
 * pipeline does something with ownership that it does not. The rescan caller
 * still has the whole config for the sheet row it builds afterwards.
 */
export interface CustomScanTarget {
  id: string;
  filters: unknown;
}

export interface CustomScanPageOptions {
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface CustomScanOutcome {
  /** The requested page, already filtered and paginated. */
  stocks: Record<string, unknown>[];
  /** Full match count across the universe — NOT `stocks.length`. */
  total: number;
  /** Time inside the TradingView scan. */
  fetchMs: number;
  /** Wall time for the whole call, fetch included. */
  executionMs: number;
}

/**
 * Fetch the whole universe for a filter group.
 *
 * `DEFAULT_COLUMNS` is always unioned with the columns the conditions reference,
 * because a condition on `RSI` needs `RSI` in the scan request; omitting it makes
 * the condition evaluate against `undefined` and silently match everything.
 */
export async function fetchUniverseForFilter(
  filterGroup: FilterGroup,
  to = 2000,
): Promise<{ stocks: Record<string, unknown>[]; fetchMs: number }> {
  const requiredCols = getRequiredColumns(filterGroup);
  const columns = [...new Set([...DEFAULT_COLUMNS, ...requiredCols])];
  const startMs = Date.now();
  const stocks = await advancedScan([], columns, { from: 0, to });
  return { stocks, fetchMs: Date.now() - startMs };
}

/** Narrow a stored `filters` blob to a `FilterGroup`, or null if it is unusable. */
export function asFilterGroup(filters: unknown): FilterGroup | null {
  if (!filters || typeof filters !== "object") return null;
  const group = filters as FilterGroup;
  // A group with no `conditions` matches everything, so treating it as valid
  // would silently turn a broken config into a full-universe scan. The route
  // rejects it; so must every caller.
  if (!Array.isArray(group.conditions)) return null;
  return group;
}

/**
 * Run one saved config: fetch the universe, apply the filter, paginate.
 *
 * The filter is always applied to the FULL universe and only then paginated, so
 * `total` and the page contents agree regardless of `offset`. Paging before
 * filtering would make a deep page report a total that changes as you scroll.
 */
export async function runCustomScan(
  target: CustomScanTarget,
  options: CustomScanPageOptions = {},
): Promise<CustomScanOutcome> {
  const filterGroup = asFilterGroup(target.filters);
  if (!filterGroup) {
    throw new Error(`Config ${target.id} has no usable filter group`);
  }

  const { limit = 50, offset = 0, sortBy, sortOrder = "desc" } = options;

  const startMs = Date.now();
  const { stocks: allStocks, fetchMs } = await fetchUniverseForFilter(filterGroup);
  const { stocks, total } = applyFilterGroup(filterGroup, allStocks, {
    sortBy,
    sortOrder,
    limit,
    offset,
  });

  return { stocks, total, fetchMs, executionMs: Date.now() - startMs };
}
