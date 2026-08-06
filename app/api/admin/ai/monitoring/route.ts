import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAiCallsMerged, getAiStatsMerged, clearAiCalls, clearPersistedAiCalls } from "@/lib/services/ai/ai-monitoring";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/admin/ai/monitoring — AI call observability data
 *
 * Query params:
 *   type: "calls" | "stats" (default: "stats")
 *   limit: number (default: 50, for "calls" type)
 *   timeframe: number (minutes, default: 60, for "stats" type)
 *
 * Reads merge the in-memory ring buffer with DB-persisted ServerLog records
 * (source="ai"). If the current serverless instance is cold (no memory
 * buffer), data is served from the database so logs survive refreshes.
 *
 * DELETE /api/admin/ai/monitoring — Clear AI call buffer
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "stats";
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10) || 50, 500);
    const timeframe = Math.min(parseInt(searchParams.get("timeframe") || "60", 10) || 60, 1440);

    if (type === "calls") {
      const { calls, source } = await getAiCallsMerged(limit, timeframe);
      return NextResponse.json({ calls, total: calls.length, source });
    }

    const stats = await getAiStatsMerged(timeframe);
    return NextResponse.json({ stats });
  } catch (err) {
    logger.error({ msg: "AI monitoring API failed", error: err });
    return NextResponse.json({ error: "Failed to fetch AI monitoring data" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    clearAiCalls();
    const deleted = await clearPersistedAiCalls();
    return NextResponse.json({
      success: true,
      message: "AI call buffer cleared",
      deletedDbLogs: deleted,
    });
  } catch (err) {
    logger.error({ msg: "Failed to clear AI monitoring data", error: err });
    return NextResponse.json({ error: "Failed to clear AI monitoring data" }, { status: 500 });
  }
}
