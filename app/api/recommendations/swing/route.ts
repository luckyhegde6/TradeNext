// HOT ROUTE (Plan 09 Phase 8): cached swing feed + async AI analysis.
// Breaker-open: serves the screener-only feed and makes no Prisma writes.
import { NextRequest, NextResponse } from "next/server";
import { getSwingRecommendations } from "@/lib/services/swingRecommendationService";
import { autoTriggerOnce } from "@/lib/services/swingAutoSeedService";
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
    // Plan 15: swing AI auto-generate-once (seed-once). Fire-and-forget —
    // autoTriggerOnce internally probes stored targets + the process seed-once
    // guard, so a plain poll with stored targets is an audited NO-OP here and
    // a first empty-state/watchlist-add trigger runs ONE bounded generate.
    // Never awaited on the hot path (serve-first preserved).
    autoTriggerOnce({ trigger: "empty-state" }).catch(() => undefined);
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
