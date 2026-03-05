import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { auth } from '@/lib/auth';

export async function POST() {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userId = Number(session.user.id);

        await prisma.notification.updateMany({
            where: { userId, isRead: false },
            data: { isRead: true },
        });

        return NextResponse.json({ success: true });
    } catch (err) {
        console.error('Notifications read-all API error:', err);
        return NextResponse.json({ error: "Failed to mark notifications as read" }, { status: 500 });
    }
}
