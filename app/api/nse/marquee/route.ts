import { NextResponse } from 'next/server';
import { nseFetch } from '@/lib/nse-client';

export async function GET() {
  // NSE may require special headers and user-agent, nseFetch should already handle this
  const data = await nseFetch(
    'https://www.nseindia.com/api/NextApi/apiClient?functionName=getMarqueData'
  );
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}

