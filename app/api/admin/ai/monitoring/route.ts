import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAiCallsMerged, getAiStatsMerged, clearAiCalls, clearPersistedAiCalls } from "@/lib/services/ai/ai-monitoring";
import { getAiQuotaStatus, clearAiQuotaExhausted } from "@/lib/services/ai/quotaLatch";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/admin/ai/monitoring — AI call observability data
 *
 * Query params:
 *   type: "calls" | "stats" | "quota" (default: "stats")
 *   limit: number (default: 50, for "calls" type)
 *   timeframe: number (minutes, default: 60, for "stats" type)
 *
 * Reads merge the in-memory ring buffer with DB-persisted ServerLog records
 * (source="ai"). If the current process is cold (no memory
 * buffer), data is served from the database so logs survive refreshes.
 *
 * The `stats` response also carries `quota` — the per-UTC-day free-quota latch
 * (v3.51.0) — so the admin UI can show whether the AI is short-circuited today.
 *
 * DELETE /api/admin/ai/monitoring — Clear AI call buffer
 * POST   /api/admin/ai/monitoring — `{ action: "clear-quota" }` clears the latch
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

    if (type === "quota") {
      return NextResponse.json({ quota: getAiQuotaStatus() });
    }

    const stats = await getAiStatsMerged(timeframe);
    return NextResponse.json({ stats, quota: getAiQuotaStatus() });
  } catch (err) {
    logger.error({ msg: "AI monitoring API failed", error: err });
    return NextResponse.json({ error: "Failed to fetch AI monitoring data" }, { status: 500 });
  }
}

/** POST /api/admin/ai/monitoring — admin actions (currently: clear the quota latch). */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { action?: string };
    if (body?.action !== "clear-quota") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    clearAiQuotaExhausted();
    return NextResponse.json({ success: true, quota: getAiQuotaStatus() });
  } catch (err) {
    logger.error({ msg: "Failed to clear AI quota latch", error: err });
    return NextResponse.json({ error: "Failed to clear AI quota latch" }, { status: 500 });
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
