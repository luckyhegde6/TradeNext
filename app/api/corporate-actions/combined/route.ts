import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { nseFetch } from "@/lib/nse-client";
import { getOrFetchNseData, forceRefreshCache, type DataType } from "@/lib/market-cache";
import cache from "@/lib/cache";
import { isDbUnavailableError, isPlanLimitBreakerOpen } from "@/lib/db-utils";
import { recordRead } from "@/lib/services/readTier";
import { getSqliteFallback } from "@/lib/sqlite";

/** Module-level guard: prevent overlapping NSE refreshes. */
let nseRefreshInFlight: Promise<void> | null = null;

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
    // Create date at noon UTC to avoid timezone issues with midnight
    const date = new Date(Date.UTC(parseInt(yr), month, parseInt(dd), 12, 0, 0, 0));
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

  // Check for dividend in purpose - multiple patterns
  if (p.includes('dividend') || p.includes('interest payment')) {
    actionType = p.includes('interest') ? 'INTEREST' : 'DIVIDEND';
    // Try multiple patterns for dividend amount
    const patterns = [
      /Rs\s*([\d,.]+)\s*Per Share/i,
      /Rs\s*([\d,.]+)\s*\/\s*Share/i,
      /Rs\.?\s*([\d,.]+)/i,
      /₹\s*([\d,.]+)/i,
      /([\d,.]+)\s*Per Share/i,
      /final\s+dividend\s+([\d,.]+)/i,
      /interim\s+dividend\s+([\d,.]+)/i,
      /dividend\s+([\d,.]+)/i,
    ];
    for (const pattern of patterns) {
      const match = purpose.match(pattern);
      if (match) {
        const amount = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(amount) && amount > 0) {
          dividendAmount = amount;
          break;
        }
      }
    }
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
  // NSE API uses 'subject' field (lowercase), not 'PURPOSE' (uppercase)
  const purpose = item.PURPOSE || item.purpose || item.subject || '';
  const parsed = parsePurpose(purpose);
  const exDate = parseNseDate(item['EX-DATE'] || item.exDate || "");
  if (!exDate) return null;

  // Try to get dividend amount from multiple possible fields in NSE API
  let dividendAmount = parsed.dividendAmount || null;
  
  // Check if NSE API has a specific dividend amount field
  if (!dividendAmount) {
    const possibleFields = ['DIVIDEND_AMOUNT', 'dividendAmount', 'DIVIDEND', 'nd', ' Dividend'];
    for (const field of possibleFields) {
      if (item[field] !== undefined && item[field] !== null && item[field] !== '-') {
        const parsedVal = parseFloat(String(item[field]).replace(/,/g, ''));
        if (!isNaN(parsedVal) && parsedVal > 0) {
          dividendAmount = parsedVal;
          break;
        }
      }
    }
  }
  
  // If still no dividend amount, try to infer from purpose if it says "dividend"
  if (!dividendAmount && purpose.toLowerCase().includes('dividend')) {
    // For cases like "Dividend" without amount, we can't determine the amount
    // But at least mark it as DIVIDEND type
  }
  
  let dividendYield: number | null = null;
  if (dividendAmount) {
    const faceValue = item['FACE VALUE'] || item.faceValue || item['FV'] || item.fv;
    if (faceValue) {
      const fv = parseFloat(String(faceValue).replace(/,/g, ''));
      if (fv > 0) {
        dividendYield = (dividendAmount / fv) * 100;
      }
    }
  }

  return {
    symbol: item.SYMBOL || item.symbol || "",
    companyName: item['COMPANY NAME'] || item.companyName || item.comp || "",
    series: item.SERIES || item.series || null,
    subject: purpose,
    actionType: parsed.actionType,
    exDate: exDate,
    recordDate: parseNseDate(item['RECORD DATE'] || item.recordDate || item.recDate || ""),
    faceValue: item['FACE VALUE'] || item.faceValue || item['FV'] || item.fv || item.faceVal || null,
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
 * Uses upsert with (symbol, actionType, exDate) to match the unique constraint
 */
async function hydrateCorporateActionsToDb(actions: any[]): Promise<number> {
  let hydrated = 0;
  
  for (const action of actions) {
    if (!action.symbol || !action.exDate) continue;
    
    try {
      const actionType = action.actionType || "OTHER";
      const exDate = new Date(action.exDate);
      
      // Use upsert with symbol + actionType + exDate to match unique constraint
      await prisma.corporateAction.upsert({
        where: {
          symbol_actionType_exDate: {
            symbol: action.symbol,
            actionType: actionType,
            exDate: exDate
          }
        },
        update: {
          companyName: action.companyName || "",
          series: action.series,
          subject: action.subject || "",
          recordDate: action.recordDate ? new Date(action.recordDate) : null,
          faceValue: action.faceValue,
          ratio: action.ratio,
          dividendPerShare: action.dividendPerShare ?? action.dividendAmount ?? null,
          dividendYield: action.dividendYield,
          source: 'nse'
        },
        create: {
          symbol: action.symbol,
          companyName: action.companyName || "",
          series: action.series,
          subject: action.subject || "",
          actionType: actionType,
          exDate: exDate,
          recordDate: action.recordDate ? new Date(action.recordDate) : null,
          faceValue: action.faceValue,
          ratio: action.ratio,
          dividendPerShare: action.dividendPerShare ?? action.dividendAmount ?? null,
          dividendYield: action.dividendYield,
          source: 'nse'
        }
      });
      hydrated++;
    } catch (error) {
      console.error('Error hydrating corporate action:', error);
    }
  }
  return hydrated;
}

/**
 * Background NSE refresh — non-blocking, fire-and-forget.
 * Fetches from NSE, updates memory cache + MarketCache DB, hydrates corporate_action table.
 * Module-guarded: only one refresh runs at a time.
 */
function triggerNseRefresh(force: boolean) {
  if (nseRefreshInFlight) {
    logger.debug({ msg: "CorporateActions: NSE refresh already in progress, skipping" });
    return;
  }

  nseRefreshInFlight = (async () => {
    try {
      let cacheResult;
      const dataType: DataType = "corporate_actions";

      if (force) {
        cacheResult = await forceRefreshCache(fetchCorporateActionsFromNse, dataType);
      } else {
        cacheResult = await getOrFetchNseData(fetchCorporateActionsFromNse, {
          dataType,
          ttlSecondsOpen: 300,   // 5 minutes when market is open
          ttlSecondsClosed: 3600 // 1 hour when market is closed
        });
      }

      // Hydrate to corporate_action table in background
      if (cacheResult.source === "nse") {
        hydrateCorporateActionsToDb(cacheResult.data as any[]).then(count => {
          logger.info({ msg: "CorporateActions: Hydrated to DB from NSE", count });
        }).catch(err => {
          logger.error({ msg: "CorporateActions: DB hydration error", error: err });
        });
      }

      logger.info({ msg: "CorporateActions: NSE refresh completed", source: cacheResult.source });
    } catch (err) {
      logger.warn({ msg: "CorporateActions: NSE refresh failed (non-blocking)", error: err });
    } finally {
      nseRefreshInFlight = null;
    }
  })();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const actionType = url.searchParams.get("type");
  const symbol = url.searchParams.get("symbol");
  const fromDate = url.searchParams.get("fromDate");
  const toDate = url.searchParams.get("toDate");
  const pageParam = url.searchParams.get("page");
  const limitParam = url.searchParams.get("limit");
  const forceRefresh = url.searchParams.get("forceRefresh") === "true";
  const isDefaultQuery = !actionType && !symbol && !fromDate && !toDate && !pageParam && !limitParam;
  const CORP_CACHE_KEY = "corp-actions:combined:default";
  const CORP_CACHE_TTL = 5 * 60;

  const page = pageParam ? parseInt(pageParam, 10) : undefined;
  const limit = limitParam ? parseInt(limitParam, 10) : undefined;

  // --- FAST PATH: memory cache for the default unfiltered query ---
  if (isDefaultQuery && !forceRefresh) {
    const cached = cache.get(CORP_CACHE_KEY);
    if (cached) {
      // Still trigger background NSE refresh (non-blocking, guarded)
      triggerNseRefresh(false);
      logger.debug({ msg: "CorporateActions: Serving from memory cache" });
      recordRead("corp-actions.memory", { source: "memory", latencyMs: 0, rows: 1, hit: true });
      return NextResponse.json(cached);
    }
  }

  // --- v3.23.x: SQLite-mirror fast path during a plan-limit hold ---
  // Serve the SQLite corporate_action mirror directly WITHOUT any Prisma call
  // (even a fast-fail breaker throw generates log noise). Prisma is only
  // touched again on the 6h recovery sync or a manual force.
  if (isPlanLimitBreakerOpen()) {
    const sqlite = getSqliteFallback();
    const actions = sqlite?.isReady() ? sqlite.getCorporateActions(500) : [];
    if (actions.length) {
      logger.warn({ msg: "CorporateActions: plan-limit breaker open — serving SQLite mirror" });
      return NextResponse.json({ data: actions, source: "sqlite_mirror" });
    }
  }

  // --- PRIMARY PATH: DB query (always runs, regardless of NSE status) ---
  try {
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

    const _ca = performance.now();
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
    recordRead("corp-actions.prisma", {
      source: "prisma",
      latencyMs: Math.max(0, Math.round(performance.now() - _ca)),
      rows: actions.length,
      hit: false,
    });

    const formatted = actions.map(a => ({
      ...a,
      exDate: a.exDate?.toISOString(),
      recordDate: a.recordDate?.toISOString(),
      effectiveDate: a.effectiveDate?.toISOString(),
      bookClosureStartDate: a.bookClosureStartDate?.toISOString(),
      bookClosureEndDate: a.bookClosureEndDate?.toISOString(),
      announcementDate: a.announcementDate?.toISOString(),
      dividendPerShare: a.dividendPerShare ? Number(a.dividendPerShare) : null,
      dividendYield: a.dividendYield ? Number(a.dividendYield) : null,
    }));

    // Enrich with latest stock prices for currentPrice + correct dividend yield
    const uniqueSymbols = [...new Set(formatted.map(a => a.symbol).filter(Boolean))];
    let priceMap = new Map<string, number | null>();

    if (uniqueSymbols.length > 0) {
      try {
        const priceRows = await prisma.$queryRaw<Array<{ ticker: string; close: number }>>`
          SELECT DISTINCT ON (ticker) ticker, close::float8 as close
          FROM daily_prices
          WHERE ticker = ANY(${uniqueSymbols})
          ORDER BY ticker, "tradeDate" DESC
        `;
        for (const row of priceRows) {
          priceMap.set(row.ticker, row.close);
        }
        logger.debug({ msg: 'Enriched corporate actions with prices', count: priceRows.length });
      } catch (priceError) {
        logger.warn({ msg: 'Failed to fetch latest prices for corporate actions', error: priceError });
      }
    }

    const enriched = formatted.map(a => {
      const currentPrice = priceMap.get(a.symbol) ?? null;
      return {
        ...a,
        currentPrice,
        dividendYield: a.dividendPerShare && currentPrice && currentPrice > 0
          ? (a.dividendPerShare / currentPrice) * 100
          : null,
      };
    });

    // Determine source for response metadata
    const memKey = `mc:corporate_actions`;
    const memCached = cache.get<{ source: string; lastSyncedAt: Date }>(memKey);
    const source = memCached?.source ?? "db";
    const lastSyncedAt = memCached?.lastSyncedAt ?? null;

    // Apply pagination if requested
    if (page !== undefined && limit !== undefined) {
      const total = enriched.length;
      const totalPages = Math.ceil(total / limit);
      const offset = (page - 1) * limit;
      const paginated = enriched.slice(offset, offset + limit);

      // Trigger background NSE refresh (non-blocking)
      triggerNseRefresh(forceRefresh);

      return NextResponse.json({
        data: paginated,
        total,
        page,
        totalPages,
        limit,
        source,
        lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
      });
    }

    const responseBody = {
      data: enriched,
      source,
      lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
    };

    // Cache the default unfiltered response (most common path)
    if (isDefaultQuery) {
      cache.set(CORP_CACHE_KEY, responseBody, CORP_CACHE_TTL);
    }

    // Trigger background NSE refresh (non-blocking)
    triggerNseRefresh(forceRefresh);

    return NextResponse.json(responseBody);

  } catch (e) {
    // --- SQLite fallback ---
    const sqlite = getSqliteFallback();
    if (sqlite?.isReady()) {
      try {
        const actions = sqlite.getCorporateActions(500);
        if (actions.length) {
          logger.warn({ msg: "CorporateActions: DB unavailable — serving SQLite backup" });
          return NextResponse.json({ data: actions, source: "sqlite_backup" });
        }
      } catch {
        // SQLite fallback itself failed — fall through to memory cache
      }
    }

    // DB unavailable — try serving stale memory cache before 500
    if (isDbUnavailableError(e)) {
      const stale = cache.get(CORP_CACHE_KEY);
      if (stale) {
        logger.warn({ msg: "CorporateActions: DB unavailable — serving stale memory cache" });
        return NextResponse.json(stale);
      }
    }

    logger.warn({ msg: "CorporateActions: all sources failed — returning empty", error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ data: [], warning: "Corporate actions data unavailable" });
  }
}
