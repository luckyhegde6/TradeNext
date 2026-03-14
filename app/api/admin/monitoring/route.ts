// app/api/admin/monitoring/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAPIStats, getRateLimitStats, getAnomalyAlerts, resolveAnomalyAlert, blockIdentifier, unblockIdentifier } from "@/lib/rate-limit";
import prisma from "@/lib/prisma";

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type"); // "stats", "alerts", "rate-limits"
    const hours = parseInt(searchParams.get("hours") || "24");

    switch (type) {
      case "alerts":
        const alerts = await getAnomalyAlerts(50, false);
        return NextResponse.json(alerts);

      case "rate-limits":
        const rateLimits = await prisma.rateLimitConfig.findMany({
          orderBy: { updatedAt: 'desc' },
          take: 100
        });
        return NextResponse.json(rateLimits);

      case "nse-logs":
        const nseLogs = await prisma.aPIRequestLog.findMany({
          where: { isNSE: true },
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: {
            id: true,
            requestId: true,
            path: true,
            method: true,
            statusCode: true,
            responseTime: true,
            ipAddress: true,
            userEmail: true,
            createdAt: true,
            isRateLimited: true
          }
        });
        return NextResponse.json(nseLogs);

      case "recent-requests":
        const recentRequests = await prisma.aPIRequestLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: {
            id: true,
            requestId: true,
            path: true,
            method: true,
            statusCode: true,
            responseTime: true,
            ipAddress: true,
            userEmail: true,
            createdAt: true,
            isRateLimited: true,
            isAnomaly: true
          }
        });
        return NextResponse.json(recentRequests);

      default:
        // Get all stats
        const [apiStats, rateStats, alerts] = await Promise.all([
          getAPIStats(hours),
          getRateLimitStats(),
          getAnomalyAlerts(10, true)
        ]);

        return NextResponse.json({
          apiStats,
          rateLimitStats: rateStats,
          recentAlerts: alerts,
          marketStatus: {
            isOpen: false // This would be calculated from market-hours
          }
        });
    }
  } catch (error) {
    console.error("Admin monitoring GET error:", error);
    return NextResponse.json({ error: "Failed to fetch monitoring data" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { action, identifier, alertId } = body;

    if (action === "resolve-alert" && alertId) {
      const resolved = await resolveAnomalyAlert(alertId, parseInt(session.user.id));
      return NextResponse.json(resolved);
    }

    if (action === "block" && identifier) {
      await blockIdentifier(identifier, "Manually blocked by admin");
      return NextResponse.json({ success: true, message: `Blocked ${identifier}` });
    }

    if (action === "unblock" && identifier) {
      await unblockIdentifier(identifier);
      return NextResponse.json({ success: true, message: `Unblocked ${identifier}` });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Admin monitoring PUT error:", error);
    return NextResponse.json({ error: "Failed to perform action" }, { status: 500 });
  }
}
