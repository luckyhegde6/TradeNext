import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { getAllUsersTaxOverview } from "@/lib/services/taxService";
import { getFinancialYears } from "@/lib/services/taxCalculator";

export const runtime = "nodejs";

/**
 * GET /api/admin/tax?fy=2025-26
 *
 * Admin view: aggregate tax overview for all users.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const fy = searchParams.get("fy") || getFinancialYears()[0];

    const overview = await getAllUsersTaxOverview(fy);
    const financialYears = getFinancialYears();

    return NextResponse.json({
      ...overview,
      fy,
      financialYears,
    });
  } catch (error) {
    logger.error({ msg: "Failed to fetch admin tax overview", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to fetch admin tax overview" }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/tax
 *
 * Update tax configuration.
 * Body: { stcgRate?: number, ltcgRate?: number, ltcgExemption?: number }
 */
export async function PATCH(req: Request) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const config: Record<string, number> = {};

    if (body.stcgRate !== undefined) {
      const rate = parseFloat(body.stcgRate);
      if (rate < 0 || rate > 1) return NextResponse.json({ error: "stcgRate must be between 0 and 1" }, { status: 400 });
      config.stcgRate = rate;
    }
    if (body.ltcgRate !== undefined) {
      const rate = parseFloat(body.ltcgRate);
      if (rate < 0 || rate > 1) return NextResponse.json({ error: "ltcgRate must be between 0 and 1" }, { status: 400 });
      config.ltcgRate = rate;
    }
    if (body.ltcgExemption !== undefined) {
      const exemption = parseFloat(body.ltcgExemption);
      if (exemption < 0) return NextResponse.json({ error: "ltcgExemption must be >= 0" }, { status: 400 });
      config.ltcgExemption = exemption;
    }

    // Store config in DB (use a generic key-value or settings table)
    // For now, log and return success
    logger.info({ msg: "Admin updated tax config", config });

    return NextResponse.json({ success: true, config });
  } catch (error) {
    logger.error({ msg: "Failed to update tax config", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to update tax config" }, { status: 500 });
  }
}
