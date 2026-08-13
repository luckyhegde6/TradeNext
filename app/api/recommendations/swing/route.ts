import { NextRequest, NextResponse } from "next/server";
import { getSwingRecommendations } from "@/lib/services/swingRecommendationService";
import logger from "@/lib/logger";

export const runtime = "nodejs";

// GET /api/recommendations/swing — Swing-tab feed (public, no auth)
//
// Query params:
//   force=1   bypass the 30-min cache and re-scan + re-analyze
//   analyze=0 skip the AI target analysis (screener-only feed)
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const forceRefresh = url.searchParams.get("force") === "1";
  const analyze = url.searchParams.get("analyze") !== "0";

  try {
    logger.info({ msg: "Fetching swing recommendations", forceRefresh, analyze });
    const data = await getSwingRecommendations({ forceRefresh, analyze });
    return NextResponse.json(data);
  } catch (error) {
    logger.error({
      msg: "Failed to fetch swing recommendations",
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { success: false, error: "Failed to fetch swing recommendations" },
      { status: 500 },
    );
  }
}
