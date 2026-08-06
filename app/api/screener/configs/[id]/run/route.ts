/**
 * POST /api/screener/configs/:id/run
 *
 * Execute a saved scan config against TradingView data.
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getRequiredColumns } from "@/lib/screener/condition-tree";
import { evaluateFilterGroup, applyFilterGroup } from "@/lib/screener/filter-engine";
import { advancedScan, DEFAULT_COLUMNS } from "@/lib/services/tradingview-service";
import logger from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const limit = body.limit ?? 50;
    const offset = body.offset ?? 0;
    const sortBy = body.sortBy;
    const sortOrder: "asc" | "desc" = body.sortOrder ?? "desc";

    // Load config
    const config = await prisma.scanConfig.findUnique({ where: { id } });
    if (!config) {
      return NextResponse.json({ error: "Config not found" }, { status: 404 });
    }
    if (config.userId !== Number(session.user.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const filterGroup = config.filters as any;
    if (!filterGroup || !filterGroup.conditions) {
      return NextResponse.json({ error: "Config has no filter group" }, { status: 400 });
    }

    // Determine required TV columns
    const requiredCols = getRequiredColumns(filterGroup);
    const columns = [...new Set([...DEFAULT_COLUMNS, ...requiredCols])];

    // Fetch from TradingView
    const startMs = Date.now();
    const allStocks = await advancedScan([], columns, { from: 0, to: 2000 });
    const fetchMs = Date.now() - startMs;

    // Apply filter & paginate
    const { stocks, total } = applyFilterGroup(filterGroup, allStocks, {
      sortBy,
      sortOrder,
      limit,
      offset,
    });

    const executionMs = Date.now() - startMs;

    logger.info({
      msg: "Saved config executed",
      configId: id,
      total,
      returned: stocks.length,
      fetchMs,
      executionMs,
    });

    return NextResponse.json({
      success: true,
      config: {
        id: config.id,
        name: config.name,
      },
      stocks,
      pagination: {
        page: Math.floor(offset / limit) + 1,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      executionMs,
    });
  } catch (error) {
    logger.error({ msg: "Failed to execute config", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to execute config" }, { status: 500 });
  }
}
