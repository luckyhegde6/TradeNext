import { NextResponse } from 'next/server';
import { getPortfolioData } from '@/lib/services/portfolioService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getPortfolioData();
    return NextResponse.json(data);
  } catch (err: unknown) {
    console.error('Portfolio API error:', err);
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 500 }
    );
  }
}
