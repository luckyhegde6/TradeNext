import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDecisionStats, getDecisionTraces, clearDecisionTraces } from "@/lib/services/decision/monitoring";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/admin/decision/monitoring — Decision Engine observability data
 *
 * Query params:
 *   type: "stats" | "traces" (default: "stats")
 *   timeframe: number (minutes, default: 60, for "stats" type)
 *   limit: number (default: 50, max 500, for "traces" type)
 *
 * Reads the in-memory decision-engine trace ring buffer (spec 17). Traces
 * are process-local by design — the engine is a Laya-only mock until P1–P6,
 * so observability is deliberately cheap and zero-Prisma.
 *
 * DELETE /api/admin/decision/monitoring — Clear Decision Engine trace buffer
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "stats";
    const timeframe = Math.min(parseInt(searchParams.get("timeframe") || "60", 10) || 60, 1440);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10) || 50, 500);

    if (type === "traces") {
      const traces = getDecisionTraces(limit);
      return NextResponse.json({ traces, total: traces.length });
    }

    const stats = getDecisionStats(timeframe);
    return NextResponse.json({ stats });
  } catch (err) {
    logger.error({ msg: "Decision monitoring API failed", error: err });
    return NextResponse.json({ error: "Failed to fetch decision monitoring data" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    clearDecisionTraces();
    return NextResponse.json({
      success: true,
      message: "Decision Engine trace buffer cleared",
    });
  } catch (err) {
    logger.error({ msg: "Failed to clear decision monitoring data", error: err });
    return NextResponse.json({ error: "Failed to clear decision monitoring data" }, { status: 500 });
  }
}