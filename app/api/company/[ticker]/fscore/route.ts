import { NextResponse } from 'next/server';
import { getFinancialScore, generateMockFScore } from '@/lib/services/fscore-service';
import { z } from 'zod';

const tickerSchema = z.string().min(1).max(10).regex(/^[A-Z0-9.]+$/);

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  try {
    const { ticker } = await params;

    const validationResult = tickerSchema.safeParse(ticker);
    if (!validationResult.success) {
      return NextResponse.json({ error: 'Invalid ticker format' }, { status: 400 });
    }

    const score = await getFinancialScore(ticker);
    
    if (!score) {
      const mockScore = generateMockFScore(ticker);
      return NextResponse.json({
        ...mockScore,
        isMock: true,
        message: 'No financial data available - showing simulated score'
      });
    }

    return NextResponse.json(score);
  } catch (err: unknown) {
    console.error('F-Score API error:', err);
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 500 }
    );
  }
}
