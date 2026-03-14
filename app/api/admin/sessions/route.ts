import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getAllActiveSessions, getSessionStats, invalidateSession, invalidateAllUserSessions } from "@/lib/services/sessionService";

export const runtime = "nodejs";

/**
 * GET /api/admin/sessions
 * Get all active sessions (admin view)
 */
export async function GET(request: NextRequest) {
    try {
        const session = await auth();

        if (!session || !session.user || session.user.role !== 'admin') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Get query params
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get('userId');
        const includeUser = searchParams.get('includeUser') === 'true';

        let sessions;
        
        // Build include object conditionally
        const userInclude = includeUser ? {
            user: {
                select: {
                    id: true,
                    email: true,
                    name: true,
                    role: true,
                },
            },
        } : undefined;
        
        if (userId) {
            // Get sessions for a specific user
            sessions = await prisma.userSession.findMany({
                where: {
                    userId: parseInt(userId),
                    isActive: true,
                    expiresAt: { gt: new Date() },
                },
                orderBy: { lastActiveAt: 'desc' },
                include: userInclude,
            });
        } else {
            // Get all active sessions
            sessions = await prisma.userSession.findMany({
                where: {
                    isActive: true,
                    expiresAt: { gt: new Date() },
                },
                orderBy: { lastActiveAt: 'desc' },
                include: userInclude,
            });
        }

        // Get stats
        const stats = await getSessionStats();

        return NextResponse.json({
            sessions,
            stats,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('Admin sessions GET error:', error);
        return NextResponse.json({ error: "Failed to fetch sessions" }, { status: 500 });
    }
}

/**
 * POST /api/admin/sessions
 * Manage sessions (invalidate specific session or all user sessions)
 */
export async function POST(request: NextRequest) {
    try {
        const session = await auth();

        if (!session || !session.user || session.user.role !== 'admin') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const { action, sessionId, userId } = body;

        if (action === 'invalidate' && sessionId) {
            // Invalidate a specific session
            const success = await invalidateSession(sessionId);
            return NextResponse.json({ success, message: success ? 'Session invalidated' : 'Session not found' });
        }

        if (action === 'invalidateAll' && userId) {
            // Invalidate all sessions for a user
            const count = await invalidateAllUserSessions(parseInt(userId));
            return NextResponse.json({ success: true, count, message: `${count} sessions invalidated` });
        }

        if (action === 'invalidateAllExceptCurrent' && userId) {
            // Invalidate all sessions except the current admin's session
            const count = await invalidateAllUserSessions(parseInt(userId));
            return NextResponse.json({ success: true, count, message: `${count} sessions invalidated (except current)` });
        }

        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    } catch (error) {
        console.error('Admin sessions POST error:', error);
        return NextResponse.json({ error: "Failed to manage sessions" }, { status: 500 });
    }
}
