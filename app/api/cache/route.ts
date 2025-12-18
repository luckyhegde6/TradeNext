// app/api/cache/route.ts
import { NextResponse } from "next/server";
import { getCacheMetrics, cleanupExpiredKeys } from "@/lib/cache";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  try {
    if (action === "cleanup") {
      cleanupExpiredKeys();
      return NextResponse.json({ success: true, message: "Expired keys cleaned up" });
    }

    if (action === "metrics") {
      const metrics = getCacheMetrics();
      return NextResponse.json(metrics);
    }

    // Default: return basic cache info
    const metrics = getCacheMetrics();
    return NextResponse.json({
      status: "ok",
      caches: {
        main: { keys: metrics.mainCache.keys },
        hot: { keys: metrics.hotCache.keys },
        static: { keys: metrics.staticCache.keys },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Cache API error:", error);
    return NextResponse.json({ error: "Cache operation failed" }, { status: 500 });
  }
}
