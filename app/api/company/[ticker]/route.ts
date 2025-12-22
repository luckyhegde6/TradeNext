import { NextResponse } from 'next/server';
import { getCompanyData } from '@/lib/services/companyService';
import { z } from 'zod';

const tickerSchema = z.string().min(1).max(10).regex(/^[A-Z0-9.]+$/);

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  try {
    const { ticker } = await params;

    // Validate ticker
    const validationResult = tickerSchema.safeParse(ticker);
    if (!validationResult.success) {
      return NextResponse.json({ error: 'Invalid ticker format' }, { status: 400 });
    }

    const data = await getCompanyData(ticker);
    return NextResponse.json(data);
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
