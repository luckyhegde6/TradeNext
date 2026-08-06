import { NextResponse } from "next/server";
import { queryEvents, getEventStats, detectAnomalies } from "@/lib/services/unifiedEventService";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";

// GET /api/system/events — Query unified events
export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const eventType = searchParams.get("eventType") as any;
    const eventSubtype = searchParams.get("eventSubtype") || undefined;
    const source = searchParams.get("source") || undefined;
    const severity = searchParams.get("severity") as any;
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
    const offset = parseInt(searchParams.get("offset") || "0");
    const startDate = searchParams.get("startDate") ? new Date(searchParams.get("startDate")!) : undefined;
    const endDate = searchParams.get("endDate") ? new Date(searchParams.get("endDate")!) : undefined;

    const { events, total } = await queryEvents({
      eventType, eventSubtype, source, severity, startDate, endDate, limit, offset,
    });

    return NextResponse.json({
      success: true,
      events,
      total,
      limit,
      offset,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: "Failed to query events" }, { status: 500 });
  }
}
