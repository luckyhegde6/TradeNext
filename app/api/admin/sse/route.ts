import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import logger from "@/lib/logger";
import { priceEventBus } from "@/lib/services/priceSyncService";

export const runtime = "nodejs";

/**
 * GET /api/admin/sse
 *
 * Returns SSE system stats and configuration.
 * Admin-only endpoint.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const stats = priceEventBus.getStats();

    return NextResponse.json({
      ...stats,
      trackedSymbols: priceEventBus.getTrackedSymbols(),
      pollIntervalSeconds: stats.pollInterval / 1000,
      uptimeSeconds: Math.floor(stats.uptime / 1000),
    });
  } catch (error) {
    logger.error({ msg: "Failed to fetch SSE stats", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to fetch SSE stats" }, { status: 500 });
  }
}

/**
 * POST /api/admin/sse
 *
 * Action: restart — restarts the price sync service
 * Body: { action: "restart" }
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();

    if (body.action === "restart") {
      priceEventBus.stop();
      priceEventBus.start();
      logger.info({ msg: "SSE price sync service restarted by admin" });
      return NextResponse.json({ success: true, message: "Price sync service restarted" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    logger.error({ msg: "Failed to process SSE admin action", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to process action" }, { status: 500 });
  }
}
