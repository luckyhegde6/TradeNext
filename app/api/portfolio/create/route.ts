import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { name, userId } = body;

        if (!name) {
            return NextResponse.json({ error: "Portfolio name is required" }, { status: 400 });
        }

        // Determine target userId: self or provided (if admin)
        const isAdmin = session.user.role === 'admin';
        const targetUserId = (isAdmin && userId) ? Number(userId) : Number(session.user.id);

        // Check if user already has a portfolio
        const existingPortfolio = await prisma.portfolio.findFirst({
            where: { userId: targetUserId }
        });

        if (existingPortfolio) {
            return NextResponse.json({ error: "Portfolio already exists for this user" }, { status: 400 });
        }

        const portfolio = await prisma.portfolio.create({
            data: {
                name,
                userId: targetUserId,
                currency: 'INR',
            }
        });

        return NextResponse.json(portfolio);
    } catch (err: unknown) {
        console.error('Portfolio Creation error:', err);
        return NextResponse.json(
            { error: String(err instanceof Error ? err.message : err) },
            { status: 500 }
        );
    }
}
