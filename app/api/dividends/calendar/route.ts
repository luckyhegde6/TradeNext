import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { getDividendCalendar, getMonthlyIncomeProjection, getUpcomingDividends } from "@/lib/services/dividendCalendarService";

export const runtime = "nodejs";

/**
 * GET /api/dividends/calendar
 *
 * Query params:
 *   month (number)  — Month (1-12), defaults to current month
 *   year  (number)  — Year, defaults to current year
 *   view  (string)  — "calendar" (default), "list", "income", or "upcoming"
 *
 * Returns dividend calendar data with summary and monthly income projection.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id ? parseInt(session.user.id as string, 10) : undefined;

    const { searchParams } = new URL(req.url);
    const now = new Date();
    const month = parseInt(searchParams.get("month") || String(now.getMonth() + 1), 10);
    const year = parseInt(searchParams.get("year") || String(now.getFullYear()), 10);
    const view = searchParams.get("view") || "calendar";

    if (view === "income") {
      const income = await getMonthlyIncomeProjection(userId);
      return NextResponse.json({ income, month, year });
    }

    if (view === "upcoming") {
      const dividends = await getUpcomingDividends(100, userId);
      const summary = await getDividendCalendar(month, year, userId);
      return NextResponse.json({
        dividends,
        summary: summary.summary,
        month,
        year,
      });
    }

    if (month < 1 || month > 12) {
      return NextResponse.json({ error: "Invalid month. Must be 1-12." }, { status: 400 });
    }

    const data = await getDividendCalendar(month, year, userId);
    return NextResponse.json(data);
  } catch (error) {
    logger.error({ msg: "Failed to fetch dividend calendar", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to fetch dividend calendar" }, { status: 500 });
  }
}
