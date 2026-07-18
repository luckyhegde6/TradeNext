import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/admin/dividends
 *
 * Returns admin dividend overview stats and data.
 * Query params:
 *   page     (number) — Page number, default 1
 *   limit    (number) — Items per page, default 50
 *   year     (number) — Filter by year
 *   search   (string) — Search by symbol or company
 *   missingPrice (string) — "true" to filter dividends with no price data
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));
    const year = searchParams.get("year");
    const search = searchParams.get("search");
    const missingPrice = searchParams.get("missingPrice") === "true";

    // Build where clause
    const where: any = { actionType: "DIVIDEND" };

    if (year) {
      const y = parseInt(year, 10);
      if (!isNaN(y)) {
        where.exDate = {
          gte: new Date(Date.UTC(y, 0, 1)),
          lte: new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999)),
        };
      }
    }

    if (search) {
      where.OR = [
        { symbol: { contains: search, mode: "insensitive" } },
        { companyName: { contains: search, mode: "insensitive" } },
      ];
    }

    const [total, dividends] = await Promise.all([
      prisma.corporateAction.count({ where }),
      prisma.corporateAction.findMany({
        where,
        orderBy: { exDate: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          symbol: true,
          companyName: true,
          exDate: true,
          recordDate: true,
          dividendPerShare: true,
          dividendYield: true,
          faceValue: true,
          source: true,
          isin: true,
        },
      }),
    ]);

    // Get total dividend count and stats
    const stats = await prisma.corporateAction.groupBy({
      by: ["actionType"],
      where: { actionType: "DIVIDEND" },
      _count: true,
    });

    // Get latest sync info
    const latestRecord = await prisma.corporateAction.findFirst({
      where: { actionType: "DIVIDEND", source: "nse" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, source: true },
    });

    const formatted = dividends.map((d) => ({
      id: d.id,
      symbol: d.symbol,
      companyName: d.companyName,
      exDate: d.exDate?.toISOString() ?? null,
      recordDate: d.recordDate?.toISOString() ?? null,
      dividendPerShare: d.dividendPerShare ? Number(d.dividendPerShare) : null,
      dividendYield: d.dividendYield ? Number(d.dividendYield) : null,
      faceValue: d.faceValue,
      source: d.source,
      isin: d.isin,
    }));

    return NextResponse.json({
      data: formatted,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      stats: {
        totalDividends: stats[0]?._count ?? 0,
        missingPrice: 0, // computed client-side or in a follow-up query
      },
      lastSyncAt: latestRecord?.createdAt.toISOString() ?? null,
    });
  } catch (error) {
    logger.error({ msg: "Failed to fetch admin dividend data", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to fetch dividend data" }, { status: 500 });
  }
}

/**
 * POST /api/admin/dividends
 *
 * Manually create a dividend record.
 * Body: { symbol, companyName, dividendPerShare, exDate, recordDate, faceValue, type (Interim/Final) }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { symbol, companyName, dividendPerShare, exDate, recordDate, faceValue, type } = body;

    if (!symbol || !dividendPerShare || !exDate) {
      return NextResponse.json({ error: "Missing required fields: symbol, dividendPerShare, exDate" }, { status: 400 });
    }

    const subject = type === "Final" ? `Final Dividend - Rs ${dividendPerShare} Per Share` : `Interim Dividend - Rs ${dividendPerShare} Per Share`;

    const record = await prisma.corporateAction.create({
      data: {
        symbol: symbol.toUpperCase(),
        companyName: companyName || symbol.toUpperCase(),
        series: "EQ",
        subject,
        actionType: "DIVIDEND",
        exDate: new Date(exDate),
        recordDate: recordDate ? new Date(recordDate) : null,
        dividendPerShare: parseFloat(dividendPerShare),
        faceValue: faceValue || null,
        source: "admin",
      },
    });

    logger.info({ msg: "Admin created dividend record", symbol, dividendPerShare, exDate });

    return NextResponse.json({
      success: true,
      id: record.id,
      message: `Dividend for ${symbol} created successfully`,
    });
  } catch (error) {
    logger.error({ msg: "Failed to create dividend record", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to create dividend record" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/dividends
 *
 * Query params: id (number) — Delete a specific dividend record
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = parseInt(searchParams.get("id") || "", 10);

    if (!id || isNaN(id)) {
      return NextResponse.json({ error: "Missing valid id parameter" }, { status: 400 });
    }

    await prisma.corporateAction.delete({ where: { id } });

    logger.info({ msg: "Admin deleted dividend record", id });

    return NextResponse.json({ success: true, message: "Dividend record deleted" });
  } catch (error) {
    logger.error({ msg: "Failed to delete dividend record", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to delete dividend record" }, { status: 500 });
  }
}
