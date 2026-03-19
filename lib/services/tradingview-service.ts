// lib/services/tradingview-service.ts
import { staticCache } from "@/lib/cache";
import logger from "@/lib/logger";

const TRADINGVIEW_API_BASE = "https://scanner.tradingview.com";

interface TradingViewScanResult {
  symbol: string;
  description: string;
  type: string;
  exchange: string;
  [key: string]: unknown;
}

interface TradingViewMeta {
  symbol: string;
  company_name?: string;
  exchange?: string;
  short_name?: string;
  type?: string;
}

/**
 * Get screener metadata from TradingView
 * API: https://scanner.tradingview.com/india/metainfo
 */
export async function getScreenerMeta(): Promise<TradingViewMeta[]> {
  const cacheKey = "tradingview:screener:meta";
  const cached = staticCache.get(cacheKey);
  if (cached) return cached as TradingViewMeta[];

  try {
    const response = await fetch(`${TRADINGVIEW_API_BASE}/india/metainfo`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      throw new Error(`TradingView API error: ${response.status}`);
    }

    const data = await response.json();

    // Transform data to array
    const symbols: TradingViewMeta[] = Array.isArray(data)
      ? data
      : data.data
        ? data.data
        : [];

    // Cache for 1 hour
    staticCache.set(cacheKey, symbols, 3600);

    logger.info({ msg: "TradingView meta fetched", count: symbols.length });
    return symbols;
  } catch (error) {
    logger.error({ msg: "Failed to fetch TradingView meta", error });
    return [];
  }
}

/**
 * Get screener filters/enums from TradingView
 * API: https://scanner.tradingview.com/enum/ordered
 */
export async function getScreenerEnums(): Promise<Record<string, unknown>> {
  const cacheKey = "tradingview:screener:enums";
  const cached = staticCache.get(cacheKey);
  if (cached) return cached as Record<string, unknown>;

  try {
    const response = await fetch(
      `${TRADINGVIEW_API_BASE}/enum/ordered?id=index,country,top_revenue_country_code,exchange,industry,sector,submarket,currency_id,analyst_rating,technical_rating&lang=en`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`TradingView API error: ${response.status}`);
    }

    const data = await response.json();

    // Cache for 24 hours
    staticCache.set(cacheKey, data, 86400);

    logger.info({ msg: "TradingView enums fetched" });
    return data;
  } catch (error) {
    logger.error({ msg: "Failed to fetch TradingView enums", error });
    return {};
  }
}

/**
 * Scan stocks from TradingView with filters
 * API: https://scanner.tradingview.com/india/scan
 */
export async function scanStocks(filters?: Record<string, unknown>): Promise<TradingViewScanResult[]> {
  const cacheKey = `tradingview:scan:${JSON.stringify(filters || {})}`;
  const cached = staticCache.get(cacheKey);
  if (cached) return cached as TradingViewScanResult[];

  try {
    // Handle if filters is actually a full request object or just the filters array
    const isFullRequest = filters && typeof filters === 'object' && ('filter' in filters || 'range' in filters || 'sort' in filters);

    // TradingView range is often [from, to] or {from, to}
    const rangeObj = isFullRequest ? (filters as any).range : { from: 0, to: 100 };
    const rangeArray = Array.isArray(rangeObj) ? rangeObj : [rangeObj?.from || 0, rangeObj?.to || 100];

    const scanRequest = isFullRequest
      ? {
        ...filters,
        filter: [
          // Ensure exchange filter exists if not provided
          ...((filters as any).filter?.some((f: any) => f.left === 'exchange')
            ? []
            : [{ left: "exchange", operation: "equal", right: "NSE" }]),
          ...((filters as any).filter || [])
        ],
        range: rangeArray
      }
      : {
        filter: (filters as any) || [
          { left: "exchange", operation: "equal", right: "NSE" },
        ],
        options: {
          lang: "en",
          active_symbols_only: true,
        },
        sort: {
          sortBy: "market_cap_basic",
          sortOrder: "desc",
        },
        range: rangeArray,
      };

    const response = await fetch(`${TRADINGVIEW_API_BASE}/india/scan?label-product=screener-stock`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      body: JSON.stringify({
        ...scanRequest,
        columns: [
          "name",
          "close",
          "change",
          "volume",
          "market_cap_basic",
          "price_earnings_ttm",
          "dividend_yield_recent",
          "sector",
          "industry",
          "price_book_ratio",
          "relative_volume_10d_calc",
          "return_on_equity_fq",
          "debt_to_equity_fq",
        ]
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`TradingView API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // Transform response
    const results: TradingViewScanResult[] = Array.isArray(data?.data)
      ? data.data.map((item: { s: string; d: (string | number | any | null)[] }) => {
        // Helper to extract value if it's an object (sometimes columns like 'name' return metadata objects)
        const getVal = (idx: number, key?: string) => {
          const val = item.d[idx];
          if (val && typeof val === 'object' && key) return val[key];
          return val;
        };

        return {
          symbol: item.s,
          name: getVal(0, 'name') || item.s.split(':')[1] || item.s,
          description: getVal(0, 'description') || '',
          close: item.d[1] as number,
          change: item.d[2] as number,
          volume: item.d[3] as number,
          market_cap: item.d[4] as number,
          pe: item.d[5] as number,
          dividend_yield: item.d[6] as number,
          sector: getVal(7) as string,
          industry: getVal(8) as string,
          pb: item.d[9] as number,
          relativeVolume: item.d[10] as number,
          roe: item.d[11] as number,
          debtToEquity: item.d[12] as number,
          exchange: item.s.split(':')[0] || 'NSE',
        };
      })
      : [];

    // Cache for 5 minutes
    staticCache.set(cacheKey, results, 300);

    logger.info({ msg: "TradingView scan completed", count: results.length });
    return results;
  } catch (error) {
    logger.error({ msg: "Failed to scan TradingView", error });
    return [];
  }
}

/**
 * Get top gainers/losers from TradingView
 */
export async function getTopMovers(type: "gainers" | "losers" | "active", limit = 20): Promise<TradingViewScanResult[]> {
  const filterMap = {
    gainers: { left: "change_percent", operation: "greater", right: 3 },
    losers: { left: "change_percent", operation: "less", right: -3 },
    active: { left: "volume", operation: "egreater", right: 1000000 },
  };

  const filters = [
    { left: "exchange", operation: "equal", right: "NSE" },
    filterMap[type],
  ];

  return scanStocks({
    filter: filters,
    range: { from: 0, to: limit },
  });
}

/**
 * Sync TradingView stocks to database
 */
export async function syncTradingViewStocks(): Promise<{ synced: number; created: number; updated: number }> {
  const prisma = (await import("@/lib/prisma")).default;

  const stocks = await scanStocks();

  let created = 0;
  let updated = 0;

  for (const stock of stocks) {
    try {
      await prisma.symbol.upsert({
        where: { symbol: stock.symbol },
        create: {
          symbol: stock.symbol,
          companyName: stock.description || stock.symbol,
          series: "EQ",
          isActive: true,
        },
        update: {
          companyName: stock.description,
        },
      });
      updated++;
    } catch {
      created++;
    }
  }

  logger.info({ msg: "TradingView stocks synced", total: stocks.length, created, updated });

  return { synced: stocks.length, created, updated };
}
