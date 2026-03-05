import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userId = Number(session.user.id);

        const notifications = await prisma.notification.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: 20,
        });

        const unreadCount = await prisma.notification.count({
            where: { userId, isRead: false },
        });

        return NextResponse.json({ notifications, unreadCount });
    } catch (err) {
        console.error('Notifications API error:', err);
        return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
    }
}
