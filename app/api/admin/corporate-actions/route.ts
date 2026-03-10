// app/api/admin/corporate-actions/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { parse } from "csv-parse/sync";

export const runtime = "nodejs";

// POST: Admin upload via CSV or JSON
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.role || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const formData = await req.formData();
    const csvFile = formData.get("csv") as File;
    const manualData = formData.get("manual");

    let records: any[] = [];

    if (csvFile && csvFile.size > 0) {
      const csvText = await csvFile.text();
      records = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as any[];
    } else if (manualData) {
      const json = JSON.parse(manualData as string);
      records = Array.isArray(json) ? json : [json];
    } else {
      return NextResponse.json({ error: "No data provided" }, { status: 400 });
    }

    // Transform and validate each record
    const createdActions: any[] = [];
    for (const rec of records) {
      const action = await createCorporateAction(rec);
      createdActions.push(action);
    }

    logger.info({ msg: "Corporate actions uploaded", count: createdActions.length, admin: session.user.email });
    return NextResponse.json({ success: true, created: createdActions.length });
  } catch (e) {
    logger.error({ msg: "Failed to upload corporate actions", error: e });
    return NextResponse.json({ error: "Upload failed", details: e.message }, { status: 500 });
  }
}

// GET: List all corporate actions (admin view)
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.role || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const actions = await prisma.corporateAction.findMany({
      orderBy: { exDate: 'desc' },
      select: {
        id: true,
        symbol: true,
        companyName: true,
        series: true,
        subject: true,
        actionType: true,
        exDate: true,
        recordDate: true,
        faceValue: true,
        ratio: true,
        dividendPerShare: true,
        source: true,
        createdAt: true,
      },
    });

    return NextResponse.json(actions);
  } catch (e) {
    logger.error({ msg: "Failed to fetch corporate actions", error: e });
    return NextResponse.json({ error: "Failed to fetch corporate actions" }, { status: 500 });
  }
}

// DELETE: Bulk delete by IDs (comma-separated)
export async function DELETE(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.role || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const ids = searchParams.get("ids");
    if (!ids) return NextResponse.json({ error: "No IDs provided" }, { status: 400 });

    const idArr = ids.split(",").map(Number).filter(n => !isNaN(n));
    if (idArr.length === 0) return NextResponse.json({ error: "Invalid IDs" }, { status: 400 });

    const result = await prisma.corporateAction.deleteMany({
      where: { id: { in: idArr } }
    });

    logger.info({ msg: "Corporate actions deleted", count: result.count, admin: session.user.email });
    return NextResponse.json({ success: true, deleted: result.count });
  } catch (e) {
    logger.error({ msg: "Failed to delete corporate actions", error: e });
    return NextResponse.json({ error: "Delete failed", details: e.message }, { status: 500 });
  }
}

// Helper to create a single corporate action with type detection
async function createCorporateAction(rec: any): Promise<any> {
  // CSV columns from NSE: SYMBOL, COMPANY NAME, SERIES, PURPOSE, FACE VALUE, EX-DATE, RECORD DATE, BOOK CLOSURE START DATE, BOOK CLOSURE END DATE
  const symbol = rec.SYMBOL || rec.symbol;
  const companyName = rec['COMPANY NAME'] || rec.companyName;
  const series = rec.SERIES || rec.series || null;
  const purpose = rec.PURPOSE || rec.purpose || '';
  const faceValue = rec['FACE VALUE'] || rec.faceValue || null;
  const exDate = parseDate(rec['EX-DATE'] || rec.exDate);
  const recordDate = parseDate(rec['RECORD DATE'] || rec.recordDate);
  const bookClosureStart = parseDate(rec['BOOK CLOSURE START DATE'] || rec.bookClosureStartDate);
  const bookClosureEnd = parseDate(rec['BOOK CLOSURE END DATE'] || rec.bookClosureEndDate);

  // Parse purpose to determine actionType and extract numeric values
  const { actionType, dividendAmount, ratio } = parsePurpose(purpose);

  // Build the data object with all fields
  const data = {
    symbol,
    companyName,
    series,
    subject: purpose,
    actionType,
    exDate,
    recordDate,
    effectiveDate: exDate, // usually ex-date is effective
    faceValue,
    oldFV: null,
    newFV: null,
    ratio,
    dividendPerShare: dividendAmount || null,
    dividendYield: null,
    isin: rec.ISIN || rec.isin || null,
    bookClosureStartDate: bookClosureStart,
    bookClosureEndDate: bookClosureEnd,
    announcementDate: parseDate(rec['ANNOUNCEMENT DATE'] || rec.announcementDate),
    source: 'admin',
  };

  return await prisma.corporateAction.create({ data });
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr || dateStr === '-') return null;
  try {
    // Format: "09-Mar-2026"
    const [dd, mon, yr] = dateStr.split('-');
    const monthMap: Record<string, number> = {
      'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
      'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11
    };
    const month = monthMap[mon.toUpperCase()];
    if (month === undefined) return null;
    return new Date(parseInt(yr), month, parseInt(dd));
  } catch {
    return null;
  }
}

function parsePurpose(purpose: string): {
  actionType: string;
  dividendAmount?: number;
  ratio?: string;
} {
  const p = purpose.toLowerCase();
  let actionType = 'OTHER';
  let dividendAmount: number = undefined;
  let ratio: string = undefined;

  if (p.includes('dividend') || p.includes('interest payment')) {
    actionType = p.includes('interest') ? 'INTEREST' : 'DIVIDEND';
    const match = purpose.match(/Rs\s*([\d,.]+)\s*Per Share/i);
    if (match) dividendAmount = parseFloat(match[1].replace(/,/g, ''));
  } else if (p.includes('bonus')) {
    actionType = 'BONUS';
    const match = purpose.match(/bonus\s+(\d+:\d+)/i);
    if (match) ratio = match[1];
  } else if (p.includes('rights')) {
    actionType = 'RIGHTS';
    const ratioMatch = purpose.match(/rights\s+(\d+:\d+)/i);
    if (ratioMatch) ratio = ratioMatch[1];
  } else if (p.includes('split')) {
    actionType = 'SPLIT';
  } else if (p.includes('buyback')) {
    actionType = 'BUYBACK';
  }

  return { actionType, dividendAmount, ratio };
}
