import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { auth } from '@/lib/auth';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        const body = await req.json();
        const { name } = body;

        // Verify ownership
        const portfolio = await prisma.portfolio.findUnique({
            where: { id },
            select: { userId: true }
        });

        if (!portfolio || (portfolio.userId !== Number(session.user.id) && session.user.role !== 'admin')) {
            return NextResponse.json({ error: "Portfolio not found or access denied" }, { status: 403 });
        }

        const updated = await prisma.portfolio.update({
            where: { id },
            data: { name }
        });

        return NextResponse.json(updated);
    } catch (err: any) {
        console.error('Portfolio Update Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;

        // Verify ownership
        const portfolio = await prisma.portfolio.findUnique({
            where: { id },
            select: { userId: true }
        });

        if (!portfolio || (portfolio.userId !== Number(session.user.id) && session.user.role !== 'admin')) {
            return NextResponse.json({ error: "Portfolio not found or access denied" }, { status: 403 });
        }

        // Delete related data first or rely on cascade if configured
        // Transactions and FundTransactions should be deleted
        await prisma.transaction.deleteMany({ where: { portfolioId: id } });
        await prisma.fundTransaction.deleteMany({ where: { portfolioId: id } });

        await prisma.portfolio.delete({
            where: { id }
        });

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('Portfolio Delete Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
