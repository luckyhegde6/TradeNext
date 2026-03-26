import { NextResponse } from 'next/server';
import { nseFetch } from '@/lib/nse-client';

// Cache for 2 minutes - marquee updates frequently
const CACHE_CONTROL = 'public, s-maxage=120, stale-while-revalidate=180';

export async function GET() {
  // NSE may require special headers and user-agent, nseFetch should already handle this
  const data = await nseFetch(
    '/api/NextApi/apiClient?functionName=getMarqueData'
  );
  return NextResponse.json(data, { 
    headers: { 'Cache-Control': CACHE_CONTROL } 
  });
}

