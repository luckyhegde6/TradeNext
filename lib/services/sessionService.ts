import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

// Session configuration
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

/**
 * Generate a secure random token using Web Crypto API
 */
function generateSecureToken(): string {
  const array = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array);
  } else {
    // Fallback for edge cases
    for (let i = 0; i < 32; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Session Service - Handles user session management in the database
 */

export interface CreateSessionParams {
  userId: number;
  ipAddress?: string;
  userAgent?: string;
  deviceInfo?: string;
  location?: string;
}

export interface SessionInfo {
  id: string;
  userId: number;
  ipAddress: string | null;
  userAgent: string | null;
  deviceInfo: string | null;
  location: string | null;
  isActive: boolean;
  expiresAt: Date;
  lastActiveAt: Date;
  createdAt: Date;
}

/**
 * Create a new user session in the database
 */
export async function createUserSession(params: CreateSessionParams): Promise<string> {
  const { userId, ipAddress, userAgent, deviceInfo, location } = params;
  
  // Generate a secure session token
  const sessionToken = generateSecureToken();
  
  // Calculate expiry (30 days from now)
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000);

  try {
    const session = await prisma.userSession.create({
      data: {
        userId,
        sessionToken,
        ipAddress,
        userAgent,
        deviceInfo,
        location,
        expiresAt,
        isActive: true,
      },
    });

    logger.info({ 
      msg: "Session: Created new session", 
      userId, 
      sessionId: session.id,
      ipAddress 
    });

    return sessionToken;
  } catch (error) {
    logger.error({ 
      msg: "Session: Failed to create session", 
      userId, 
      error: error instanceof Error ? error.message : String(error) 
    });
    throw error;
  }
}

/**
 * Invalidate a session by token
 */
export async function invalidateSession(sessionToken: string): Promise<boolean> {
  try {
    const result = await prisma.userSession.updateMany({
      where: {
        sessionToken,
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });

    logger.info({ 
      msg: "Session: Invalidated session", 
      sessionToken: sessionToken.substring(0, 8) + "...",
      count: result.count
    });

    return result.count > 0;
  } catch (error) {
    logger.error({ 
      msg: "Session: Failed to invalidate session", 
      error: error instanceof Error ? error.message : String(error) 
    });
    return false;
  }
}

/**
 * Invalidate all sessions for a user (except the current one)
 */
export async function invalidateAllUserSessions(userId: number, currentSessionToken?: string): Promise<number> {
  try {
    const whereClause: any = {
      userId,
      isActive: true,
    };

    // Exclude current session if provided
    if (currentSessionToken) {
      whereClause.NOT = { sessionToken: currentSessionToken };
    }

    const result = await prisma.userSession.updateMany({
      where: whereClause,
      data: {
        isActive: false,
      },
    });

    logger.info({ 
      msg: "Session: Invalidated all user sessions", 
      userId, 
      count: result.count 
    });

    return result.count;
  } catch (error) {
    logger.error({ 
      msg: "Session: Failed to invalidate all sessions", 
      userId,
      error: error instanceof Error ? error.message : String(error) 
    });
    return 0;
  }
}

/**
 * Update session last active timestamp
 */
export async function updateSessionActivity(sessionToken: string): Promise<boolean> {
  try {
    // Only update if the session is still valid (not expired)
    const result = await prisma.userSession.updateMany({
      where: {
        sessionToken,
        isActive: true,
        expiresAt: { gt: new Date() },
      },
      data: {
        lastActiveAt: new Date(),
      },
    });

    return result.count > 0;
  } catch (error) {
    logger.error({ 
      msg: "Session: Failed to update session activity", 
      error: error instanceof Error ? error.message : String(error) 
    });
    return false;
  }
}

/**
 * Get all active sessions for a user
 */
export async function getUserSessions(userId: number): Promise<SessionInfo[]> {
  try {
    const sessions = await prisma.userSession.findMany({
      where: {
        userId,
        isActive: true,
        expiresAt: { gt: new Date() },
      },
      orderBy: {
        lastActiveAt: "desc",
      },
      select: {
        id: true,
        userId: true,
        ipAddress: true,
        userAgent: true,
        deviceInfo: true,
        location: true,
        isActive: true,
        expiresAt: true,
        lastActiveAt: true,
        createdAt: true,
      },
    });

    return sessions;
  } catch (error) {
    logger.error({ 
      msg: "Session: Failed to get user sessions", 
      userId,
      error: error instanceof Error ? error.message : String(error) 
    });
    return [];
  }
}

/**
 * Get all active sessions (admin view - all users)
 */
export async function getAllActiveSessions(): Promise<SessionInfo[]> {
  try {
    const sessions = await prisma.userSession.findMany({
      where: {
        isActive: true,
        expiresAt: { gt: new Date() },
      },
      orderBy: {
        lastActiveAt: "desc",
      },
      select: {
        id: true,
        userId: true,
        ipAddress: true,
        userAgent: true,
        deviceInfo: true,
        location: true,
        isActive: true,
        expiresAt: true,
        lastActiveAt: true,
        createdAt: true,
      },
    });

    return sessions;
  } catch (error) {
    logger.error({ 
      msg: "Session: Failed to get all sessions", 
      error: error instanceof Error ? error.message : String(error) 
    });
    return [];
  }
}

/**
 * Clean up expired sessions (can be run as a cron job)
 */
export async function cleanupExpiredSessions(): Promise<number> {
  try {
    const result = await prisma.userSession.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { isActive: false },
        ],
      },
    });

    logger.info({ 
      msg: "Session: Cleaned up expired sessions", 
      count: result.count 
    });

    return result.count;
  } catch (error) {
    logger.error({ 
      msg: "Session: Failed to cleanup sessions", 
      error: error instanceof Error ? error.message : String(error) 
    });
    return 0;
  }
}

/**
 * Get session statistics
 */
export async function getSessionStats(): Promise<{
  total: number;
  active: number;
  expired: number;
  usersWithSessions: number;
}> {
  try {
    const now = new Date();
    
    const [total, active, expired, usersWithSessions] = await Promise.all([
      prisma.userSession.count(),
      prisma.userSession.count({
        where: { isActive: true, expiresAt: { gt: now } },
      }),
      prisma.userSession.count({
        where: { OR: [{ isActive: false }, { expiresAt: { lte: now } }] },
      }),
      prisma.userSession.groupBy({
        by: ["userId"],
        where: { isActive: true, expiresAt: { gt: now } },
      }),
    ]);

    return {
      total,
      active,
      expired,
      usersWithSessions: usersWithSessions.length,
    };
  } catch (error) {
    logger.error({ 
      msg: "Session: Failed to get session stats", 
      error: error instanceof Error ? error.message : String(error) 
    });
    return { total: 0, active: 0, expired: 0, usersWithSessions: 0 };
  }
}

/**
 * Increment user token version to invalidate all their JWT tokens
 * This forces all sessions to re-authenticate
 */
export async function invalidateUserTokens(userId: number): Promise<number> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tokenVersion: true }
    });
    
    if (!user) {
      logger.warn({ msg: "Session: User not found for token invalidation", userId });
      return -1;
    }
    
    const newVersion = user.tokenVersion + 1;
    
    await prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: newVersion }
    });
    
    // Also invalidate all sessions in the database
    await prisma.userSession.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false }
    });
    
    logger.info({ 
      msg: "Session: Invalidated all tokens for user", 
      userId, 
      newVersion 
    });
    
    return newVersion;
  } catch (error) {
    logger.error({ 
      msg: "Session: Failed to invalidate user tokens", 
      userId,
      error: error instanceof Error ? error.message : String(error) 
    });
    return -1;
  }
}
