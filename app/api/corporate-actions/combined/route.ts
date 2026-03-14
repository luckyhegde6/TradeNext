import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { nseFetch } from "@/lib/nse-client";
import { getOrFetchNseData, forceRefreshCache, type DataType } from "@/lib/market-cache";

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

function parseCorporateActionFromNse(item: any): any | null {
  const parsed = parsePurpose(item.PURPOSE || item.purpose || '');
  const exDate = parseNseDate(item['EX-DATE'] || item.exDate || "");
  if (!exDate) return null;

  const dividendAmount = parsed.dividendAmount || null;
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

/**
 * Fetch corporate actions from NSE
 */
async function fetchCorporateActionsFromNse(): Promise<any[]> {
  const data = await nseFetch("https://www.nseindia.com/api/corporates-corporateActions?index=equities") as any;
  const actions = Array.isArray(data) ? data : (data?.data || []);
  return actions.map(parseCorporateActionFromNse).filter(Boolean);
}

/**
 * Hydrate corporate actions to database with deduplication
 */
async function hydrateCorporateActionsToDb(actions: any[]): Promise<number> {
  let hydrated = 0;
  
  for (const action of actions) {
    if (!action.symbol || !action.exDate) continue;
    
    try {
      await prisma.corporateAction.upsert({
        where: {
          symbol_exDate: {
            symbol: action.symbol,
            exDate: new Date(action.exDate)
          }
        },
        create: {
          symbol: action.symbol,
          companyName: action.companyName || "",
          series: action.series,
          subject: action.subject || "",
          actionType: action.actionType || "OTHER",
          exDate: new Date(action.exDate),
          recordDate: action.recordDate ? new Date(action.recordDate) : null,
          faceValue: action.faceValue,
          ratio: action.ratio,
          dividendPerShare: action.dividendAmount,
          dividendYield: action.dividendYield,
          source: 'nse'
        },
        update: {
          companyName: action.companyName || "",
          series: action.series,
          subject: action.subject || "",
          actionType: action.actionType || "OTHER",
          recordDate: action.recordDate ? new Date(action.recordDate) : null,
          faceValue: action.faceValue,
          ratio: action.ratio,
          dividendPerShare: action.dividendAmount,
          dividendYield: action.dividendYield,
          source: 'nse'
        }
      });
      hydrated++;
    } catch (err) {
      logger.warn({ msg: "CorporateAction upsert error", symbol: action.symbol, error: err });
    }
  }
  
  return hydrated;
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
    const forceRefresh = url.searchParams.get("forceRefresh") === "true";
    const page = pageParam ? parseInt(pageParam, 10) : undefined;
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    // Check if we should force refresh
    let cacheResult;
    const dataType: DataType = "corporate_actions";
    
    if (forceRefresh) {
      logger.info({ msg: "CorporateActions: Force refresh requested" });
      cacheResult = await forceRefreshCache(
        fetchCorporateActionsFromNse,
        dataType
      );
    } else {
      // Use smart caching - fetch from NSE only if needed
      cacheResult = await getOrFetchNseData(
        fetchCorporateActionsFromNse,
        {
          dataType,
          ttlSecondsOpen: 300,   // 5 minutes when market is open
          ttlSecondsClosed: 3600 // 1 hour when market is closed
        }
      );
    }
    
    // Hydrate to database in background (fire and forget)
    if (cacheResult.source === "nse") {
      hydrateCorporateActionsToDb(cacheResult.data as any[]).then(count => {
        logger.info({ msg: "CorporateActions: Hydrated to DB", count });
      }).catch(err => {
        logger.error({ msg: "CorporateActions: DB hydration error", error: err });
      });
    }

    // Build where clause for DB query
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

    // Always serve from DB for queryable results
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

    const formatted = actions.map(a => ({
      ...a,
      exDate: a.exDate?.toISOString(),
      recordDate: a.recordDate?.toISOString(),
      effectiveDate: a.effectiveDate?.toISOString(),
      bookClosureStartDate: a.bookClosureStartDate?.toISOString(),
      bookClosureEndDate: a.bookClosureEndDate?.toISOString(),
      announcementDate: a.announcementDate?.toISOString(),
      // Convert Decimal to number
      dividendPerShare: a.dividendPerShare ? Number(a.dividendPerShare) : null,
      dividendYield: a.dividendYield ? Number(a.dividendYield) : null,
    }));

    // Apply pagination if requested
    if (page !== undefined && limit !== undefined) {
      const total = formatted.length;
      const totalPages = Math.ceil(total / limit);
      const offset = (page - 1) * limit;
      const paginated = formatted.slice(offset, offset + limit);
      
      return NextResponse.json({ 
        data: paginated, 
        total, 
        page, 
        totalPages, 
        limit,
        source: cacheResult.source,
        lastSyncedAt: cacheResult.lastSyncedAt?.toISOString(),
        cached: !cacheResult.needsRefresh
      });
    }

    return NextResponse.json({ 
      data: formatted, 
      source: cacheResult.source,
      lastSyncedAt: cacheResult.lastSyncedAt?.toISOString(),
      cached: !cacheResult.needsRefresh
    });

  } catch (e) {
    logger.error({ msg: "Failed to fetch combined corporate actions", error: e });
    return NextResponse.json({ error: "Failed to fetch corporate actions" }, { status: 500 });
  }
}
