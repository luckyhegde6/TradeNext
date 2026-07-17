import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

export const runtime = "nodejs";

function safeInt(val: string | null, fallback: number): number {
  if (val === null) return fallback;
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

/**
 * GET /api/admin/alerts/events — admin view of all alert events with delivery logs
 * Query: status, channelType, ruleId, userId, limit, offset, hours
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const channelType = url.searchParams.get("channelType");
    const ruleId = url.searchParams.get("ruleId");
    const userId = url.searchParams.get("userId");
    const limit = Math.min(safeInt(url.searchParams.get("limit"), 50), 200);
    const offset = Math.max(safeInt(url.searchParams.get("offset"), 0), 0);
    const hours = Math.max(safeInt(url.searchParams.get("hours"), 48), 1);

    const where: any = {
      attemptedAt: { gte: new Date(Date.now() - hours * 60 * 60 * 1000) },
    };
    if (status) where.status = status;
    if (channelType) where.channelType = channelType;
    if (ruleId) where.ruleId = ruleId;
    if (userId) where.rule = { userId: parseInt(userId) };

    const [events, total] = await Promise.all([
      prisma.alertEvent.findMany({
        where,
        orderBy: { attemptedAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          rule: {
            select: { name: true, userId: true },
          },
        },
      }),
      prisma.alertEvent.count({ where }),
    ]);

    // Enrich with user info
    const userIds = [...new Set(events.map((e) => e.rule?.userId).filter((id): id is number => id != null))];
    const users = userIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, name: true } })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    const enrichedEvents = events.map((ev) => ({
      ...ev,
      rule: ev.rule ? { ...ev.rule, user: userMap.get(ev.rule.userId) ?? null } : undefined,
    }));

    // Delivery stats for the time window
    const stats = await prisma.alertEvent.groupBy({
      by: ["status", "channelType"],
      where: {
        attemptedAt: { gte: new Date(Date.now() - hours * 60 * 60 * 1000) },
      },
      _count: true,
    });

    return NextResponse.json({
      events: enrichedEvents,
      total,
      limit,
      offset,
      hours,
      stats: {
        byStatus: stats.reduce(
          (acc, s) => {
            acc[s.status] = (acc[s.status] || 0) + s._count;
            return acc;
          },
          {} as Record<string, number>
        ),
        byChannel: stats.reduce(
          (acc, s) => {
            acc[s.channelType] = (acc[s.channelType] || 0) + s._count;
            return acc;
          },
          {} as Record<string, number>
        ),
      },
    });
  } catch (error) {
    logger.error({
      msg: "Admin: Failed to list alert events",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to list events" }, { status: 500 });
  }
}
