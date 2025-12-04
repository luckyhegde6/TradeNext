import { NextResponse } from 'next/server';
import { getCompanyData } from '@/lib/services/companyService';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  try {
    const { ticker } = await params;
    const data = await getCompanyData(ticker);
    return NextResponse.json(data);
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
