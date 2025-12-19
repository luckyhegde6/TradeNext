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

        // User stats (safe queries)
        const totalUsers = await prisma.user.count().catch(() => 0);
        const adminUsers = await prisma.user.count({ where: { role: 'admin' } }).catch(() => 0);
        const regularUsers = await prisma.user.count({ where: { role: 'user' } }).catch(() => 0);

        // Recent users (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const recentUsers = await prisma.user.count({
            where: { createdAt: { gte: thirtyDaysAgo } }
        }).catch(() => 0);

        // DB health check
        let dbResponseTime = 0;
        let dbVersion = 'Unknown';

        try {
            const dbStartTime = Date.now();
            await prisma.$queryRaw`SELECT 1`;
            dbResponseTime = Date.now() - dbStartTime;

            // Get database connection info
            const dbInfo = await prisma.$queryRaw<{ version: string }[]>`
                SELECT version() as version
            `;
            dbVersion = dbInfo[0]?.version || 'Unknown';
        } catch (dbError) {
            console.warn('Database health check failed:', dbError);
            dbResponseTime = -1; // Indicate DB issue
            dbVersion = 'Connection Error';
        }

        // Portfolio stats (safe queries)
        const totalPortfolios = await prisma.portfolio.count().catch(() => 0);
        const portfoliosWithTransactions = await prisma.portfolio.count({
            where: { transactions: { some: {} } }
        }).catch(() => 0);

        // Ingest file status (check recent ingest records)
        let recentIngests: any[] = [];
        let totalProcessed = 0;

        try {
            // Check if IngestRecord model exists and has data
            if ((prisma as any).ingestRecord) {
                recentIngests = await (prisma as any).ingestRecord.findMany({
                    take: 5,
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        filename: true,
                        status: true,
                        recordsProcessed: true,
                        createdAt: true,
                        errorMessage: true
                    }
                });
                totalProcessed = recentIngests.reduce((sum, record) => sum + (record.recordsProcessed || 0), 0);
            }
        } catch (error) {
            // IngestRecord model might not exist or be empty - that's okay
            console.log('IngestRecord model not available or empty:', error);
            recentIngests = [];
            totalProcessed = 0;
        }

        // System status (simplified since we removed Redis/cron)
        const systemStatus = {
            database: dbResponseTime < 1000 ? 'healthy' : 'slow',
            cache: 'in-memory',
            workers: 'disabled',
            cron: 'disabled'
        };

        const stats = {
            users: {
                total: totalUsers,
                admin: adminUsers,
                regular: regularUsers,
                recent: recentUsers
            },
            portfolios: {
                total: totalPortfolios,
                withTransactions: portfoliosWithTransactions
            },
            database: {
                status: dbResponseTime < 0 ? 'error' : (dbResponseTime < 1000 ? 'healthy' : 'slow'),
                responseTime: dbResponseTime,
                version: dbVersion
            },
            system: systemStatus,
            ingest: {
                recent: recentIngests,
                totalProcessed: totalProcessed
            },
            timestamp: new Date().toISOString()
        };

        return NextResponse.json(stats);
    } catch (error) {
        console.error('Admin stats error:', error);
        return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
    }
}
