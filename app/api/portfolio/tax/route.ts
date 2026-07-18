import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import logger from "@/lib/logger";
import { getUserTaxReport } from "@/lib/services/taxService";
import { getFinancialYears, getFYDateRange } from "@/lib/services/taxCalculator";

export const runtime = "nodejs";

/**
 * GET /api/portfolio/tax?fy=2025-26
 *
 * Returns capital gains report for the authenticated user.
 * Query params:
 *   fy  (string) — Financial year (e.g., "2025-26"), defaults to current FY
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id as string, 10);
    const { searchParams } = new URL(req.url);
    const fy = searchParams.get("fy") || getFinancialYears()[0];

    // Validate FY format
    if (!/^\d{4}-\d{2}$/.test(fy)) {
      return NextResponse.json({ error: "Invalid financial year format. Use YYYY-YY (e.g., 2025-26)" }, { status: 400 });
    }

    const report = await getUserTaxReport(userId, fy);
    return NextResponse.json(report);
  } catch (error) {
    logger.error({ msg: "Failed to fetch tax report", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to fetch tax report" }, { status: 500 });
  }
}
