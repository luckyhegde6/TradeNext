import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { archiveRecommendations } from "@/lib/services/recommendationPerformanceService";
import logger from "@/lib/logger";

export const runtime = "nodejs";

// POST /api/admin/recommendations/archive — Run the 360-day archival sweep
// Manual trigger for admins; the same sweep also runs inside the 4 PM
// performance-check worker. Idempotent and bounded — safe to re-run.
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
    }

    logger.info({ msg: "Admin triggered recommendation archival sweep" });
    const result = await archiveRecommendations();

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    logger.error({
      msg: "Recommendation archival sweep failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: "Archival sweep failed" },
      { status: 500 }
    );
  }
}
