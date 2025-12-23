import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { auth } from '@/lib/auth';

export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { portfolioId, type, amount, date, notes } = body;

        // Verify ownership
        const portfolio = await prisma.portfolio.findUnique({
            where: { id: portfolioId },
            select: { userId: true }
        });

        if (!portfolio || (portfolio.userId !== Number(session.user.id) && session.user.role !== 'admin')) {
            return NextResponse.json({ error: "Portfolio not found or access denied" }, { status: 403 });
        }

        const fundTransaction = await prisma.fundTransaction.create({
            data: {
                portfolioId,
                type,
                amount,
                date,
                notes
            }
        });

        return NextResponse.json(fundTransaction);
    } catch (err: any) {
        console.error('Fund Transaction Create Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
