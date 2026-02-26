import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

interface ScreenerFilter {
  price?: { min?: number; max?: number };
  volume?: { min?: number };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { 
      filters = {}, 
      page = 1, 
      limit = 50,
      sortBy = 'symbol',
      sortOrder = 'asc'
    } = body;

    const { default: prisma } = await import("@/lib/prisma");

    const uniqueTickers = await prisma.dailyPrice.findMany({
      distinct: ['ticker'],
      select: { ticker: true },
      orderBy: { ticker: 'asc' },
    });

    const tickerList = uniqueTickers.map(t => t.ticker);
    const total = tickerList.length;

    const sortedTickers = [...tickerList].sort((a, b) => {
      if (sortOrder === 'asc') {
        return a.localeCompare(b);
      }
      return b.localeCompare(a);
    });

    const paginatedTickers = sortedTickers.slice((page - 1) * limit, page * limit);

    const latestPrices = await Promise.all(
      paginatedTickers.map(async (ticker) => {
        const latest = await prisma.dailyPrice.findFirst({
          where: { ticker },
          orderBy: { tradeDate: 'desc' },
        });
        
        const prevPrice = await prisma.dailyPrice.findFirst({
          where: { ticker },
          orderBy: { tradeDate: 'desc' },
          skip: 1,
        });

        const change = latest?.close && prevPrice?.close 
          ? Number(latest.close) - Number(prevPrice.close) 
          : 0;
        const percentChange = prevPrice?.close && Number(prevPrice.close) > 0 
          ? (change / Number(prevPrice.close)) * 100 
          : 0;

        return {
          symbol: ticker,
          companyName: ticker,
          sector: 'NSE',
          lastPrice: latest?.close ? Number(latest.close) : 0,
          change,
          percentChange,
          dayHigh: latest?.high ? Number(latest.high) : 0,
          dayLow: latest?.low ? Number(latest.low) : 0,
          volume: Number(latest?.volume || 0),
          marketCap: null,
          peRatio: null,
          pbRatio: null,
          dividendYield: null,
          eps: null,
          bookValue: null,
          sectorPe: null,
        };
      })
    );

    const filteredStocks = latestPrices.filter(stock => {
      if (filters.price?.min && stock.lastPrice < filters.price.min) return false;
      if (filters.price?.max && stock.lastPrice > filters.price.max) return false;
      if (filters.volume?.min && stock.volume < filters.volume.min) return false;
      return true;
    });

    return NextResponse.json({
      stocks: filteredStocks,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Screener error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stocks' },
      { status: 500 }
    );
  }
}
