import { NextResponse } from 'next/server';
import { nseFetch } from '@/lib/nse-client';
import cache from '@/lib/cache';
import logger from '@/lib/logger';

const CACHE_KEY = 'nse:marquee:data';
const CACHE_CONTROL = 'public, s-maxage=120, stale-while-revalidate=180';

export async function GET() {
  try {
    const data = await nseFetch('/api/NextApi/apiClient?functionName=getMarqueData');
    cache.set(CACHE_KEY, data, 120);
    return NextResponse.json(data, { headers: { 'Cache-Control': CACHE_CONTROL } });
  } catch (error) {
    const cached = cache.get(CACHE_KEY);
    if (cached) {
      logger.warn({ msg: 'Marquee: NSE failed, serving cache' });
      return NextResponse.json(cached, { headers: { 'Cache-Control': CACHE_CONTROL } });
    }
    logger.warn({ msg: 'Marquee: NSE failed, returning empty', error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ indices: [] });
  }
}

