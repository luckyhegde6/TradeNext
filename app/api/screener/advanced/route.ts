import { NextResponse } from "next/server";
import { advancedScan } from "@/lib/services/tradingview-service";
import { evaluateFilterGroup, validateFilterGroup, applyFilterGroup } from "@/lib/screener/filter-engine";
import { filterGroupSchema, getRequiredColumns, type FilterGroup, type ScanRequest } from "@/lib/screener/condition-tree";
import logger from "@/lib/logger";
import type { ZodError } from "zod";

export const dynamic = 'force-dynamic';

/**
 * POST /api/screener/advanced
 *
 * Execute a multi-condition scan against TradingView data.
 *
 * Body: {
 *   filterGroup: FilterGroup,   // Condition tree (AND/OR groups)
 *   limit?: number,             // Max results (default 50)
 *   offset?: number,            // Pagination offset (default 0)
 *   sortBy?: string,            // Sort field
 *   sortOrder?: "asc" | "desc", // Sort direction
 *   extraColumns?: string[]     // Extra TV columns to fetch
 * }
 */
export async function POST(req: Request) {
  const startTime = Date.now();

  try {
    const body: ScanRequest = await req.json();

    // 1. Validate filter group schema
    let filterGroup: FilterGroup;
    try {
      filterGroup = filterGroupSchema.parse(body.filterGroup) as FilterGroup;
    } catch (parseError) {
      const zodError = parseError as ZodError;
      return NextResponse.json(
        { error: "Invalid filter group", details: zodError.issues?.map(i => i.message) || ["Validation failed"] },
        { status: 400 }
      );
    }

    // 2. Validate conditions
    const errors = validateFilterGroup(filterGroup);
    if (errors.length > 0) {
      return NextResponse.json(
        { error: "Filter validation failed", details: errors },
        { status: 400 }
      );
    }

    // 3. Determine required TradingView columns
    const requiredColumns = getRequiredColumns(filterGroup);
    const extraColumns = body.extraColumns || [];
    const allColumns = Array.from(new Set([...requiredColumns, ...extraColumns]));

    logger.info({
      msg: "Advanced scan requested",
      conditionCount: countConditions(filterGroup),
      columns: allColumns.length,
    });

    // 4. Fetch from TradingView (with technical columns)
    const rawStocks = await advancedScan(
      [], // No additional TV-side filters — we filter server-side with the condition tree
      allColumns,
      { from: 0, to: 2000 }
    );

    if (rawStocks.length === 0) {
      return NextResponse.json({
        stocks: [],
        pagination: { page: 1, limit: body.limit || 50, total: 0, totalPages: 0 },
        executionMs: Date.now() - startTime,
        lastSyncedAt: null,
      });
    }

    // 5. Apply condition tree filtering server-side
    const { stocks: filtered, total } = applyFilterGroup(filterGroup, rawStocks, {
      sortBy: body.sortBy,
      sortOrder: body.sortOrder,
      limit: body.limit || 50,
      offset: body.offset || 0,
    });

    // 6. Normalize response — ensure percentChange field
    const normalized = filtered.map((s: Record<string, unknown>) => {
      const close = typeof s.close === 'number' ? s.close : parseFloat(String(s.close || 0));
      const change = typeof s.change === 'number' ? s.change : parseFloat(String(s.change || 0));
      return {
        ...s,
        percentChange: s.percentChange ?? s.change_percent ?? (close > 0 ? (change / (close - change)) * 100 : 0),
        close,
        change,
      };
    });

    const limit = body.limit || 50;
    const offset = body.offset || 0;
    const page = Math.floor(offset / limit) + 1;

    return NextResponse.json({
      stocks: normalized,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      executionMs: Date.now() - startTime,
      lastSyncedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ msg: "Advanced scan failed", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: "Failed to execute advanced scan" },
      { status: 500 }
    );
  }
}

function countConditions(group: FilterGroup): number {
  let count = group.conditions.length;
  for (const g of group.groups) count += countConditions(g);
  return count;
}
