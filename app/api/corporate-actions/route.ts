// app/api/corporate-actions/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    
    // Optional authentication: allow public view
    // const session = await auth();

    // Filters
    const actionType = url.searchParams.get("type");
    const symbol = url.searchParams.get("symbol");
    const fromDate = url.searchParams.get("fromDate");
    const toDate = url.searchParams.get("toDate");
    const source = url.searchParams.get("source");

    // Build where clause
    const where: any = {};

    if (actionType) {
      where.actionType = actionType;
    }
    if (symbol) {
      where.symbol = { contains: symbol.toUpperCase() };
    }
    if (source) {
      where.source = source;
    }

    // Date range (on exDate)
    if (fromDate || toDate) {
      where.exDate = {};
      if (fromDate) where.exDate.gte = new Date(fromDate);
      if (toDate) {
        const endDate = new Date(toDate);
        endDate.setHours(23, 59, 59, 999);
        where.exDate.lte = endDate;
      }
    }

    const actions = await prisma.corporateAction.findMany({
      where,
      orderBy: [
        { exDate: 'desc' },
        { createdAt: 'desc' }
      ],
      select: {
        id: true,
        symbol: true,
        companyName: true,
        series: true,
        subject: true,
        actionType: true,
        exDate: true,
        recordDate: true,
        effectiveDate: true,
        faceValue: true,
        oldFV: true,
        newFV: true,
        ratio: true,
        dividendPerShare: true,
        dividendYield: true,
        isin: true,
        bookClosureStartDate: true,
        bookClosureEndDate: true,
        announcementDate: true,
        source: true,
      },
    });

    // Format dates as ISO strings
    const formatted = actions.map(a => ({
      ...a,
      exDate: a.exDate?.toISOString(),
      recordDate: a.recordDate?.toISOString(),
      effectiveDate: a.effectiveDate?.toISOString(),
      bookClosureStartDate: a.bookClosureStartDate?.toISOString(),
      bookClosureEndDate: a.bookClosureEndDate?.toISOString(),
      announcementDate: a.announcementDate?.toISOString(),
    }));

    logger.info({ msg: 'Fetched corporate actions', count: formatted.length, filters: { actionType, symbol, source } });

    return NextResponse.json({ data: formatted });
  } catch (e) {
    logger.error({ msg: "Failed to fetch corporate actions", error: e });
    return NextResponse.json({ error: "Failed to fetch corporate actions" }, { status: 500 });
  }
}
