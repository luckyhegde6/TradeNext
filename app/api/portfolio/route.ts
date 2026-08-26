import { NextResponse } from 'next/server';
import { getPortfolioData } from '@/lib/services/portfolioService';
import { auth } from '@/lib/auth';
import { enhancedCache } from '@/lib/enhanced-cache';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const refresh = searchParams.get('refresh');

    // Default to self, or use requested userId if requester is admin
    let targetUserId = Number(session.user.id);
    if (userId && session.user.role === 'admin') {
      targetUserId = Number(userId);
    }

    // If refresh is requested, invalidate cache first
    if (refresh === 'true') {
      const cacheKey = `portfolio:data:${targetUserId}`;
      enhancedCache.invalidate(cacheKey);
    }

    const data = await getPortfolioData(targetUserId);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ msg: "Portfolio API error", error: msg });
    // Degrade gracefully — return empty portfolio instead of 500
    return NextResponse.json(
      {
        holdings: [],
        transactions: [],
        totalValue: 0,
        totalInvested: 0,
        totalGainLoss: 0,
        totalGainLossPercent: 0,
        warning: "Portfolio data unavailable — database may be offline",
      },
      { status: 200 }
    );
  }
}
