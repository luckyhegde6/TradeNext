import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getAllActiveSessions, getSessionStats, invalidateSession, invalidateAllUserSessions, invalidateUserTokens } from "@/lib/services/sessionService";

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
            // Invalidate all sessions AND JWT tokens for a user (force complete logout)
            const userIdNum = parseInt(userId);
            const tokenVersion = await invalidateUserTokens(userIdNum);
            if (tokenVersion >= 0) {
                return NextResponse.json({ 
                    success: true, 
                    message: 'All sessions and JWT tokens invalidated. User will be logged out.',
                    tokenVersion 
                });
            }
            return NextResponse.json({ success: false, error: 'Failed to invalidate tokens' }, { status: 500 });
        }

        if (action === 'invalidateAllExceptCurrent' && userId) {
            // Invalidate all sessions except the current admin's session (database only)
            const count = await invalidateAllUserSessions(parseInt(userId));
            return NextResponse.json({ success: true, count, message: `${count} sessions invalidated (database only)` });
        }

        if (action === 'invalidateTokens' && userId) {
            // Invalidate only JWT tokens (database sessions remain, but JWT becomes invalid)
            const userIdNum = parseInt(userId);
            const tokenVersion = await invalidateUserTokens(userIdNum);
            if (tokenVersion >= 0) {
                return NextResponse.json({ 
                    success: true, 
                    message: 'JWT tokens invalidated. User will be logged out on next request.',
                    tokenVersion 
                });
            }
            return NextResponse.json({ success: false, error: 'Failed to invalidate tokens' }, { status: 500 });
        }

        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    } catch (error) {
        console.error('Admin sessions POST error:', error);
        return NextResponse.json({ error: "Failed to manage sessions" }, { status: 500 });
    }
}
