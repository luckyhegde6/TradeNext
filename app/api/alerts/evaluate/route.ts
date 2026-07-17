import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { evaluateAndDeliver } from "@/lib/alerts/alert-engine";

export const runtime = "nodejs";

/**
 * POST /api/alerts/evaluate — trigger evaluation of alert rules
 * Body: { ruleIds?: string[] } (optional — if omitted, evaluates all active rules for user)
 *
 * This can be called:
 * - On page load (as a fallback for serverless environments)
 * - By a cron job / background worker
 * - Manually by the user
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = parseInt(session.user.id);

    const body = await req.json().catch(() => ({}));
    const { ruleIds } = body;

    logger.info({
      msg: "Alert evaluation triggered",
      userId,
      ruleIds: ruleIds || "all",
    });

    const results = await evaluateAndDeliver(ruleIds || undefined, userId);

    const triggered = results.filter((r) => r.triggered);
    const failed = results.filter((r) => !r.triggered);

    return NextResponse.json({
      evaluated: results.length,
      triggered: triggered.length,
      results,
    });
  } catch (error) {
    logger.error({
      msg: "Alert evaluation failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Alert evaluation failed" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/alerts/evaluate/stats — get alert evaluation stats
 * Returns stats about user's alert rules and events
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = parseInt(session.user.id);

    const url = new URL(req.url);
    if (url.pathname.endsWith("/stats")) {
      const [totalRules, activeRules, totalEvents, recentEvents] = await Promise.all([
        prisma.alertRule.count({ where: { userId } }),
        prisma.alertRule.count({ where: { userId, isActive: true } }),
        prisma.alertEvent.count({
          where: {
            rule: { userId },
          },
        }),
        prisma.alertEvent.findMany({
          where: { rule: { userId } },
          orderBy: { attemptedAt: "desc" },
          take: 10,
          include: { rule: { select: { name: true } } },
        }),
      ]);

      return NextResponse.json({
        totalRules,
        activeRules,
        totalEvents,
        recentEvents,
      });
    }

    return NextResponse.json({ error: "Use POST to evaluate" }, { status: 400 });
  } catch (error) {
    logger.error({
      msg: "Failed to get alert stats",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to get alert stats" },
      { status: 500 }
    );
  }
}
