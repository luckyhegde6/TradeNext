import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await auth();
    
    if (!session || !session.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    console.error('Admin alerts error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Failed to fetch alerts", details: message }, { status: 500 });
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

    await prisma.alert.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete alert error:', error);
    return NextResponse.json({ error: "Failed to delete alert" }, { status: 500 });
  }
}
