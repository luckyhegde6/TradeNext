import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

const CACHE_DURATION = 3600000; // 1 hour

let symbolsCache: { data: string[]; expiresAt: number } | null = null;

async function getSymbolsFromDB(): Promise<string[]> {
  if (symbolsCache && symbolsCache.expiresAt > Date.now()) {
    return symbolsCache.data;
  }

  const symbols = await prisma.dailyPrice.findMany({
    distinct: ['ticker'],
    select: { ticker: true },
    orderBy: { ticker: 'asc' },
  });

  const tickerList = symbols.map(s => s.ticker);
  
  symbolsCache = {
    data: tickerList,
    expiresAt: Date.now() + CACHE_DURATION,
  };

  return tickerList;
}

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q') || '';
    const limit = parseInt(searchParams.get('limit') || '20');

    const allSymbols = await getSymbolsFromDB();

    const filteredSymbols = query
      ? allSymbols.filter(s => s.toLowerCase().includes(query.toLowerCase())).slice(0, limit)
      : allSymbols.slice(0, limit);

    return NextResponse.json({
      symbols: filteredSymbols,
      total: allSymbols.length,
    });
  } catch (error) {
    console.error('Symbols GET error:', error);
    return NextResponse.json({ error: "Failed to fetch symbols" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    symbolsCache = null;

    const allSymbols = await getSymbolsFromDB();

    return NextResponse.json({
      symbols: allSymbols,
      total: allSymbols.length,
      message: "Cache refreshed",
    });
  } catch (error) {
    console.error('Symbols POST error:', error);
    return NextResponse.json({ error: "Failed to refresh symbols" }, { status: 500 });
  }
}
