import { NextRequest, NextResponse } from "next/server";
import { getUpcomingIpoIssues } from "@/lib/services/nseIpoService";
import logger from "@/lib/logger";

export const runtime = "nodejs";

// GET /api/recommendations/ipos — Upcoming/current IPO issues from NSE
export async function GET(request: NextRequest) {
  const traceId = request.headers.get("x-trace-id") || "none";

  try {
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get("refresh") === "1";

    const result = await getUpcomingIpoIssues(forceRefresh);

    logger.info({
      msg: "NSE upcoming IPO issues fetched",
      count: result.data.length,
      source: result.source,
      changed: result.changed,
      traceId,
    });

    return NextResponse.json({
      success: true,
      issues: result.data,
      source: result.source,
      syncedAt: result.syncedAt ? result.syncedAt.toISOString() : null,
      changed: result.changed,
      timestamp: new Date().toISOString(),
      traceId,
    });
  } catch (error) {
    logger.error({
      msg: "Failed to fetch NSE upcoming IPO issues",
      error: error instanceof Error ? error.message : String(error),
      traceId,
    });
    return NextResponse.json(
      { success: false, issues: [], error: "Failed to fetch IPO issues" },
      { status: 500 }
    );
  }
}