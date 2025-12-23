import { NextResponse } from 'next/server';
import { getPortfolioData } from '@/lib/services/portfolioService';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    // Default to self, or use requested userId if requester is admin
    let targetUserId = Number(session.user.id);
    if (userId && session.user.role === 'admin') {
      targetUserId = Number(userId);
    }

    const data = await getPortfolioData(targetUserId);
    return NextResponse.json(data);
  } catch (err: unknown) {
    console.error('Portfolio API error:', err);
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 500 }
    );
  }
}
