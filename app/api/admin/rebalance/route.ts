import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/admin/rebalance — Admin rebalancer overview
 * Shows aggregate allocation stats across all users with configs.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const totalConfigs = await prisma.rebalancerConfig.count();
    const usersWithConfigs = await prisma.rebalancerConfig.groupBy({
      by: ["userId"],
    });
    const uniqueUsers = usersWithConfigs.length;

    // Get all configs for aggregate analysis
    const configs = await prisma.rebalancerConfig.findMany({
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { updatedAt: "desc" },
    });

    // Aggregate category preferences
    const categoryUsage = new Map<string, number>();
    let totalThreshold = 0;
    for (const c of configs) {
      totalThreshold += Number(c.driftThreshold);
      const cats = c.categories as Array<{ name: string; targetPercent: number; type: string }>;
      for (const cat of cats) {
        categoryUsage.set(cat.name, (categoryUsage.get(cat.name) || 0) + 1);
      }
    }
    const avgThreshold = configs.length > 0 ? totalThreshold / configs.length : 5;

    // Most popular categories
    const topCategories = [...categoryUsage.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    return NextResponse.json({
      totalConfigs,
      uniqueUsers,
      avgDriftThreshold: Math.round(avgThreshold * 10) / 10,
      topCategories,
      latestConfigs: configs.slice(0, 20).map((c) => ({
        id: c.id,
        name: c.name,
        user: c.user,
        numCategories: (c.categories as any[]).length,
        driftThreshold: Number(c.driftThreshold),
        updatedAt: c.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    logger.error({ msg: "Failed to fetch admin rebalance overview", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
