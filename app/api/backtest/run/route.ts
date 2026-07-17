/**
 * POST /api/backtest/run
 *
 * Run a backtest for a single symbol against historical DailyPrice data.
 * Entry/exit are defined via the FilterGroup condition tree.
 *
 * Request body:
 * {
 *   symbol: string;
 *   entryFilter: FilterGroup;
 *   profitTarget?: number;
 *   stopLoss?: number;
 *   trailingStop?: number;
 *   maxHoldingBars?: number;
 *   initialCapital: number;
 *   positionSizePercent?: number;
 *   name?: string;
 * }
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { filterGroupSchema } from "@/lib/screener/condition-tree";
import { runBacktest } from "@/lib/screener/backtest-engine";
import type { OHLCV } from "@/lib/screener/technical-analysis";
import logger from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      symbol,
      entryFilter,
      profitTarget,
      stopLoss,
      trailingStop,
      maxHoldingBars,
      initialCapital,
      positionSizePercent,
      name,
    } = body;

    // --- Validation ---
    if (!symbol || typeof symbol !== "string") {
      return NextResponse.json({ error: "symbol is required" }, { status: 400 });
    }

    if (!entryFilter) {
      return NextResponse.json({ error: "entryFilter is required" }, { status: 400 });
    }

    // Validate entry filter against Zod schema
    const filterResult = filterGroupSchema.safeParse(entryFilter);
    if (!filterResult.success) {
      return NextResponse.json({
        error: "Invalid entryFilter",
        details: filterResult.error.issues,
      }, { status: 400 });
    }

    if (!initialCapital || typeof initialCapital !== "number" || initialCapital <= 0) {
      return NextResponse.json({ error: "initialCapital must be a positive number" }, { status: 400 });
    }

    // Verify symbol exists
    const symbolRecord = await prisma.symbol.findUnique({
      where: { symbol: symbol.toUpperCase() },
    });

    if (!symbolRecord) {
      return NextResponse.json({ error: `Symbol "${symbol}" not found` }, { status: 404 });
    }

    const ticker = `NSE:${symbol.toUpperCase()}`;

    // --- Fetch historical DailyPrice data ---
    const dailyPrices = await prisma.dailyPrice.findMany({
      where: { ticker },
      orderBy: { tradeDate: "asc" },
    });

    if (dailyPrices.length < 50) {
      return NextResponse.json({
        error: `Insufficient historical data for ${symbol}. Found ${dailyPrices.length} bars, need at least 50.`,
      }, { status: 400 });
    }

    // Convert to OHLCV format
    const ohlcv: OHLCV[] = dailyPrices.map((dp: { tradeDate: Date; open: unknown; high: unknown; low: unknown; close: unknown; volume: unknown }) => ({
      timestamp: dp.tradeDate.getTime(),
      open: Number(dp.open ?? 0),
      high: Number(dp.high ?? 0),
      low: Number(dp.low ?? 0),
      close: Number(dp.close ?? 0),
      volume: Number(dp.volume ?? 0),
    }));

    // --- Run the backtest ---
    const result = runBacktest(symbol, ohlcv, {
      entryFilter: filterResult.data as any,
      profitTarget,
      stopLoss,
      trailingStop,
      maxHoldingBars,
      initialCapital,
      positionSizePercent,
    });

    // --- Save to database ---
    const backtestRun = await prisma.backtestRun.create({
      data: {
        userId: Number(session.user.id),
        name: name || `Backtest: ${symbol} - ${new Date().toLocaleDateString()}`,
        entryFilter: body.entryFilter as any,
        exitFilter: body.exitFilter || null,
        startDate: dailyPrices[0].tradeDate,
        endDate: dailyPrices[dailyPrices.length - 1].tradeDate,
        initialCapital,
        totalTrades: result.metrics.totalTrades,
        winRate: result.metrics.winRate,
        totalPnl: result.metrics.totalReturn,
        maxDrawdown: result.metrics.maxDrawdownPercent,
        sharpeRatio: result.metrics.sharpeRatio,
        status: "completed",
        // Create trades relation
        trades: {
          create: result.trades.map((t) => ({
            symbol,
            entryDate: new Date(t.entryDate),
            exitDate: t.exitDate ? new Date(t.exitDate) : null,
            entryPrice: t.entryPrice,
            exitPrice: t.exitPrice,
            quantity: t.quantity,
            pnl: t.pnl,
            pnlPercent: t.pnlPercent,
            exitReason: t.exitReason,
          })),
        },
      },
      include: { trades: true },
    });

    logger.info({
      msg: "Backtest completed",
      userId: session.user.id,
      symbol,
      trades: result.trades.length,
      totalReturn: result.metrics.totalReturnPercent,
    });

    return NextResponse.json({
      success: true,
      run: {
        id: backtestRun.id,
        name: backtestRun.name,
        status: backtestRun.status,
        totalTrades: backtestRun.totalTrades,
        winRate: Number(backtestRun.winRate),
        totalPnl: Number(backtestRun.totalPnl),
        maxDrawdown: Number(backtestRun.maxDrawdown),
        sharpeRatio: Number(backtestRun.sharpeRatio),
      },
      metrics: result.metrics,
      trades: result.trades,
      barCount: result.barCount,
    });
  } catch (error) {
    logger.error({ msg: "Backtest failed", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Backtest failed" }, { status: 500 });
  }
}
