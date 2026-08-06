import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/alerts/events — list alert event history for the user's rules
 * Query params: ruleId (optional filter), status (optional), limit (default 50), offset (default 0)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = parseInt(session.user.id);

    const url = new URL(req.url);
    const ruleId = url.searchParams.get("ruleId");
    const status = url.searchParams.get("status");
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const offset = parseInt(url.searchParams.get("offset") || "0");

    // Get user's rule IDs first
    const userRules = await prisma.alertRule.findMany({
      where: { userId },
      select: { id: true, name: true },
    });
    const userRuleIds = userRules.map((r) => r.id);

    if (userRuleIds.length === 0) {
      return NextResponse.json({ events: [], total: 0 });
    }

    const where: any = {
      ruleId: ruleId || { in: userRuleIds },
    };
    if (status) where.status = status;

    // Only allow querying own rules
    if (!ruleId || userRuleIds.includes(ruleId)) {
      const [events, total] = await Promise.all([
        prisma.alertEvent.findMany({
          where: ruleId ? { ruleId, status: status || undefined } : { ruleId: { in: userRuleIds }, status: status || undefined },
          orderBy: { attemptedAt: "desc" },
          take: Math.min(limit, 100),
          skip: offset,
        }),
        prisma.alertEvent.count({
          where: ruleId ? { ruleId, status: status || undefined } : { ruleId: { in: userRuleIds }, status: status || undefined },
        }),
      ]);

      // Map rule names to events
      const ruleMap = new Map(userRules.map((r) => [r.id, r.name]));
      const enrichedEvents = events.map((ev) => ({
        ...ev,
        ruleName: ruleMap.get(ev.ruleId) || "Unknown",
      }));

      return NextResponse.json({ events: enrichedEvents, total, limit, offset });
    }

    return NextResponse.json({ events: [], total: 0 });
  } catch (error) {
    logger.error({
      msg: "Failed to list alert events",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to list alert events" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/alerts/events?action=acknowledge — acknowledge an alert event
 * Body: { ruleId }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = parseInt(session.user.id);

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (action === "acknowledge") {
      const body = await req.json();
      const { ruleId, eventId } = body;

      if (eventId) {
        // Acknowledge specific event
        const event = await prisma.alertEvent.findUnique({
          where: { id: eventId },
          include: { rule: { select: { userId: true } } },
        });
        if (!event || event.rule.userId !== userId) {
          return NextResponse.json({ error: "Event not found" }, { status: 404 });
        }
        await prisma.alertEvent.update({
          where: { id: eventId },
          data: { acknowledgedAt: new Date() },
        });
      } else if (ruleId) {
        // Verify ownership
        const rule = await prisma.alertRule.findFirst({
          where: { id: ruleId, userId },
        });
        if (!rule) {
          return NextResponse.json({ error: "Rule not found" }, { status: 404 });
        }
        // Acknowledge all unacknowledged events for this rule
        await prisma.alertEvent.updateMany({
          where: { ruleId, acknowledgedAt: null },
          data: { acknowledgedAt: new Date() },
        });
      } else {
        return NextResponse.json(
          { error: "ruleId or eventId is required" },
          { status: 400 }
        );
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    logger.error({
      msg: "Failed to acknowledge alert event",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to acknowledge alert" },
      { status: 500 }
    );
  }
}
