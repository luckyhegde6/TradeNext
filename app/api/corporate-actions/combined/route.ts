// app/api/corporate-actions/combined/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { nseFetch } from "@/lib/nse-client";
import logger from "@/lib/logger";

function parseNseDate(dateStr: string): string | null {
  if (!dateStr || dateStr === "-") return null;
  try {
    const [dd, mon, yr] = dateStr.split('-');
    const monthMap: Record<string, number> = {
      'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
      'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11
    };
    const month = monthMap[mon.toUpperCase()];
    if (month === undefined) return null;
    const date = new Date(parseInt(yr), month, parseInt(dd));
    return isNaN(date.getTime()) ? null : date.toISOString();
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
  let dividendAmount: number | undefined = undefined;
  let ratio: string | undefined = undefined;

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
  } else if (p.includes('split') || p.includes('face value split')) {
    actionType = 'SPLIT';
  } else if (p.includes('buyback')) {
    actionType = 'BUYBACK';
  } else if (p.includes('demerger')) {
    actionType = 'DEMERGER';
  } else if (p.includes('redemption')) {
    actionType = 'REDEMPTION';
  } else if (p.includes('distribution')) {
    actionType = 'DISTRIBUTION';
  }

  return { actionType, dividendAmount, ratio };
}

// Parse full corporate action from NSE response item
function parseCorporateActionFromNse(item: any): any | null {
  const parsed = parsePurpose(item.PURPOSE || item.purpose || '');
  const exDate = parseNseDate(item['EX-DATE'] || item.exDate || "");
  if (!exDate) return null; // require exDate

  const dividendAmount = parsed.dividendAmount || null;
  
  // Compute dividend yield if we have dividend and face value info
  let dividendYield: number | null = null;
  if (dividendAmount && item['FACE VALUE']) {
    const faceValue = parseFloat(item['FACE VALUE'].replace(/,/g, ''));
    if (faceValue > 0) {
      dividendYield = (dividendAmount / faceValue) * 100;
    }
  }

  return {
    symbol: item.SYMBOL || item.symbol || "",
    companyName: item['COMPANY NAME'] || item.companyName || "",
    series: item.SERIES || item.series || null,
    subject: item.PURPOSE || item.purpose || "",
    actionType: parsed.actionType,
    exDate: exDate,
    recordDate: parseNseDate(item['RECORD DATE'] || item.recordDate || ""),
    faceValue: item['FACE VALUE'] || item.faceValue || null,
    ratio: parsed.ratio,
    dividendPerShare: dividendAmount,
    dividendYield: dividendYield,
    source: 'nse',
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sourceParam = url.searchParams.get("source") || "all";
    const actionType = url.searchParams.get("type");
    const symbol = url.searchParams.get("symbol");
    const fromDate = url.searchParams.get("fromDate");
    const toDate = url.searchParams.get("toDate");
    const pageParam = url.searchParams.get("page");
    const limitParam = url.searchParams.get("limit");
    const page = pageParam ? parseInt(pageParam, 10) : undefined;
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    const includeAdmin = sourceParam === "all" || sourceParam === "admin";
    const includeNse = sourceParam === "all" || sourceParam === "nse";

    // Strategy: Always query DB first (which includes both admin uploaded and previously synced NSE data)
    // If DB is empty or filters require fresh data, sync from NSE in background and return cached/DB data
    let allActions: any[] = [];

    // Build base where clause for DB query
    const buildDbWhere = (sourceFilter?: string) => {
      const where: any = {};
      if (actionType) where.actionType = actionType;
      if (symbol) where.symbol = { contains: symbol.toUpperCase() };
      if (fromDate || toDate) {
        where.exDate = {};
        if (fromDate) where.exDate.gte = new Date(fromDate);
        if (toDate) {
          const endDate = new Date(toDate);
          endDate.setHours(23, 59, 59, 999);
          where.exDate.lte = endDate;
        }
      }
      if (sourceFilter) where.source = sourceFilter;
      return where;
    };

    // Fetch from DB (admin + previously synced NSE)
    const dbWhere = buildDbWhere(sourceParam === "all" ? undefined : sourceParam);
    const dbActions = await prisma.corporateAction.findMany({
      where: dbWhere,
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

    // If we have sufficient DB data, return it (cached response)
    if (dbActions.length > 0) {
      const formattedDb = dbActions.map(a => ({
        ...a,
        exDate: a.exDate?.toISOString(),
        recordDate: a.recordDate?.toISOString(),
        effectiveDate: a.effectiveDate?.toISOString(),
        bookClosureStartDate: a.bookClosureStartDate?.toISOString(),
        bookClosureEndDate: a.bookClosureEndDate?.toISOString(),
        announcementDate: a.announcementDate?.toISOString(),
      }));
      
      // Apply pagination if requested
      if (page !== undefined && limit !== undefined) {
        const total = formattedDb.length;
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;
        const paginated = formattedDb.slice(offset, offset + limit);
        
        return NextResponse.json({ 
          data: paginated, 
          total, 
          page, 
          totalPages, 
          limit,
          source: 'db'
        });
      }

      return NextResponse.json({ data: formattedDb, source: 'db' });
    }

    // DB empty or no matching records - Fetch from NSE, populate DB, and return
    if (includeNse) {
      try {
        const nseData = await nseFetch("/api/corporates-corporateActions?index=equities") as any[];
        if (Array.isArray(nseData)) {
          const parsedNse = nseData
            .map(item => parseCorporateActionFromNse(item))
            .filter(Boolean);

          // Bulk insert into DB for caching (ignore duplicates via onConflict)
          if (parsedNse.length > 0) {
            // Use raw SQL upsert to avoid duplicate key errors (assuming unique constraint on symbol+actionType+exDate)
            // For simplicity, we'll insert many and ignore errors
            try {
              await prisma.$executeRaw`
                INSERT INTO "CorporateAction" (symbol, "companyName", series, subject, "actionType", "exDate", "recordDate", "effectiveDate", "faceValue", ratio, "dividendPerShare", "dividendYield", source, "createdAt", "updatedAt")
                SELECT 
                  s.symbol,
                  s."companyName",
                  s.series,
                  s.subject,
                  s."actionType",
                  s."exDate"::timestamptz,
                  s."recordDate"::timestamptz,
                  s."effectiveDate"::timestamptz,
                  s."faceValue",
                  s.ratio,
                  s."dividendPerShare",
                  s."dividendYield",
                  s.source,
                  NOW(),
                  NOW()
                FROM (VALUES ${prisma.join(
                  parsedNse.map((a: any) => [
                    a.symbol,
                    a.companyName,
                    a.series || null,
                    a.subject,
                    a.actionType,
                    a.exDate,
                    a.recordDate || null,
                    null, // effectiveDate
                    a.faceValue || null,
                    a.ratio || null,
                    a.dividendPerShare || null,
                    a.dividendYield || null,
                    a.source,
                  ]),
                  (tx: any) => [
                    tx.String, // symbol
                    tx.String, // companyName
                    tx.String, // series
                    tx.String, // subject
                    tx.String, // actionType
                    tx.DateTime, // exDate
                    tx.DateTime, // recordDate
                    tx.DateTime, // effectiveDate
                    tx.String, // faceValue
                    tx.String, // ratio
                    tx.Float, // dividendPerShare
                    tx.Float, // dividendYield
                    tx.String, // source
                  ]
                )}) AS s(symbol, "companyName", series, subject, "actionType", "exDate", "recordDate", "effectiveDate", "faceValue", ratio, "dividendPerShare", "dividendYield", source)
                ON CONFLICT (symbol, "actionType", "exDate") DO UPDATE SET
                  "companyName" = EXCLUDED."companyName",
                  series = EXCLUDED.series,
                  subject = EXCLUDED.subject,
                  "recordDate" = EXCLUDED."recordDate",
                  "faceValue" = EXCLUDED."faceValue",
                  ratio = EXCLUDED.ratio,
                  "dividendPerShare" = EXCLUDED."dividendPerShare",
                  "dividendYield" = EXCLUDED."dividendYield",
                  source = EXCLUDED.source,
                  "updatedAt" = NOW();
              `;
            } catch (dbErr) {
              logger.warn({ msg: "Failed to bulk insert NSE corporate actions", error: dbErr });
              // Continue anyway - we can still return the NSE data directly
            }
          }

          // Re-query DB to get the freshly synced data (with our filters applied again)
          const syncedDb = await prisma.corporateAction.findMany({
            where: buildDbWhere(sourceParam === "all" ? undefined : sourceParam),
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

          const formattedSynced = syncedDb.map(a => ({
            ...a,
            exDate: a.exDate?.toISOString(),
            recordDate: a.recordDate?.toISOString(),
            effectiveDate: a.effectiveDate?.toISOString(),
            bookClosureStartDate: a.bookClosureStartDate?.toISOString(),
            bookClosureEndDate: a.bookClosureEndDate?.toISOString(),
            announcementDate: a.announcementDate?.toISOString(),
          }));

          // Pagination
          if (page !== undefined && limit !== undefined) {
            const total = formattedSynced.length;
            const totalPages = Math.ceil(total / limit);
            const offset = (page - 1) * limit;
            const paginated = formattedSynced.slice(offset, offset + limit);
            
            return NextResponse.json({ 
              data: paginated, 
              total, 
              page, 
              totalPages, 
              limit,
              source: 'db-synced'
            });
          }

          return NextResponse.json({ data: formattedSynced, source: 'db-synced' });
        }
      } catch (nseErr) {
        logger.warn({ msg: "Failed to fetch NSE corporate actions for hydration", error: nseErr });
      }
    }

    // If we reach here, NSE sync failed or not allowed
    return NextResponse.json({ 
      data: [], 
      message: "No corporate actions available. Use admin upload to populate." 
    });

  } catch (e) {
    logger.error({ msg: "Failed to fetch combined corporate actions", error: e });
    return NextResponse.json({ error: "Failed to fetch corporate actions" }, { status: 500 });
  }
}
