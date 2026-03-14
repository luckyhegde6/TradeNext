// lib/rate-limit.ts - Rate limiting and request tracking service
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

// In-memory rate limiting for quick checks (backup to DB)
const memoryHits = new Map<string, { count: number; ts: number }>();

// Rate limit configurations (can be moved to config/env)
const RATE_LIMITS = {
  // Default limits per minute
  default: { limit: 60, window: 60 },
  
  // NSE API endpoints - more restrictive
  nse: { limit: 30, window: 60 },
  
  // Auth endpoints
  auth: { limit: 10, window: 60 },
  
  // Admin endpoints
  admin: { limit: 100, window: 60 },
  
  // Public endpoints
  public: { limit: 120, window: 60 },
  
  // Critical endpoints (write operations)
  critical: { limit: 20, window: 60 },
};

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date | null;
  limit: number;
}

// Get rate limit config based on endpoint
function getRateLimitConfig(path: string): { limit: number; window: number } {
  // NSE endpoints
  if (path.startsWith("/api/nse/") || path.includes("nse")) {
    return RATE_LIMITS.nse;
  }
  
  // Auth endpoints
  if (path.includes("/auth/") || path.includes("/signin") || path.includes("/signup")) {
    return RATE_LIMITS.auth;
  }
  
  // Admin endpoints
  if (path.startsWith("/api/admin/")) {
    return RATE_LIMITS.admin;
  }
  
  // Write operations (POST, PUT, DELETE)
  if (path.includes("/create") || path.includes("/update") || path.includes("/delete") || 
      path.includes("/import") || path.includes("/ingest")) {
    return RATE_LIMITS.critical;
  }
  
  return RATE_LIMITS.default;
}

// Check if identifier is blocked
async function isBlocked(identifier: string): Promise<boolean> {
  try {
    const config = await prisma.rateLimitConfig.findUnique({
      where: { identifier }
    });
    return config?.isBlocked ?? false;
  } catch {
    return false;
  }
}

// Memory-based quick rate limit check (fallback)
function memoryCheckRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = memoryHits.get(key);

  if (!entry || now - entry.ts > windowMs) {
    memoryHits.set(key, { count: 1, ts: now });
    return true;
  }

  if (entry.count >= limit) return false;

  entry.count++;
  return true;
}

// Check and update rate limit
export async function checkRateLimit(
  identifier: string,
  path: string,
  identifierType: "ip" | "user" | "endpoint"
): Promise<RateLimitResult> {
  try {
    // Check if blocked
    if (await isBlocked(identifier)) {
      logger.warn({ msg: "Rate limit: Request from blocked identifier", identifier, path });
      return {
        allowed: false,
        remaining: 0,
        resetAt: null,
        limit: 0
      };
    }

    const config = getRateLimitConfig(path);
    const now = new Date();
    const windowMs = config.window * 1000;

    // Quick memory check first for performance
    const memoryKey = `${identifier}:${path}`;
    if (!memoryCheckRateLimit(memoryKey, config.limit, windowMs)) {
      // Log anomaly
      await createAnomalyAlert(
        "rate_limit_exceeded",
        "medium",
        "Rate Limit Exceeded",
        `Identifier ${identifier} exceeded rate limit for ${path}`,
        identifier,
        identifierType,
        path
      );
      
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(now.getTime() + windowMs),
        limit: config.limit
      };
    }

    // Try to persist to DB (async, don't wait)
    try {
      const rateLimit = await prisma.rateLimitConfig.findUnique({
        where: { identifier }
      });

      if (!rateLimit) {
        await prisma.rateLimitConfig.create({
          data: {
            identifier,
            identifierType,
            limit: config.limit,
            windowSeconds: config.window,
            currentCount: 1,
            resetAt: new Date(now.getTime() + windowMs)
          }
        });
      } else if (rateLimit.resetAt && now >= rateLimit.resetAt) {
        await prisma.rateLimitConfig.update({
          where: { identifier },
          data: {
            currentCount: 1,
            resetAt: new Date(now.getTime() + windowMs)
          }
        });
      } else {
        await prisma.rateLimitConfig.update({
          where: { identifier },
          data: {
            currentCount: { increment: 1 }
          }
        });
      }
    } catch (dbError) {
      // Ignore DB errors, memory check is sufficient
      logger.debug({ msg: "Rate limit DB update failed, using memory only", error: dbError });
    }

    return {
      allowed: true,
      remaining: config.limit - 1,
      resetAt: new Date(now.getTime() + windowMs),
      limit: config.limit
    };
  } catch (error) {
    logger.error({ msg: "Rate limit check error", error });
    // Fail open - allow request if rate limiting fails
    return {
      allowed: true,
      remaining: 999,
      resetAt: null,
      limit: 999
    };
  }
}

// Block an identifier
export async function blockIdentifier(
  identifier: string,
  reason: string
): Promise<void> {
  try {
    await prisma.rateLimitConfig.upsert({
      where: { identifier },
      create: {
        identifier,
        identifierType: "ip",
        isBlocked: true,
        blockReason: reason,
        limit: 0,
        windowSeconds: 0
      },
      update: {
        isBlocked: true,
        blockReason: reason
      }
    });
    
    logger.warn({ msg: "Blocked identifier", identifier, reason });
  } catch (error) {
    logger.error({ msg: "Failed to block identifier", identifier, error });
  }
}

// Unblock an identifier
export async function unblockIdentifier(identifier: string): Promise<void> {
  try {
    await prisma.rateLimitConfig.update({
      where: { identifier },
      data: {
        isBlocked: false,
        blockReason: null,
        currentCount: 0
      }
    });
    
    logger.info({ msg: "Unblocked identifier", identifier });
  } catch (error) {
    logger.error({ msg: "Failed to unblock identifier", identifier, error });
  }
}

// Create anomaly alert
async function createAnomalyAlert(
  alertType: string,
  severity: string,
  title: string,
  description: string,
  identifier?: string,
  identifierType?: string,
  endpoint?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.anomalyAlert.create({
      data: {
        alertType,
        severity,
        title,
        description,
        identifier,
        identifierType,
        endpoint,
        metadata: metadata as any
      }
    });
  } catch (error) {
    logger.error({ msg: "Failed to create anomaly alert", error });
  }
}

// Detect anomalies in request patterns
export async function detectAnomalies(
  ipAddress: string,
  path: string
): Promise<void> {
  if (!ipAddress) return;
  
  try {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    
    // Count requests in last minute from memory
    let memoryCount = 0;
    const memKey = `${ipAddress}:${path}`;
    const entry = memoryHits.get(memKey);
    if (entry && Date.now() - entry.ts < 60000) {
      memoryCount = entry.count;
    }

    // Flag if more than 100 requests per minute
    if (memoryCount > 100) {
      await createAnomalyAlert(
        "high_request_volume",
        memoryCount > 500 ? "critical" : "high",
        "High Request Volume Detected",
        `IP ${ipAddress} made ${memoryCount} requests in the last minute`,
        ipAddress,
        "ip",
        path,
        { requestCount: memoryCount, window: "1 minute" }
      );
    }

    // Check for NSE API abuse
    if (path.includes("/api/nse/") && memoryCount > 30) {
      await createAnomalyAlert(
        "unusual_api",
        "high",
        "NSE API Abuse Detected",
        `IP ${ipAddress} made ${memoryCount} NSE API calls in the last minute`,
        ipAddress,
        "ip",
        path,
        { nseCallCount: memoryCount, window: "1 minute" }
      );
    }
  } catch (error) {
    logger.error({ msg: "Anomaly detection error", error });
  }
}

// Log API request
export async function logAPIRequest(data: {
  requestId: string;
  userId?: number;
  userEmail?: string;
  ipAddress?: string;
  userAgent?: string;
  method: string;
  path: string;
  queryParams?: string;
  statusCode?: number;
  responseTime?: number;
  errorMessage?: string;
  isNSE?: boolean;
  nseEndpoint?: string;
  isRateLimited?: boolean;
  isAnomaly?: boolean;
  anomalyType?: string;
}): Promise<void> {
  try {
    await prisma.aPIRequestLog.create({
      data: {
        requestId: data.requestId,
        userId: data.userId,
        userEmail: data.userEmail,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        method: data.method,
        path: data.path,
        queryParams: data.queryParams,
        statusCode: data.statusCode,
        responseTime: data.responseTime,
        errorMessage: data.errorMessage,
        isNSE: data.isNSE ?? false,
        nseEndpoint: data.nseEndpoint,
        isRateLimited: data.isRateLimited ?? false,
        isAnomaly: data.isAnomaly ?? false,
        anomalyType: data.anomalyType
      }
    });
  } catch (error) {
    logger.error({ msg: "Failed to log API request", error });
  }
}

// Get API statistics
export async function getAPIStats(hours: number = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  try {
    const [totalRequests, nseRequests, rateLimited, anomalies, byEndpoint, byIP] = await Promise.all([
      prisma.aPIRequestLog.count({
        where: { createdAt: { gte: since } }
      }),
      prisma.aPIRequestLog.count({
        where: { isNSE: true, createdAt: { gte: since } }
      }),
      prisma.aPIRequestLog.count({
        where: { isRateLimited: true, createdAt: { gte: since } }
      }),
      prisma.anomalyAlert.count({
        where: { createdAt: { gte: since }, isResolved: false }
      }),
      prisma.aPIRequestLog.groupBy({
        by: ['path'],
        _count: true,
        where: { createdAt: { gte: since } },
        orderBy: { _count: { path: 'desc' } },
        take: 10
      }),
      prisma.aPIRequestLog.groupBy({
        by: ['ipAddress'],
        _count: true,
        where: { createdAt: { gte: since } },
        orderBy: { _count: { ipAddress: 'desc' } },
        take: 10
      })
    ]);

    return {
      totalRequests,
      nseRequests,
      rateLimited,
      anomalies,
      topEndpoints: byEndpoint.map(e => ({ path: e.path, count: e._count })),
      topIPs: byIP.map(e => ({ ip: e.ipAddress, count: e._count }))
    };
  } catch (error) {
    logger.error({ msg: "Failed to get API stats", error });
    return {
      totalRequests: 0,
      nseRequests: 0,
      rateLimited: 0,
      anomalies: 0,
      topEndpoints: [],
      topIPs: []
    };
  }
}

// Get rate limit stats
export async function getRateLimitStats() {
  try {
    const [blocked, totalConfigs] = await Promise.all([
      prisma.rateLimitConfig.count({
        where: { isBlocked: true }
      }),
      prisma.rateLimitConfig.count()
    ]);

    return { blocked, totalConfigs };
  } catch {
    return { blocked: 0, totalConfigs: 0 };
  }
}

// Get anomaly alerts
export async function getAnomalyAlerts(limit: number = 50, unresolvedOnly: boolean = false) {
  try {
    return prisma.anomalyAlert.findMany({
      where: unresolvedOnly ? { isResolved: false } : {},
      orderBy: { createdAt: 'desc' },
      take: limit
    });
  } catch {
    return [];
  }
}

// Resolve anomaly alert
export async function resolveAnomalyAlert(alertId: string, adminUserId: number) {
  return prisma.anomalyAlert.update({
    where: { id: alertId },
    data: {
      isResolved: true,
      resolvedAt: new Date(),
      resolvedBy: adminUserId
    }
  });
}

// Simple rate limit check for middleware (synchronous, memory only)
export function simpleRateLimit(key: string, limit: number = 60, windowMs: number = 60000): boolean {
  return memoryCheckRateLimit(key, limit, windowMs);
}
