// app/api/nse/deals/route.ts
import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";
import logger from "@/lib/logger";
import { getOrFetchNseData, forceRefreshCache, type DataType } from "@/lib/market-cache";

interface LargeDeal {
  date: string;
  symbol: string;
  securityName: string;
  clientName: string;
  buySell: string;
  quantityTraded: number;
  tradePrice: number;
  remarks?: string;
}

interface NseLargeDealResponse {
  as_on_date?: string;
  BULK_DEALS_DATA?: any[];
  BLOCK_DEALS?: string;
  BLOCK_DEALS_DATA?: any[];
  SHORT_DEALS?: string;
  SHORT_DEALS_DATA?: any[];
}

function parseNseDate(dateStr: string): string {
  try {
    // Format: "09-Mar-2026"
    const parts = dateStr.split('-');
    if (parts.length !== 3) return new Date().toISOString();
    const [dd, mon, yr] = parts;
    const monthMap: Record<string, number> = {
      'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
      'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11
    };
    const month = monthMap[mon.toUpperCase()];
    if (month === undefined) return new Date().toISOString();
    const date = new Date(parseInt(yr), month, parseInt(dd));
    return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  } catch (e) {
    logger.warn({ msg: 'Failed to parse NSE date', dateStr, error: e });
    return new Date().toISOString();
  }
}

/**
 * Fetch deals from NSE
 */
async function fetchDealsFromNse(): Promise<any> {
  const raw = await nseFetch("/api/snapshot-capital-market-largedeal") as NseLargeDealResponse;
  
  const bulkDeals = Array.isArray(raw?.BULK_DEALS_DATA) ? raw.BULK_DEALS_DATA : [];
  const blockDeals = Array.isArray(raw?.BLOCK_DEALS_DATA) ? raw.BLOCK_DEALS_DATA : [];
  const shortDeals = Array.isArray(raw?.SHORT_DEALS_DATA) ? raw.SHORT_DEALS_DATA : [];
  
  const parseNum = (val: any): number => {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const cleaned = val.replace(/,/g, '');
      const num = parseFloat(cleaned);
      return isNaN(num) ? 0 : num;
    }
    return 0;
  };

  const transform = (item: any, type: 'bulk' | 'block' | 'short') => ({
    date: parseNseDate(item.date || ""),
    symbol: item.symbol || "",
    securityName: item.name || item.securityName || "",
    clientName: item.clientName || "",
    buySell: item.buySell || "",
    quantity: parseNum(item.qty || item.quantityTraded || 0),
    quantityTraded: parseNum(item.qty || item.quantityTraded || 0),
    price: parseNum(item.watp || item.tradePrice || 0),
    tradePrice: parseNum(item.watp || item.tradePrice || 0),
    remarks: item.remarks || null,
    dealType: type,
  });

  const asOnDate = raw?.as_on_date ? parseNseDate(raw.as_on_date) : new Date().toISOString();

  return {
    data: [
      ...blockDeals.map(item => transform(item, 'block')),
      ...bulkDeals.map(item => transform(item, 'bulk')),
      ...shortDeals.map(item => transform(item, 'short')),
    ],
    meta: {
      fetchedAt: asOnDate,
      asOnDate: raw?.as_on_date,
      bulkCount: bulkDeals.length,
      blockCount: blockDeals.length,
      shortCount: shortDeals.length,
    }
  };
}

export async function GET(req: Request) {
  try {
    const url = req.url ? new URL(req.url) : new URL('http://localhost');
    const dealTypeParam = url.searchParams.get("dealType");
    const forceRefresh = url.searchParams.get("forceRefresh") === "true";

    let dealsResult;
    
    if (forceRefresh) {
      dealsResult = await forceRefreshCache(fetchDealsFromNse, "block_deals");
    } else {
      dealsResult = await getOrFetchNseData(fetchDealsFromNse, {
        dataType: "block_deals",
        ttlSecondsOpen: 180,
        ttlSecondsClosed: 1800
      });
    }

    const { data: allDeals, meta } = dealsResult.data as any;
    
    // Filter by dealType if requested
    let filteredDeals = allDeals;
    if (dealTypeParam) {
      if (dealTypeParam === "bulk_deal") {
        filteredDeals = allDeals.filter((d: any) => d.dealType === 'bulk');
      } else if (dealTypeParam === "block_deal") {
        filteredDeals = allDeals.filter((d: any) => d.dealType === 'block');
      } else if (dealTypeParam === "short_selling") {
        filteredDeals = allDeals.filter((d: any) => d.dealType === 'short');
      }
    }

    logger.info({ 
      msg: "Deals: Serving from cache", 
      source: dealsResult.source,
      returnedCount: filteredDeals.length 
    });
    
    return NextResponse.json(
      { 
        data: filteredDeals,
        meta,
        source: dealsResult.source,
        lastSyncedAt: dealsResult.lastSyncedAt?.toISOString(),
        cached: !dealsResult.needsRefresh
      },
      { headers: { "Cache-Control": "public, max-age=60" } }
    );
  } catch (e) {
    logger.error({ msg: "Failed to fetch large deals", error: e });
    return NextResponse.json(
      { error: "Failed to fetch deals data", data: [] },
      { status: 502 }
    );
  }
}
