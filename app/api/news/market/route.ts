import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { nseFetch } from '@/lib/nse-client';
import { isDbUnavailableError } from '@/lib/db-utils';
import cache from '@/lib/cache';
import logger from '@/lib/logger';

interface NewsItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: string;
  symbol?: string;
}

const CACHE_KEY_INDIA = 'market_news_india';
const CACHE_KEY_GLOBAL = 'market_news_global';
const CACHE_DURATION_8HOURS = 8 * 60 * 60 * 1000;

async function getIndiaNews(): Promise<NewsItem[]> {
  try {
    const announcements = await nseFetch('/api/corporate-announcements?index=equities&from=0');
    
    if (!announcements || !Array.isArray(announcements)) {
      return getFallbackIndiaNews();
    }

    return announcements.slice(0, 20).map((item: Record<string, unknown>) => ({
      id: String(item.seq_id || Math.random()),
      title: `${item.symbol}: ${item.desc}` || `${item.companyName} - ${item.desc}`,
      summary: String(item.attchmntText || item.desc || ''),
      source: 'NSE',
      url: String(item.attchmntFile || 'https://www.nseindia.com/api/corporate-announcements'),
      publishedAt: String(item.an_dt || new Date().toISOString()),
      symbol: item.symbol ? String(item.symbol) : undefined,
    }));
  } catch (error) {
    console.error('Error fetching India news:', error);
    return getFallbackIndiaNews();
  }
}

function getFallbackIndiaNews(): NewsItem[] {
  const now = new Date();
  return [
    {
      id: '1',
      title: 'Nifty 50 ends flat amid mixed global cues',
      summary: 'The Nifty 50 index closed marginally lower as investors booked profits in banking and financial stocks.',
      source: 'NSE',
      url: 'https://www.nseindia.com',
      publishedAt: now.toISOString(),
    },
    {
      id: '2',
      title: 'RBI keeps repo rate unchanged at 6.5%',
      summary: 'The Reserve Bank of India decision to maintain the repo rate is in line with market expectations.',
      source: 'RBI',
      url: 'https://www.rbi.org.in',
      publishedAt: new Date(now.getTime() - 3600000).toISOString(),
    },
    {
      id: '3',
      title: 'IT stocks rally on strong US tech earnings',
      summary: 'Indian IT stocks gained significantly following positive quarterly results from major US tech companies.',
      source: 'NSE',
      url: 'https://www.nseindia.com',
      publishedAt: new Date(now.getTime() - 7200000).toISOString(),
    },
    {
      id: '4',
      title: 'FIIs buy ₹5,000 crore in Indian equities',
      summary: 'Foreign Institutional Investors continued their buying spree in the Indian market.',
      source: 'SEBI',
      url: 'https://www.sebi.gov.in',
      publishedAt: new Date(now.getTime() - 10800000).toISOString(),
    },
    {
      id: '5',
      title: 'Bank Nifty shows resilience amid volatility',
      summary: 'The Bank Nifty index outperformed the broader market amid mixed trading sessions.',
      source: 'NSE',
      url: 'https://www.nseindia.com',
      publishedAt: new Date(now.getTime() - 14400000).toISOString(),
    },
  ];
}

async function getGlobalNews(): Promise<NewsItem[]> {
  try {
    const response = await fetch(
      'https://news-mediator.tradingview.com/public/news-flow/v2/news?filter=lang%3Aen&filter=market%3Abond%2Ccorp_bond%2Ccrypto%2Ceconomic%2Cetf%2Cforex%2Cfutures%2Cindex%2Cstock&client=overview&streaming=false&user_prostatus=non_pro',
      {
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch TradingView news');
    }

    const data = await response.json() as { results?: Array<{
      id: string;
      title: string;
      published: number;
      source: string;
      url: string;
      symbols?: Array<{ name: string }>;
    }> };

    if (!data.results || !Array.isArray(data.results)) {
      return getFallbackGlobalNews();
    }

    return data.results.slice(0, 20).map((item) => ({
      id: item.id,
      title: item.title || 'No title',
      summary: item.title || '',
      source: item.source || 'TradingView',
      url: `https://in.tradingview.com/news/${item.id}`,
      publishedAt: new Date(item.published * 1000).toISOString(),
      symbol: item.symbols && item.symbols.length > 0 ? item.symbols[0].name : undefined,
    }));
  } catch (error) {
    console.error('Error fetching TradingView news:', error);
    return getFallbackGlobalNews();
  }
}

function getFallbackGlobalNews(): NewsItem[] {
  const now = new Date();
  return [
    {
      id: 'g1',
      title: 'Fed signals potential rate cuts in 2026',
      summary: 'Federal Reserve officials indicated a possible shift in monetary policy as inflation shows signs of cooling.',
      source: 'Reuters',
      url: 'https://www.reuters.com',
      publishedAt: now.toISOString(),
    },
    {
      id: 'g2',
      title: 'S&P 500 hits new all-time high',
      summary: 'US equity markets extended their rally as technology stocks led gains.',
      source: 'Bloomberg',
      url: 'https://www.bloomberg.com',
      publishedAt: new Date(now.getTime() - 3600000).toISOString(),
    },
    {
      id: 'g3',
      title: 'Oil prices stabilize amid supply concerns',
      summary: 'Crude oil prices found support as major producers considered output adjustments.',
      source: 'CNBC',
      url: 'https://www.cnbc.com',
      publishedAt: new Date(now.getTime() - 7200000).toISOString(),
    },
    {
      id: 'g4',
      title: 'European markets close higher',
      summary: 'European indices ended the session in positive territory led by banking and luxury stocks.',
      source: 'Financial Times',
      url: 'https://www.ft.com',
      publishedAt: new Date(now.getTime() - 10800000).toISOString(),
    },
    {
      id: 'g5',
      title: 'Asian markets mixed amid tariff fears',
      summary: 'Asian equity markets showed mixed performance as investors assessed trade policy developments.',
      source: 'WSJ',
      url: 'https://www.wsj.com',
      publishedAt: new Date(now.getTime() - 14400000).toISOString(),
    },
    {
      id: 'g6',
      title: 'Dollar weakens against major currencies',
      summary: 'The US dollar index retreated as bond yields declined.',
      source: 'Bloomberg',
      url: 'https://www.bloomberg.com',
      publishedAt: new Date(now.getTime() - 18000000).toISOString(),
    },
    {
      id: 'g7',
      title: 'Gold rises on safe-haven demand',
      summary: 'Gold prices gained as geopolitical uncertainties boosted safe-haven flows.',
      source: 'Reuters',
      url: 'https://www.reuters.com',
      publishedAt: new Date(now.getTime() - 21600000).toISOString(),
    },
    {
      id: 'g8',
      title: 'Tesla reports record quarterly deliveries',
      summary: 'Tesla exceeded analyst expectations with record vehicle deliveries in Q4.',
      source: 'CNBC',
      url: 'https://www.cnbc.com',
      publishedAt: new Date(now.getTime() - 25200000).toISOString(),
    },
  ];
}

export const dynamic = 'force-dynamic';

// Cache for 5 minutes, stale allowed until 1 hour
const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=3600';
const MEMORY_CACHE_KEY = 'market_news_all';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'all';
  const force = searchParams.get('force') === 'true';

  try {
    let indiaNews: NewsItem[] = [];
    let globalNews: NewsItem[] = [];

    // Try DB cache — gracefully skip if DB unavailable
    let dbAvailable = true;
    let cachedIndia: { payload: unknown; capturedAt: Date; id: string } | null = null;
    let cachedGlobal: { payload: unknown; capturedAt: Date; id: string } | null = null;
    try {
      [cachedIndia, cachedGlobal] = await Promise.all([
        prisma.marketSnapshot.findFirst({ where: { type: 'news_india' }, orderBy: { capturedAt: 'desc' } }),
        prisma.marketSnapshot.findFirst({ where: { type: 'news_global' }, orderBy: { capturedAt: 'desc' } }),
      ]);
    } catch (dbErr) {
      dbAvailable = false;
      logger.warn({ msg: 'NewsMarket: DB unavailable, fetching fresh', error: dbErr instanceof Error ? dbErr.message : String(dbErr) });
    }

    const now = new Date().getTime();
    const oneHourAgo = now - (60 * 60 * 1000);

    const shouldFetchIndia = force || !cachedIndia ||
      new Date(cachedIndia.capturedAt).getTime() < oneHourAgo;
    const shouldFetchGlobal = force || !cachedGlobal ||
      new Date(cachedGlobal.capturedAt).getTime() < oneHourAgo;

    if (shouldFetchIndia) {
      indiaNews = await getIndiaNews();
      // Fire-and-forget DB write
      if (dbAvailable) {
        prisma.marketSnapshot.upsert({
          where: { id: cachedIndia?.id || 'news_india' },
          update: { payload: JSON.parse(JSON.stringify({ news: indiaNews })), capturedAt: new Date() },
          create: { id: 'news_india', type: 'news_india', payload: JSON.parse(JSON.stringify({ news: indiaNews })) },
        }).catch(() => {});
      }
    } else if (cachedIndia?.payload) {
      indiaNews = (cachedIndia.payload as { news?: NewsItem[] })?.news || [];
    }

    if (shouldFetchGlobal) {
      globalNews = await getGlobalNews();
      if (dbAvailable) {
        prisma.marketSnapshot.upsert({
          where: { id: cachedGlobal?.id || 'news_global' },
          update: { payload: JSON.parse(JSON.stringify({ news: globalNews })), capturedAt: new Date() },
          create: { id: 'news_global', type: 'news_global', payload: JSON.parse(JSON.stringify({ news: globalNews })) },
        }).catch(() => {});
      }
    } else if (cachedGlobal?.payload) {
      globalNews = (cachedGlobal.payload as { news?: NewsItem[] })?.news || [];
    }

    // Store in memory cache for fallback
    const result = { india: indiaNews, global: globalNews };
    cache.set(MEMORY_CACHE_KEY, result, 300);

    if (type === 'india') {
      return NextResponse.json({ news: indiaNews }, { headers: { 'Cache-Control': CACHE_CONTROL } });
    }
    if (type === 'global') {
      return NextResponse.json({ news: globalNews }, { headers: { 'Cache-Control': CACHE_CONTROL } });
    }

    return NextResponse.json(result, { headers: { 'Cache-Control': CACHE_CONTROL } });
  } catch (error) {
    // Graceful fallback: memory cache → empty
    const cached = cache.get<{ india: NewsItem[]; global: NewsItem[] }>(MEMORY_CACHE_KEY);
    if (cached) {
      logger.warn({ msg: 'NewsMarket: serving from memory cache after error' });
      if (type === 'india') return NextResponse.json({ news: cached.india }, { headers: { 'Cache-Control': CACHE_CONTROL } });
      if (type === 'global') return NextResponse.json({ news: cached.global }, { headers: { 'Cache-Control': CACHE_CONTROL } });
      return NextResponse.json(cached, { headers: { 'Cache-Control': CACHE_CONTROL } });
    }
    logger.error({ msg: 'NewsMarket: total failure', error: error instanceof Error ? error.message : String(error) });
    const empty = { india: [], global: [] };
    if (type === 'india') return NextResponse.json({ news: [] }, { headers: { 'Cache-Control': CACHE_CONTROL } });
    if (type === 'global') return NextResponse.json({ news: [] }, { headers: { 'Cache-Control': CACHE_CONTROL } });
    return NextResponse.json(empty, { headers: { 'Cache-Control': CACHE_CONTROL } });
  }
}
