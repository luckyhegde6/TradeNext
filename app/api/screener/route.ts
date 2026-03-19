import { NextResponse } from "next/server";
import { getLatestScreenerData } from "@/lib/services/worker/screener-service";
import { scanStocks } from "@/lib/services/tradingview-service";

export const dynamic = 'force-dynamic';

// TradingView stock data type
interface StockData {
  symbol?: string;
  name?: string;
  description?: string;
  close?: number;
  change?: number;
  percentChange?: number;
  change_percent?: number;
  volume?: number;
  relativeVolume?: number;
  market_cap?: number;
  sector?: string;
  industry?: string;
  pe?: number;
  pb?: number;
  dividend_yield?: number;
  roe?: number;
  debtToEquity?: number;
  beta?: number;
  perfW?: number;
  perfM?: number;
  technical_rating?: string;
  [key: string]: unknown;
}

// Fetch stocks - from database cache first, then from TradingView
async function getStocks(): Promise<{ stocks: StockData[]; lastSyncedAt: Date | null }> {
  // Try database first
  const latestSync = await getLatestScreenerData();
  
  if (latestSync?.data && Array.isArray(latestSync.data) && latestSync.data.length > 0) {
    return {
      stocks: latestSync.data as StockData[],
      lastSyncedAt: latestSync.createdAt
    };
  }
  
  // Fetch directly from TradingView
  try {
    const tvStocks = await scanStocks({
      filter: [
        { left: "exchange", operation: "equal", right: "NSE" },
      ],
      range: { from: 0, to: 2000 },
    });
    
    return {
      stocks: tvStocks as unknown as StockData[],
      lastSyncedAt: new Date()
    };
  } catch (error) {
    console.error('TradingView fetch error:', error);
    return { stocks: [], lastSyncedAt: null };
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      filters = {},
      page = 1,
      limit = 50,
      sortBy = 'market_cap',
      sortOrder = 'desc'
    } = body;

    // Get stocks from cache or TradingView
    const { stocks: allStocks, lastSyncedAt } = await getStocks();

    if (allStocks.length === 0) {
      return NextResponse.json({
        stocks: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
        message: "No stock data available. Please try again later."
      });
    }

    let stocks = [...allStocks];

    // 1. Apply Server-side Filters (based on TradingView fields)
    if (Object.keys(filters).length > 0) {
      stocks = stocks.filter(stock => {
        // Price filter (close)
        if (filters.price?.min !== undefined && (stock.close ?? 0) < filters.price.min) return false;
        if (filters.price?.max !== undefined && (stock.close ?? Infinity) > filters.price.max) return false;

        // Volume filter (volume - absolute)
        if (filters.volume?.min !== undefined && (stock.volume ?? 0) < filters.volume.min) return false;

        // Relative Volume filter (relative_volume_10d_calc)
        if (filters.relativeVolume?.min !== undefined && (stock.relativeVolume ?? 0) < filters.relativeVolume.min) return false;

        // Sector filter
        if (filters.sector && stock.sector !== filters.sector) return false;

        // Industry filter
        if (filters.industry && stock.industry !== filters.industry) return false;

        // % Change filter (change_percent)
        const pctChange = stock.percentChange ?? stock.change_percent ?? stock.change ?? 0;
        if (filters.change?.min !== undefined && pctChange < filters.change.min) return false;
        if (filters.change?.max !== undefined && pctChange > filters.change.max) return false;

        // Weekly Performance (perf.W)
        if (filters.perfWeek?.min !== undefined && (stock.perfW ?? 0) < filters.perfWeek.min) return false;
        if (filters.perfWeek?.max !== undefined && (stock.perfW ?? Infinity) > filters.perfWeek.max) return false;

        // Monthly Performance (perf.M)
        if (filters.perfMonth?.min !== undefined && (stock.perfM ?? 0) < filters.perfMonth.min) return false;
        if (filters.perfMonth?.max !== undefined && (stock.perfM ?? Infinity) > filters.perfMonth.max) return false;

        // Market Cap filter (market_cap_basic - in crores)
        if (filters.marketCap?.min !== undefined && (stock.market_cap ?? 0) < filters.marketCap.min * 10000000) return false;
        if (filters.marketCap?.max !== undefined && (stock.market_cap ?? Infinity) > filters.marketCap.max * 10000000) return false;

        // P/E Ratio filter (price_earnings_ttm)
        if (filters.peRatio?.min !== undefined && (stock.pe ?? 0) < filters.peRatio.min) return false;
        if (filters.peRatio?.max !== undefined && stock.pe !== null && stock.pe !== undefined && stock.pe > filters.peRatio.max) return false;

        // P/B Ratio filter (price_book_ratio)
        if (filters.pbRatio?.min !== undefined && (stock.pb ?? 0) < filters.pbRatio.min) return false;
        if (filters.pbRatio?.max !== undefined && stock.pb !== null && stock.pb !== undefined && stock.pb > filters.pbRatio.max) return false;

        // Dividend Yield filter (dividend_yield_recent)
        if (filters.dividendYield?.min !== undefined && (stock.dividend_yield ?? 0) < filters.dividendYield.min) return false;

        // ROE filter (return_on_equity_fq)
        if (filters.roe?.min !== undefined && (stock.roe ?? 0) < filters.roe.min) return false;

        // Debt/Equity filter (debt_to_equity_fq)
        if (filters.debtToEquity?.max !== undefined && stock.debtToEquity !== null && stock.debtToEquity !== undefined && stock.debtToEquity > filters.debtToEquity.max) return false;

        // Beta filter (not available in current API)
        // if (filters.beta?.min !== undefined && (stock.beta ?? 0) < filters.beta.min) return false;
        // if (filters.beta?.max !== undefined && (stock.beta ?? Infinity) > filters.beta.max) return false;

        // Preset filters
        if (filters.preset === 'highVolume') {
          const relVol = stock.relativeVolume ?? 0;
          if (relVol < 1.5) return false;
        }
        
        if (filters.preset === 'topGainers') {
          if (pctChange < 3) return false;
        }
        
        if (filters.preset === 'topLosers') {
          if (pctChange > -3) return false;
        }
        
        if (filters.preset === 'valueStocks') {
          const pe = stock.pe ?? 0;
          const pb = stock.pb ?? 0;
          if (pe > 25 || pe <= 0 || pb > 3 || pb <= 0) return false;
        }
        
        if (filters.preset === 'growthStocks') {
          const pe = stock.pe ?? 0;
          if (pe < 15 || pe > 60) return false;
        }
        
        if (filters.preset === 'highDividend') {
          if ((stock.dividend_yield ?? 0) < 3) return false;
        }

        return true;
      });
    }

    // 2. Sort Data
    stocks.sort((a, b) => {
      // Map frontend sortBy to actual stock properties
      const keyMap: Record<string, string> = {
        'symbol': 'symbol',
        'close': 'close',
        'change': 'change',
        'percentChange': 'percentChange',
        'volume': 'volume',
        'market_cap': 'market_cap',
        'pe': 'pe',
        'pb': 'pb',
        'dividend_yield': 'dividend_yield',
        'perfWeek': 'perfW',
        'perfMonth': 'perfM',
        'technical_rating': 'technical_rating',
        'roe': 'roe',
        'beta': 'beta',
      };

      const actualKey = keyMap[sortBy] || sortBy;
      const valA = a[actualKey] ?? 0;
      const valB = b[actualKey] ?? 0;

      if (typeof valA === 'string' && typeof valB === 'string') {
        return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }

      return sortOrder === 'asc' 
        ? (valA as number) - (valB as number)
        : (valB as number) - (valA as number);
    });

    // 3. Paginate
    const total = stocks.length;
    const startIndex = (page - 1) * limit;
    const paginatedStocks = stocks.slice(startIndex, startIndex + limit);

    return NextResponse.json({
      stocks: paginatedStocks.map(s => ({
        ...s,
        percentChange: s.percentChange ?? s.change_percent ?? s.change ?? 0
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      lastSyncedAt: lastSyncedAt?.toISOString()
    });
  } catch (error) {
    console.error('Screener error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stocks' },
      { status: 500 }
    );
  }
}
