// app/api/admin/monitoring/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAPIStats, getRateLimitStats, getAnomalyAlerts, resolveAnomalyAlert, blockIdentifier, unblockIdentifier } from "@/lib/rate-limit";
import prisma from "@/lib/prisma";
import { getLogFiles, readLogFile, deleteLogFile, getNseApiCalls, getHttpLogs, clearHttpLogs, logHttpRequest } from "@/lib/logger";
import logger from "@/lib/logger";

export async function GET(req: Request) {
  const startTime = Date.now();
  const url = req.url || '';
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const userAgent = req.headers.get('user-agent') || '';

  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      logHttpRequest('GET', url, 401, Date.now() - startTime, ip, userAgent);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type"); // "stats", "alerts", "rate-limits", "server-logs", "nse-calls", "http-logs"
    const hours = parseInt(searchParams.get("hours") || "24");
    const date = searchParams.get("date");
    const filePath = searchParams.get("filePath");

    switch (type) {
      case "alerts": {
        const alerts = await getAnomalyAlerts(50, false);
        logHttpRequest('GET', url, 200, Date.now() - startTime, ip, userAgent);
        return NextResponse.json(alerts);
      }

      case "rate-limits": {
        const rateLimits = await prisma.rateLimitConfig.findMany({
          orderBy: { updatedAt: 'desc' },
          take: 100
        });
        logHttpRequest('GET', url, 200, Date.now() - startTime, ip, userAgent);
        return NextResponse.json(rateLimits);
      }

      case "nse-logs": {
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
        logHttpRequest('GET', url, 200, Date.now() - startTime, ip, userAgent);
        return NextResponse.json(nseLogs);
      }

      case "nse-calls": {
        // Get in-memory NSE API calls
        const nseCalls = getNseApiCalls(100);
        logHttpRequest('GET', url, 200, Date.now() - startTime, ip, userAgent);
        return NextResponse.json(nseCalls);
      }

      case "http-logs": {
        // Get in-memory HTTP request logs
        const limit = parseInt(searchParams.get("limit") || "100");
        const httpLogs = getHttpLogs(limit);
        logHttpRequest('GET', url, 200, Date.now() - startTime, ip, userAgent);
        return NextResponse.json(httpLogs);
      }

      case "http-stats": {
        // Compute HTTP stats from logs
        const logs = getHttpLogs(1000);

        // Calculate stats
        const totalRequests = logs.length;

        // Latency stats
        const responseTimes = logs.filter(l => l.responseTime).map(l => l.responseTime);
        const avgLatency = responseTimes.length > 0
          ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
          : 0;
        const minLatency = responseTimes.length > 0 ? Math.min(...responseTimes) : 0;
        const maxLatency = responseTimes.length > 0 ? Math.max(...responseTimes) : 0;

        // Latency percentiles
        const sortedTimes = [...responseTimes].sort((a, b) => a - b);
        const p50 = sortedTimes.length > 0 ? sortedTimes[Math.floor(sortedTimes.length * 0.5)] : 0;
        const p90 = sortedTimes.length > 0 ? sortedTimes[Math.floor(sortedTimes.length * 0.9)] : 0;
        const p95 = sortedTimes.length > 0 ? sortedTimes[Math.floor(sortedTimes.length * 0.95)] : 0;
        const p99 = sortedTimes.length > 0 ? sortedTimes[Math.floor(sortedTimes.length * 0.99)] : 0;

        // Status code distribution
        const statusCodes: Record<string, number> = {};
        const statusRanges: Record<string, number> = {
          '2xx': 0,
          '3xx': 0,
          '4xx': 0,
          '5xx': 0,
          'other': 0
        };

        logs.forEach(log => {
          const status = log.status.toString();
          statusCodes[status] = (statusCodes[status] || 0) + 1;

          if (log.status >= 200 && log.status < 300) statusRanges['2xx']++;
          else if (log.status >= 300 && log.status < 400) statusRanges['3xx']++;
          else if (log.status >= 400 && log.status < 500) statusRanges['4xx']++;
          else if (log.status >= 500) statusRanges['5xx']++;
          else statusRanges['other']++;
        });

        // Method distribution
        const methods: Record<string, number> = {};
        logs.forEach(log => {
          methods[log.method] = (methods[log.method] || 0) + 1;
        });

        // Throughput (requests per minute)
        const now = Date.now();
        const oneMinuteAgo = now - 60000;
        const fiveMinutesAgo = now - 300000;
        const fifteenMinutesAgo = now - 900000;

        const requestsLast1Min = logs.filter(l => new Date(l.timestamp).getTime() > oneMinuteAgo).length;
        const requestsLast5Min = logs.filter(l => new Date(l.timestamp).getTime() > fiveMinutesAgo).length;
        const requestsLast15Min = logs.filter(l => new Date(l.timestamp).getTime() > fifteenMinutesAgo).length;

        // Top endpoints
        const endpoints: Record<string, number> = {};
        logs.forEach(log => {
          try {
            const urlObj = new URL(log.url);
            endpoints[urlObj.pathname] = (endpoints[urlObj.pathname] || 0) + 1;
          } catch {
            endpoints[log.url] = (endpoints[log.url] || 0) + 1;
          }
        });

        const topEndpoints = Object.entries(endpoints)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([path, count]) => ({ path, count }));

        // Error rate
        const errorCount = logs.filter(l => l.status >= 400).length;
        const errorRate = totalRequests > 0 ? ((errorCount / totalRequests) * 100).toFixed(2) : '0';

        const httpStats = {
          totalRequests,
          latency: {
            avg: avgLatency,
            min: minLatency,
            max: maxLatency,
            p50,
            p90,
            p95,
            p99
          },
          statusCodes,
          statusRanges,
          methods,
          throughput: {
            last1Min: requestsLast1Min,
            last5Min: requestsLast5Min,
            last15Min: requestsLast15Min,
            rpm: requestsLast1Min // requests per minute
          },
          topEndpoints,
          errorRate: parseFloat(errorRate),
          errors: errorCount
        };

        logHttpRequest('GET', url, 200, Date.now() - startTime, ip, userAgent);
        return NextResponse.json(httpStats);
      }

      case "server-logs": {
        // Get list of log files
        if (searchParams.get("action") === "list") {
          const files = await getLogFiles();
          logHttpRequest('GET', url, 200, Date.now() - startTime, ip, userAgent);
          return NextResponse.json({ files });
        }

        // Get log file content
        if (filePath) {
          const limit = parseInt(searchParams.get("limit") || "500");
          const lines = await readLogFile(filePath, limit);
          logHttpRequest('GET', url, 200, Date.now() - startTime, ip, userAgent);
          return NextResponse.json({ lines, filePath });
        }

        // Default: return list of files
        const files = await getLogFiles();
        logHttpRequest('GET', url, 200, Date.now() - startTime, ip, userAgent);
        return NextResponse.json({ files });
      }

      case "recent-requests": {
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
        logHttpRequest('GET', url, 200, Date.now() - startTime, ip, userAgent);
        return NextResponse.json(recentRequests);
      }

      default: {
        // Get all stats
        const [apiStats, rateStats, alerts] = await Promise.all([
          getAPIStats(hours),
          getRateLimitStats(),
          getAnomalyAlerts(10, true)
        ]);

        logHttpRequest('GET', url, 200, Date.now() - startTime, ip, userAgent);
        return NextResponse.json({
          apiStats,
          rateLimitStats: rateStats,
          recentAlerts: alerts,
          marketStatus: {
            isOpen: false // This would be calculated from market-hours
          }
        });
      }
    }
  } catch (error) {
    logger.error({ msg: "Admin monitoring GET error", error });
    logHttpRequest('GET', url, 500, Date.now() - startTime, ip, userAgent);
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

export async function DELETE(req: Request) {
  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");
    const filePath = searchParams.get("filePath");

    // Delete log file
    if (type === "server-logs" && filePath) {
      const success = await deleteLogFile(filePath);
      if (success) {
        return NextResponse.json({ success: true, message: "Log file deleted" });
      }
      return NextResponse.json({ error: "Failed to delete log file" }, { status: 500 });
    }

    return NextResponse.json({ error: "Invalid delete request" }, { status: 400 });
  } catch (error) {
    logger.error({ msg: "Admin monitoring DELETE error", error });
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
