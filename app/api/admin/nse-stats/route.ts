import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const hours = parseInt(searchParams.get('hours') || '24');
    const startDate = new Date();
    startDate.setHours(startDate.getHours() - hours);

    const [totalNseCalls, callsByHour, callsByEndpoint, flaggedRateLimits] = await Promise.all([
      prisma.auditLog.count({
        where: {
          action: 'NSE_CALL',
          createdAt: { gte: startDate },
        },
      }),
      prisma.auditLog.groupBy({
        by: ['createdAt'],
        where: {
          action: 'NSE_CALL',
          createdAt: { gte: startDate },
        },
        _count: true,
      }),
      prisma.auditLog.groupBy({
        by: ['nseEndpoint'],
        where: {
          action: 'NSE_CALL',
          createdAt: { gte: startDate },
        },
        _count: true,
        orderBy: {
          _count: {
            nseEndpoint: 'desc',
          },
        },
        take: 10,
      }),
      prisma.rateLimit.findMany({
        where: { isFlagged: true },
        take: 10,
      }),
    ]);

    const userIds = [...new Set(flaggedRateLimits.map(r => r.userId))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    const hourlyData: Record<string, number> = {};
    callsByHour.forEach((call: any) => {
      const hour = new Date(call.createdAt).getHours();
      hourlyData[hour] = (hourlyData[hour] || 0) + call._count;
    });

    return NextResponse.json({
      totalCalls: totalNseCalls,
      byEndpoint: callsByEndpoint.map((e: any) => ({
        endpoint: e.nseEndpoint || 'unknown',
        count: e._count,
      })),
      hourlyData,
      flaggedUsers: flaggedRateLimits.map((u: any) => {
        const user = userMap.get(u.userId);
        return {
          userId: u.userId,
          userName: user?.name,
          userEmail: user?.email,
          endpoint: u.endpoint,
          requestCount: u.requestCount,
        };
      }),
    });
  } catch (error) {
    console.error('NSE stats GET error:', error);
    return NextResponse.json({ error: "Failed to fetch NSE stats" }, { status: 500 });
  }
}
