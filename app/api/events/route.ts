import { NextRequest, NextResponse } from "next/server";
import { getNseEvents } from "@/lib/services/nseEventsService";
import { createAuditLog } from "@/lib/audit";
import logger from "@/lib/logger";

export const runtime = "nodejs";

// GET /api/events — NSE events / notifications feed (listing ceremonies etc.)
export async function GET(request: NextRequest) {
  const traceId = request.headers.get("x-trace-id") || "none";

  try {
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get("refresh") === "1";

    const result = await getNseEvents(forceRefresh);

    logger.info({
      msg: "NSE events fetched",
      count: result.data.length,
      source: result.source,
      changed: result.changed,
      traceId,
    });

    return NextResponse.json({
      success: true,
      events: result.data,
      source: result.source,
      syncedAt: result.syncedAt ? result.syncedAt.toISOString() : null,
      changed: result.changed,
      timestamp: new Date().toISOString(),
      traceId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({
      msg: "Failed to fetch NSE events",
      error: message,
      traceId,
    });
    createAuditLog({
      action: "EVENTS_FETCH_FAILED",
      resource: "nse_events",
      path: "/api/events",
      responseStatus: 500,
      errorMessage: message,
    }).catch(() => undefined);
    return NextResponse.json(
      { success: false, events: [], error: "Failed to fetch NSE events" },
      { status: 500 }
    );
  }
}