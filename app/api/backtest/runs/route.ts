/**
 * GET /api/backtest/runs
 *
 * List user's backtest runs.
 * Query params: limit (default 20), offset (default 0)
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import logger from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
    const offset = parseInt(url.searchParams.get("offset") || "0");

    const [runs, total] = await Promise.all([
      prisma.backtestRun.findMany({
        where: { userId: Number(session.user.id) },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          _count: { select: { trades: true } },
        },
      }),
      prisma.backtestRun.count({
        where: { userId: Number(session.user.id) },
      }),
    ]);

    return NextResponse.json({
      runs: runs.map((r: { id: string; name: string; status: string; totalTrades: number; winRate: unknown; totalPnl: unknown; maxDrawdown: unknown; sharpeRatio: unknown; initialCapital: unknown; createdAt: Date; _count: { trades: number } }) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        totalTrades: r.totalTrades,
        winRate: Number(r.winRate),
        totalPnl: Number(r.totalPnl),
        maxDrawdown: Number(r.maxDrawdown),
        sharpeRatio: Number(r.sharpeRatio),
        initialCapital: Number(r.initialCapital),
        createdAt: r.createdAt.toISOString(),
        tradeCount: r._count.trades,
      })),
      pagination: { total, limit, offset },
    });
  } catch (error) {
    logger.error({ msg: "Failed to list backtest runs", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to list backtest runs" }, { status: 500 });
  }
}
