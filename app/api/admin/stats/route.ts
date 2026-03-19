import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logHttpRequest } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(req: Request) {
    const startTime = Date.now();
    const url = req.url || '';
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 
               req.headers.get('x-real-ip') || 
               'unknown';
    const userAgent = req.headers.get('user-agent') || '';

    try {
        const session = await auth();

        if (!session || !session.user || session.user.role !== 'admin') {
            logHttpRequest('GET', url, 401, Date.now() - startTime, ip, userAgent);
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Calculate date before parallel queries
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Parallelize independent queries for better performance
        const [
            totalUsers,
            adminUsers,
            regularUsers,
            recentUsers,
            totalPortfolios,
            portfoliosWithTransactions
        ] = await Promise.all([
            prisma.user.count().catch(() => 0),
            prisma.user.count({ where: { role: 'admin' } }).catch(() => 0),
            prisma.user.count({ where: { role: 'user' } }).catch(() => 0),
            prisma.user.count({ where: { createdAt: { gte: thirtyDaysAgo } } }).catch(() => 0),
            prisma.portfolio.count().catch(() => 0),
            prisma.portfolio.count({ where: { transactions: { some: {} } } }).catch(() => 0)
        ]);

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

        // System status - check actual worker and cron job status
        let workersStatus = 'idle';
        let cronStatus = 'idle';

        try {
            // Check for running/pending tasks
            const runningTasks = await prisma.workerTask.count({
                where: { status: { in: ['pending', 'running'] } }
            }).catch(() => 0);

            if (runningTasks > 0) {
                workersStatus = 'active';
            }

            // Check for active cron jobs
            const activeCronJobs = await prisma.cronJob.count({
                where: { isActive: true }
            }).catch(() => 0);

            if (activeCronJobs > 0) {
                cronStatus = 'active';
            }
        } catch (error) {
            console.warn('Failed to get worker/cron status:', error);
        }

        const systemStatus = {
            database: dbResponseTime < 1000 ? 'healthy' : 'slow',
            cache: 'in-memory',
            workers: workersStatus,
            cron: cronStatus
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

        logHttpRequest('GET', url, 200, Date.now() - startTime, ip, userAgent);
        return NextResponse.json(stats);
    } catch (error) {
        console.error('Admin stats error:', error);
        logHttpRequest('GET', url, 500, Date.now() - startTime, ip, userAgent);
        return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
    }
}
