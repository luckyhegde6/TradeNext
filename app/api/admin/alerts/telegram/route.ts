import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/admin/alerts/telegram
 *
 * Returns Telegram subscribers, delivery logs, and call logs for admin observability.
 * Auth: Admin only.
 *
 * Query params:
 *   section=subscribers  — List of RecommendationAlertSubscription with user info
 *   section=deliveries   — AuditLog entries for TELEGRAM_* actions
 *   section=calls        — AuditLog entries for AI_AGENT_* actions (Telegram bot calls)
 *   section=stats        — Aggregate counts
 *   limit=100            — Max records (default 100)
 *   offset=0             — Pagination offset
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const section = searchParams.get("section") || "stats";
    const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 500);
    const offset = parseInt(searchParams.get("offset") || "0");

    switch (section) {
      case "subscribers": {
        const [subs, total] = await Promise.all([
          prisma.recommendationAlertSubscription.findMany({
            orderBy: { createdAt: "desc" },
            skip: offset,
            take: limit,
          }),
          prisma.recommendationAlertSubscription.count(),
        ]);

        // Enrich with user info
        const userIds = [...new Set(subs.map((s) => s.userId))];
        const users = await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, name: true },
        });
        const userMap = new Map(users.map((u) => [u.id, u]));

        return NextResponse.json({
          subscribers: subs.map((s) => ({
            ...s,
            user: userMap.get(s.userId) || null,
          })),
          total,
          limit,
          offset,
        });
      }

      case "deliveries": {
        const where = {
          action: {
            in: [
              "TELEGRAM_SUBSCRIBE",
              "TELEGRAM_UNSUBSCRIBE",
              "TELEGRAM_COMMAND",
              "TELEGRAM_BROADCAST",
            ],
          },
        };

        const [logs, total] = await Promise.all([
          prisma.auditLog.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip: offset,
            take: limit,
          }),
          prisma.auditLog.count({ where }),
        ]);

        return NextResponse.json({
          deliveries: logs,
          total,
          limit,
          offset,
        });
      }

      case "calls": {
        const where = {
          action: {
            in: [
              "AI_AGENT_TRIGGER",
              "AI_AGENT_SUCCESS",
              "AI_AGENT_FAILURE",
              "AI_AGENT_FALLBACK",
            ],
          },
        };

        const [logs, total] = await Promise.all([
          prisma.auditLog.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip: offset,
            take: limit,
          }),
          prisma.auditLog.count({ where }),
        ]);

        return NextResponse.json({
          calls: logs,
          total,
          limit,
          offset,
        });
      }

      case "stats":
      default: {
        const [
          totalSubscribers,
          activeSubscribers,
          totalTelegramEvents,
          totalAIEvents,
          recentSubscribers,
        ] = await Promise.all([
          prisma.recommendationAlertSubscription.count(),
          prisma.recommendationAlertSubscription.count({ where: { isActive: true } }),
          prisma.auditLog.count({
            where: {
              action: {
                in: [
                  "TELEGRAM_SUBSCRIBE",
                  "TELEGRAM_UNSUBSCRIBE",
                  "TELEGRAM_COMMAND",
                  "TELEGRAM_BROADCAST",
                ],
              },
            },
          }),
          prisma.auditLog.count({
            where: {
              action: {
                in: [
                  "AI_AGENT_TRIGGER",
                  "AI_AGENT_SUCCESS",
                  "AI_AGENT_FAILURE",
                  "AI_AGENT_FALLBACK",
                ],
              },
            },
          }),
          prisma.recommendationAlertSubscription.findMany({
            orderBy: { createdAt: "desc" },
            take: 5,
            select: { id: true, userId: true, chatId: true, isActive: true, createdAt: true },
          }),
        ]);

        return NextResponse.json({
          totalSubscribers,
          activeSubscribers,
          inactiveSubscribers: totalSubscribers - activeSubscribers,
          totalTelegramEvents,
          totalAIEvents,
          recentSubscribers,
        });
      }
    }
  } catch (err) {
    logger.error({
      msg: "Admin: Failed to get Telegram data",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Failed to get Telegram data" },
      { status: 500 }
    );
  }
}
