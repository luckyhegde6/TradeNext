// app/api/admin/recommendations/repair-failed-runs/route.ts
//
// v3.49.0 (Spec 29): one-shot corrective sweep for legacy failed runs that
// carried raw screener picks but were never AI-processed (prod 2026-10-11:
// run `347d6887…` / runDate 2026-09-04 — 100 forced HOLD rows shadowed good
// runs because the old read predicate selected `status in [completed, failed]
// AND uniqueStocks > 0`).
//
// The sweep zeroes ONLY the pivot `uniqueStocks` on
// `status failed + aiProcessed 0 + uniqueStocks > 0` runs (journal stocks kept
// for History/Performance by explicit runId). Idempotent: a second call is a
// 0 no-op. Audit `RECS_REPAIR_FAILED_RUNS` with the repaired count.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import logger from "@/lib/logger";
import { repairFailedRunsWithPicks } from "@/lib/services/dailyRecommendationService";
import { createAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

// POST /api/admin/recommendations/repair-failed-runs — zero the pick pivot on
// legacy failed/AI-zero runs (admin only, no body, safe to re-run).
export async function POST() {
  let session;
  try {
    session = await auth();
    if (!session?.user || (session.user as { role?: string }).role !== "admin") {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
  } catch (error) {
    logger.warn({
      msg: "Repair-failed-runs: auth check failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { repaired } = await repairFailedRunsWithPicks();
    void createAuditLog({
      userId: Number(session.user.id),
      userEmail: session.user.email,
      action: "RECS_REPAIR_FAILED_RUNS",
      resource: "recommendations",
      responseStatus: 200,
      metadata: { repaired },
    });
    return NextResponse.json({ success: true, repaired });
  } catch (error) {
    logger.error({
      msg: "Repair-failed-runs failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ success: false, error: "Repair sweep failed" }, { status: 500 });
  }
}