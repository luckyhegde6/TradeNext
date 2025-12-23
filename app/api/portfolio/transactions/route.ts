import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { auth } from '@/lib/auth';
import symbolsData from "@/lib/constants/symbols.json";
import { invalidatePortfolioCache } from '@/lib/services/portfolioService';

export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { portfolioId, ticker, side, quantity, price, tradeDate, fees, notes } = body;

        // Validate ticker against constants
        const isValid = (symbolsData as { symbol: string }[]).some(s => s.symbol === ticker?.toUpperCase());
        if (!isValid) {
            return NextResponse.json({ error: `Invalid symbol: ${ticker}. Please select a valid NSE symbol.` }, { status: 400 });
        }

        // Verify ownership
        const portfolio = await prisma.portfolio.findUnique({
            where: { id: portfolioId },
            select: { userId: true }
        });

        if (!portfolio || (portfolio.userId !== Number(session.user.id) && session.user.role !== 'admin')) {
            return NextResponse.json({ error: "Portfolio not found or access denied" }, { status: 403 });
        }

        const transaction = await prisma.transaction.create({
            data: {
                portfolioId,
                ticker: ticker.toUpperCase(),
                side,
                quantity,
                price,
                tradeDate,
                fees,
                notes
            }
        });

        // Invalidate cache on change
        invalidatePortfolioCache(portfolio.userId);

        return NextResponse.json(transaction);
    } catch (err: any) {
        console.error('Transaction Create Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
