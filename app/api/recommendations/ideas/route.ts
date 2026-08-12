import { NextRequest, NextResponse } from "next/server";
import { getNseTradingIdeas } from "@/lib/services/tradingviewIdeasService";
import logger from "@/lib/logger";

export const runtime = "nodejs";

// GET /api/recommendations/ideas — Community trading ideas (NSE) from TradingView
export async function GET(request: NextRequest) {
  const traceId = request.headers.get("x-trace-id") || "none";

  try {
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get("refresh") === "1";

    const result = await getNseTradingIdeas(forceRefresh);

    logger.info({
      msg: "TradingView NSE ideas fetched",
      count: result.data.length,
      source: result.source,
      changed: result.changed,
      traceId,
    });

    return NextResponse.json({
      success: true,
      ideas: result.data,
      source: result.source,
      syncedAt: result.syncedAt ? result.syncedAt.toISOString() : null,
      changed: result.changed,
      timestamp: new Date().toISOString(),
      traceId,
    });
  } catch (error) {
    logger.error({
      msg: "Failed to fetch TradingView NSE ideas",
      error: error instanceof Error ? error.message : String(error),
      traceId,
    });
    return NextResponse.json(
      { success: false, ideas: [], error: "Failed to fetch ideas" },
      { status: 500 }
    );
  }
}