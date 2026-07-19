import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runDailyRecommendations, checkRecommendationPerformance } from "@/lib/services/dailyRecommendationService";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

export const runtime = "nodejs";

// GET /api/admin/recommendations — Get admin overview
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
    }

    const [totalRuns, activeTrackers, recentRuns, performanceStats] = await Promise.all([
      prisma.dailyRecommendationRun.count(),
      prisma.recommendationTracker.count({ where: { status: "active" } }),
      prisma.dailyRecommendationRun.findMany({
        orderBy: { runDate: "desc" },
        take: 10,
        include: { stocks: { select: { id: true } } },
      }),
      prisma.recommendationTracker.groupBy({
        by: ["status"],
        _count: true,
      }),
    ]);

    const statusBreakdown: Record<string, number> = {};
    for (const s of performanceStats) {
      statusBreakdown[s.status] = s._count;
    }

    return NextResponse.json({
      success: true,
      stats: {
        totalRuns,
        activeTrackers,
        statusBreakdown,
      },
      recentRuns: recentRuns.map((r: (typeof recentRuns)[number]) => ({
        id: r.id,
        runDate: r.runDate,
        status: r.status,
        uniqueStocks: r.uniqueStocks,
        aiProcessed: r.aiProcessed,
        executionTimeMs: r.executionTimeMs,
        stockCount: r.stocks.length,
      })),
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: "Failed to fetch admin overview" }, { status: 500 });
  }
}

// POST /api/admin/recommendations — Trigger manual run
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
    }

    const body = await request.json();
    const { action } = body;

    if (action === "run_now") {
      // Fire-and-forget: start pipeline in background, return immediately
      runDailyRecommendations().catch((err) => {
        logger.error({ msg: "Background recommendation run failed", error: err instanceof Error ? err.message : String(err) });
      });
      return NextResponse.json({ success: true, message: "Recommendation run started in background" });
    }

    if (action === "check_performance") {
      const result = await checkRecommendationPerformance();
      return NextResponse.json({ success: true, result });
    }

    return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 });
  } catch (error) {
    logger.error({ msg: "Admin recommendation action failed", error });
    return NextResponse.json({ success: false, error: "Action failed" }, { status: 500 });
  }
}
