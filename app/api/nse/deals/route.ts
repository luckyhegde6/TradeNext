// app/api/nse/deals/route.ts
import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";
import logger from "@/lib/logger";

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

export async function GET(req: Request) {
  try {
    // Get query parameters from request URL
    const url = req.url ? new URL(req.url) : new URL('http://localhost');
    const dealTypeParam = url.searchParams.get("dealType"); // "bulk_deal", "block_deal", "short_selling"

    // Fetch large deals from NSE
    const raw = await nseFetch("/api/snapshot-capital-market-largedeal") as NseLargeDealResponse;
    
    // NSE returns separate arrays for bulk and block deals
    const bulkDeals = Array.isArray(raw?.BULK_DEALS_DATA) ? raw.BULK_DEALS_DATA : [];
    const blockDeals = Array.isArray(raw?.BLOCK_DEALS_DATA) ? raw.BLOCK_DEALS_DATA : [];
    const shortDeals = Array.isArray(raw?.SHORT_DEALS_DATA) ? raw.SHORT_DEALS_DATA : [];
    
    // Helper to parse numbers safely (handles strings with commas)
    const parseNum = (val: any): number => {
      if (typeof val === 'number') return val;
      if (typeof val === 'string') {
        const cleaned = val.replace(/,/g, '');
        const num = parseFloat(cleaned);
        return isNaN(num) ? 0 : num;
      }
      return 0;
    };

    // Transform each deal with consistent typing and dealType
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

    // Build all deals array
    const allDeals = [
      ...blockDeals.map(item => transform(item, 'block')),
      ...bulkDeals.map(item => transform(item, 'bulk')),
      ...shortDeals.map(item => transform(item, 'short')),
    ];

    // Filter by dealType if requested
    let filteredDeals = allDeals;
    if (dealTypeParam) {
      if (dealTypeParam === "bulk_deal") {
        filteredDeals = allDeals.filter(d => d.dealType === 'bulk');
      } else if (dealTypeParam === "block_deal") {
        filteredDeals = allDeals.filter(d => d.dealType === 'block');
      } else if (dealTypeParam === "short_selling") {
        filteredDeals = allDeals.filter(d => d.dealType === 'short');
      }
    }

    // Parse as_on_date to ISO format if present
    let fetchedAt = new Date().toISOString();
    if (raw?.as_on_date) {
      // NSE format: "09-Mar-2026"
      const [dd, mon, yr] = raw.as_on_date.split('-');
      const monthMap: Record<string, number> = {
        'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
        'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11
      };
      const month = monthMap[mon.toUpperCase()];
      if (month !== undefined) {
        const date = new Date(parseInt(yr), month, parseInt(dd));
        fetchedAt = date.toISOString();
      }
    }
    
    logger.info({ 
      msg: "Fetched large deals from NSE", 
      requestedDealType: dealTypeParam,
      bulkCount: bulkDeals.length, 
      blockCount: blockDeals.length,
      shortCount: shortDeals.length,
      returnedCount: filteredDeals.length 
    });
    
    return NextResponse.json(
      { 
        data: filteredDeals,
        meta: {
          fetchedAt,
          asOnDate: raw?.as_on_date,
          bulkCount: bulkDeals.length,
          blockCount: blockDeals.length,
          shortCount: shortDeals.length,
        }
      },
      { headers: { "Cache-Control": "public, max-age=60" } }
    );
  } catch (e) {
    logger.error({ msg: "Failed to fetch large deals from NSE", error: e });
    return NextResponse.json(
      { error: "Failed to fetch deals data", data: [] },
      { status: 502 }
    );
  }
}
