/**
 * GET /api/backtest/runs/:id
 *
 * Get details of a single backtest run, including all trades.
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import logger from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const run = await prisma.backtestRun.findUnique({
      where: { id },
      include: {
        trades: {
          orderBy: { entryDate: "asc" },
        },
      },
    });

    if (!run) {
      return NextResponse.json({ error: "Backtest run not found" }, { status: 404 });
    }

    // Verify ownership
    if (run.userId !== Number(session.user.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({
      run: {
        id: run.id,
        name: run.name,
        status: run.status,
        entryFilter: run.entryFilter,
        exitFilter: run.exitFilter,
        startDate: run.startDate.toISOString(),
        endDate: run.endDate.toISOString(),
        initialCapital: Number(run.initialCapital),
        totalTrades: run.totalTrades,
        winRate: Number(run.winRate),
        totalPnl: Number(run.totalPnl),
        maxDrawdown: Number(run.maxDrawdown),
        sharpeRatio: Number(run.sharpeRatio),
        createdAt: run.createdAt.toISOString(),
      },
      trades: run.trades.map((t: { id: string; symbol: string; entryDate: Date; exitDate: Date | null; entryPrice: unknown; exitPrice: unknown; quantity: number | null; pnl: unknown; pnlPercent: unknown; exitReason: string | null }) => ({
        id: t.id,
        symbol: t.symbol,
        entryDate: t.entryDate.toISOString(),
        exitDate: t.exitDate?.toISOString() ?? null,
        entryPrice: Number(t.entryPrice),
        exitPrice: Number(t.exitPrice),
        quantity: t.quantity,
        pnl: Number(t.pnl),
        pnlPercent: Number(t.pnlPercent),
        exitReason: t.exitReason,
      })),
    });
  } catch (error) {
    logger.error({ msg: "Failed to get backtest run", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to get backtest run" }, { status: 500 });
  }
}
