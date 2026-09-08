import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { getSqliteFallback } from "@/lib/sqlite";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await auth();
    
    if (!session || !session.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sqlite = getSqliteFallback();
    if (sqlite) {
      // SQLite-first mirror read (Plan 09 §4.8). Stats are computed from the
      // sampled window first; Prisma enrichment (user details + true totals)
      // is best-effort inside try/catch so a DB outage degrades to the mirror
      // instead of failing the admin page.
      const alerts = (sqlite.getAlerts({ limit: 100 }) as any[]).map((a) => ({
        ...a,
        triggered: !!a.triggered,
        seen: !!a.seen,
      }));

      const windowStats: Record<string, number> = {};
      for (const alert of alerts) {
        windowStats[alert.type] = (windowStats[alert.type] || 0) + 1;
      }
      const byType = Object.entries(windowStats).map(([type, _count]) => ({ type, _count }));

      let stats = {
        total: alerts.length,
        active: alerts.filter((a) => !a.triggered).length,
        triggered: alerts.filter((a) => a.triggered).length,
        byType,
      };
      let alertsWithUser = alerts.map((alert) => ({
        ...alert,
        user: alert.userId ? { id: alert.userId } : null,
      }));

      try {
        const userIds = [...new Set(alerts.map((a) => a.userId).filter((id): id is number => id !== null))];
        const users = await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, name: true },
        });
        const userMap = new Map(users.map((u) => [u.id, u]));
        alertsWithUser = alerts.map((alert) => ({
          ...alert,
          user: alert.userId ? { id: alert.userId, ...userMap.get(alert.userId) } : null,
        }));
        if (userIds.length > 0) {
          const [total, active, triggered] = await Promise.all([
            prisma.alert.count(),
            prisma.alert.count({ where: { triggered: false } }),
            prisma.alert.count({ where: { triggered: true } }),
          ]);
          stats = { total, active, triggered, byType };
        }
      } catch (err) {
        logger.warn({
          msg: "Admin alerts: Prisma enrichment skipped (mirror-only)",
          error: err instanceof Error ? err.message : String(err),
        });
      }

      return NextResponse.json({ alerts: alertsWithUser, stats });
    }

    const alerts = await prisma.alert.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const userIds = [...new Set(alerts.map(a => a.userId).filter((id): id is number => id !== null))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, name: true },
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    const alertsWithUser = alerts.map(alert => ({
      ...alert,
      user: alert.userId ? { id: alert.userId, ...userMap.get(alert.userId) } : null,
    }));

    const typeCounts: Record<string, number> = {};
    for (const alert of alerts) {
      typeCounts[alert.type] = (typeCounts[alert.type] || 0) + 1;
    }
    const byType = Object.entries(typeCounts).map(([type, _count]) => ({ type, _count }));

    const stats = {
      total: await prisma.alert.count(),
      active: await prisma.alert.count({ where: { triggered: false } }),
      triggered: await prisma.alert.count({ where: { triggered: true } }),
      byType,
    };

    return NextResponse.json({ alerts: alertsWithUser, stats });
  } catch (error) {
    logger.error({
      msg: "Admin alerts: Failed to fetch alerts",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to fetch alerts" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await auth();
    
    if (!session || !session.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: "Alert ID required" }, { status: 400 });
    }

    const sqlite = getSqliteFallback();
    if (sqlite) {
      sqlite.deleteAlert(id);
    } else {
      await prisma.alert.delete({
        where: { id },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete alert error:', error);
    return NextResponse.json({ error: "Failed to delete alert" }, { status: 500 });
  }
}
