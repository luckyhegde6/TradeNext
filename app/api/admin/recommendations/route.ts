import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { spawnRegularTask } from "@/lib/services/worker/task-orchestrator";
import { ensureRecommendationCrons } from "@/lib/services/recommendationCronService";

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
      prisma.recommendationTracker.count({ where: { status: "tracking" } }),
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

    // Self-heal: ensure the two SYSTEM-managed recommendation cron jobs exist
    // and are active (idempotent upsert by stable name).
    const cronResult = await ensureRecommendationCrons().catch((e) => {
      logger.warn({ msg: "ensureRecommendationCrons failed (non-fatal)", error: e });
      return { ensured: 0, jobs: [] };
    });

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
        triggeredBy: r.triggeredBy,
        uniqueStocks: r.uniqueStocks,
        aiProcessed: r.aiProcessed,
        executionTimeMs: r.executionTimeMs,
        stockCount: r.stocks.length,
      })),
      crons: cronResult.jobs,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: "Failed to fetch admin overview" }, { status: 500 });
  }
}

// POST /api/admin/recommendations — Trigger manual run / performance check
// Both actions spawn a background worker task (triggeredBy: "system") so the
// long pipeline never blocks the HTTP response. The worker engine polls and
// executes it; the admin UI shows progress via /admin/workers.
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
    }

    const body = await request.json();
    const { action } = body;

    if (action === "run_now") {
      const task = await spawnRegularTask({
        name: "Daily Recommendations (Admin)",
        taskType: "recommendations",
        triggeredBy: "system",
        priority: 8,
        payload: { source: "admin_manual" },
        createdBy: Number(session.user.id),
      });
      logger.info({ msg: "Admin triggered recommendation run", taskId: task.id });
      return NextResponse.json({ success: true, message: "Recommendation run queued", taskId: task.id });
    }

    if (action === "check_performance") {
      const task = await spawnRegularTask({
        name: "Recommendation Performance Check (Admin)",
        taskType: "recommendation_performance",
        triggeredBy: "system",
        priority: 8,
        payload: { source: "admin_manual" },
        createdBy: Number(session.user.id),
      });
      logger.info({ msg: "Admin triggered performance check", taskId: task.id });
      return NextResponse.json({ success: true, message: "Performance check queued", taskId: task.id });
    }

    return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 });
  } catch (error) {
    logger.error({ msg: "Admin recommendation action failed", error });
    return NextResponse.json({ success: false, error: "Action failed" }, { status: 500 });
  }
}
