import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
    try {
        const session = await auth();

        if (!session || !session.user || session.user.role !== 'admin') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Get users who have been active recently (last 24 hours)
        // This is a simplified approach since we don't have real session tracking
        const oneDayAgo = new Date();
        oneDayAgo.setHours(oneDayAgo.getHours() - 24);

        // Parallelize all queries
        const oneHourAgo = new Date();
        oneHourAgo.setHours(oneHourAgo.getHours() - 1);

        const [recentUsers, lastHour, totalUsers] = await Promise.all([
            prisma.user.findMany({
                where: { updatedAt: { gte: oneDayAgo } },
                select: { id: true, name: true, email: true, role: true, updatedAt: true },
                orderBy: { updatedAt: 'desc' },
                take: 20,
            }),
            prisma.user.count({ where: { updatedAt: { gte: oneHourAgo } } }),
            prisma.user.count(),
        ]);

        const recentActivity = {
            lastHour,
            last24Hours: recentUsers.length,
            totalUsers,
        };

        return NextResponse.json({
            recentUsers,
            activity: recentActivity,
            note: "Active users based on recent profile updates (simplified tracking)",
            meta: {
                fetchedAt: new Date().toISOString(),
                stale: false,
              },
        });
    } catch (error) {
        console.error('Admin active users error:', error);
        return NextResponse.json({ error: "Failed to fetch active users" }, { status: 500 });
    }
}
