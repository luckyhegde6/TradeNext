// app/api/cache/route.ts
import { NextResponse } from "next/server";
import { getCacheMetrics, cleanupExpiredKeys, clearAllCaches, hotCache, staticCache } from "@/lib/cache";
import logger from "@/lib/logger";

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  try {
    logger.info({ msg: 'Cache API request', action });

    if (action === "cleanup") {
      cleanupExpiredKeys();
      logger.info({ msg: 'Cache cleanup completed' });
      return NextResponse.json({ success: true, message: "Expired keys cleaned up" });
    }

    if (action === "clear-hot") {
      hotCache.flushAll();
      logger.info({ msg: 'Hot cache cleared' });
      return NextResponse.json({ success: true, message: "Hot cache cleared" });
    }

    if (action === "clear-static") {
      staticCache.flushAll();
      logger.info({ msg: 'Static cache cleared' });
      return NextResponse.json({ success: true, message: "Static cache cleared" });
    }

    if (action === "clear-all") {
      clearAllCaches();
      logger.info({ msg: 'All caches cleared' });
      return NextResponse.json({ success: true, message: "All caches cleared" });
    }

    if (action === "metrics") {
      const metrics = getCacheMetrics();
      const queueStats = { error: 'Queues disabled - Redis not configured' };
      const duration = Date.now() - startTime;
      logger.info({ msg: 'Cache metrics retrieved', duration });
      return NextResponse.json({ ...metrics, queues: queueStats });
    }

    // Default: return basic cache info
    const metrics = getCacheMetrics();
    const duration = Date.now() - startTime;
    logger.info({ msg: 'Cache info retrieved', duration });

    return NextResponse.json({
      status: "ok",
      meta: {
        fetchedAt: new Date().toISOString(),
        stale: false,
      },
      caches: {
        main: { keys: metrics.mainCache.keys },
        hot: { keys: metrics.hotCache.keys },
        static: { keys: metrics.staticCache.keys },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ msg: 'Cache API error', error: errorMessage, duration });
    return NextResponse.json({ error: "Cache operation failed" }, { status: 500 });
  }
}
