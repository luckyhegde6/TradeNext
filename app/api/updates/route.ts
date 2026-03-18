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
        const isAdmin = session.user.role === 'admin';

        // 1. Personal Notifications (for all users)
        const notifications = await prisma.notification.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: 50,
        });

        const unreadCount = await prisma.notification.count({
            where: { userId, isRead: false },
        });

        // 2. Fetch active admin announcements (for all users)
        const announcements = await prisma.adminAnnouncement.findMany({
            where: { isActive: true },
            orderBy: { createdAt: 'desc' },
            take: 10,
        });

        // 3. System-wide updates (for admins only)
        let systemUpdates: any[] = [];
        let workerTasks: any[] = [];

        if (isAdmin) {
            // Fetch recent worker tasks
            workerTasks = await (prisma as any).workerTask.findMany({
                orderBy: { createdAt: 'desc' },
                take: 20,
                include: {
                    events: {
                        orderBy: { createdAt: 'desc' },
                        take: 5
                    }
                }
            });

            // Fetch important audit logs (errors, anomalies)
            const auditLogs = await prisma.auditLog.findMany({
                where: {
                    OR: [
                        { action: { in: ['NSE_CALL', 'RATE_LIMIT', 'LOGIN_FAILURE'] } },
                        { errorMessage: { not: null } }
                    ]
                },
                orderBy: { createdAt: 'desc' },
                take: 20,
            });

            // Combine into systemUpdates for the feed
            systemUpdates = [
                ...auditLogs.map(log => ({
                    id: `audit-${log.id}`,
                    type: 'system_log',
                    title: log.action,
                    message: log.errorMessage || `Action: ${log.action} on ${log.resource || 'unknown'}`,
                    status: log.errorMessage ? 'error' : 'info',
                    createdAt: log.createdAt,
                    metadata: log.metadata
                }))
            ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        }

        return NextResponse.json({
            notifications,
            unreadCount,
            announcements,
            workerTasks: isAdmin ? workerTasks : [],
            systemUpdates: isAdmin ? systemUpdates : [],
            isAdmin
        });
    } catch (err) {
        console.error('Updates API error:', err);
        return NextResponse.json({ error: "Failed to fetch updates" }, { status: 500 });
    }
}
