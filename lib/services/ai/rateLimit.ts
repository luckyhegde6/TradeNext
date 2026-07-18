/**
 * AI Rate Limiter — Per-user and per-IP rate limiting with Prisma storage.
 *
 * Features:
 * - Sliding window per user (X requests per Y minutes)
 * - Per-IP rate limiting for unauthenticated requests
 * - Token-based rate limiting (total tokens per day)
 * - Automatic cooldown after repeated violations
 * - Rate limit status for headers
 */
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

// ─── Types ───────────────────────────────────────────────────────────────

export interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  tokensPerDay: number;
  cooldownMinutes: number;
  cooldownThreshold: number; // violations before cooldown
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  totalLimit: number;
  retryAfter?: number; // seconds
  cooldownUntil?: string;
  reason?: string;
}

// ─── Default configs ─────────────────────────────────────────────────────

const USER_CONFIG: RateLimitConfig = {
  requestsPerMinute: 6,
  requestsPerHour: 60,
  requestsPerDay: 200,
  tokensPerDay: 500000,
  cooldownMinutes: 30,
  cooldownThreshold: 5,
};

const ANON_CONFIG: RateLimitConfig = {
  requestsPerMinute: 2,
  requestsPerHour: 20,
  requestsPerDay: 50,
  tokensPerDay: 50000,
  cooldownMinutes: 60,
  cooldownThreshold: 3,
};

// ─── In-memory cache for fast checks ─────────────────────────────────────

interface SlidingWindow {
  timestamps: number[];
  tokenCount: number;
}

const windows = new Map<string, SlidingWindow>();

// Cleanup old windows every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, window] of windows) {
    window.timestamps = window.timestamps.filter((t) => now - t < 3600000);
    if (window.timestamps.length === 0 && window.tokenCount === 0) {
      windows.delete(key);
    }
  }
}, 300000);

// ─── Core check ──────────────────────────────────────────────────────────

/**
 * Check if a request should be rate limited.
 */
export async function checkRateLimit(
  userId: number,
  ipAddress: string,
  estimatedTokens: number = 0,
  config?: Partial<RateLimitConfig>
): Promise<RateLimitResult> {
  const isAuthenticated = userId > 0;
  const cfg = isAuthenticated ? { ...USER_CONFIG, ...config } : { ...ANON_CONFIG, ...config };
  const key = isAuthenticated ? `user:${userId}` : `ip:${ipAddress}`;
  const now = Date.now();

  // 1. Check cooldown from DB
  const cooldownKey = `cooldown:${key}`;
  const cooldownMeta = await getCooldown(key);
  if (cooldownMeta) {
    const remaining = cooldownMeta.until.getTime() - now;
    if (remaining > 0) {
      return {
        allowed: false,
        remaining: 0,
        resetMs: remaining,
        totalLimit: cfg.requestsPerMinute,
        retryAfter: Math.ceil(remaining / 1000),
        cooldownUntil: cooldownMeta.until.toISOString(),
        reason: "Cooling down after repeated violations",
      };
    }
  }

  // 2. Get or create sliding window
  let window = windows.get(key);
  if (!window) {
    window = { timestamps: [], tokenCount: 0 };
    windows.set(key, window);
  }

  // 3. Clean old timestamps (keep last 1 hour for checks)
  const oneMinuteAgo = now - 60000;
  const oneHourAgo = now - 3600000;
  const oneDayAgo = now - 86400000;

  const recentMinute = window.timestamps.filter((t) => t > oneMinuteAgo);
  const recentHour = window.timestamps.filter((t) => t > oneHourAgo);
  const recentDay = window.timestamps.filter((t) => t > oneDayAgo);

  // 4. Check limits
  if (recentMinute.length >= cfg.requestsPerMinute) {
    const oldest = recentMinute[0];
    const resetMs = oldest + 60000 - now;
    return {
      allowed: false,
      remaining: 0,
      resetMs: Math.max(0, resetMs),
      totalLimit: cfg.requestsPerMinute,
      retryAfter: Math.ceil(Math.max(0, resetMs) / 1000),
      reason: `Rate limited: ${cfg.requestsPerMinute} requests per minute`,
    };
  }

  if (recentHour.length >= cfg.requestsPerHour) {
    const oldest = recentHour[0];
    const resetMs = oldest + 3600000 - now;
    return {
      allowed: false,
      remaining: 0,
      resetMs: Math.max(0, resetMs),
      totalLimit: cfg.requestsPerHour,
      retryAfter: Math.ceil(Math.max(0, resetMs) / 1000),
      reason: `Rate limited: ${cfg.requestsPerHour} requests per hour`,
    };
  }

  if (recentDay.length >= cfg.requestsPerDay) {
    return {
      allowed: false,
      remaining: 0,
      resetMs: 86400000,
      totalLimit: cfg.requestsPerDay,
      retryAfter: 86400,
      reason: `Daily limit reached: ${cfg.requestsPerDay} requests per day`,
    };
  }

  // 5. Token-based limit
  if (window.tokenCount + estimatedTokens > cfg.tokensPerDay) {
    return {
      allowed: false,
      remaining: 0,
      resetMs: 86400000,
      totalLimit: cfg.tokensPerDay,
      retryAfter: 86400,
      reason: `Daily token limit reached: ${cfg.tokensPerDay} tokens`,
    };
  }

  // 6. Record this request
  window.timestamps.push(now);
  window.tokenCount += estimatedTokens;

  // 7. Periodically persist token count to DB
  if (window.timestamps.length % 5 === 0 && isAuthenticated) {
    persistUsage(userId, window.tokenCount).catch(() => {});
  }

  return {
    allowed: true,
    remaining: Math.max(0, cfg.requestsPerMinute - recentMinute.length - 1),
    resetMs: 60000,
    totalLimit: cfg.requestsPerMinute,
  };
}

/**
 * Record a rate limit violation for cooldown tracking.
 */
export async function recordViolation(userId: number, ipAddress: string): Promise<void> {
  const key = userId > 0 ? `user:${userId}` : `ip:${ipAddress}`;

  try {
    const record = await prisma.aIRateLimit.findFirst({
      where: { key },
    });

    if (record) {
      const violations = record.violations + 1;
      const threshold = userId > 0 ? USER_CONFIG.cooldownThreshold : ANON_CONFIG.cooldownThreshold;

      if (violations >= threshold) {
        const cooldownMinutes = userId > 0 ? USER_CONFIG.cooldownMinutes : ANON_CONFIG.cooldownMinutes;
        await prisma.aIRateLimit.update({
          where: { id: record.id },
          data: {
            violations,
            cooldownUntil: new Date(Date.now() + cooldownMinutes * 60000),
            updatedAt: new Date(),
          },
        });
      } else {
        await prisma.aIRateLimit.update({
          where: { id: record.id },
          data: { violations, updatedAt: new Date() },
        });
      }
    } else {
      await prisma.aIRateLimit.create({
        data: {
          key,
          userId: userId > 0 ? userId : null,
          ipAddress,
          violations: 1,
          tokenUsage: 0,
        },
      });
    }
  } catch (err) {
    logger.error({ msg: "Failed to record rate limit violation", key, error: err });
  }
}

/**
 * Get rate limit headers for API response.
 */
export function getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.totalLimit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetMs / 1000)),
    ...(result.retryAfter ? { "Retry-After": String(result.retryAfter) } : {}),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

async function getCooldown(key: string): Promise<{ until: Date } | null> {
  try {
    const record = await prisma.aIRateLimit.findFirst({ where: { key } });
    if (record?.cooldownUntil && record.cooldownUntil > new Date()) {
      return { until: record.cooldownUntil };
    }
    return null;
  } catch {
    return null;
  }
}

async function persistUsage(userId: number, tokenCount: number): Promise<void> {
  try {
    const key = `user:${userId}`;
    const existing = await prisma.aIRateLimit.findFirst({ where: { key } });
    if (existing) {
      await prisma.aIRateLimit.update({
        where: { id: existing.id },
        data: { tokenUsage: tokenCount, updatedAt: new Date() },
      });
    } else {
      await prisma.aIRateLimit.create({
        data: { key, userId, tokenUsage: tokenCount, violations: 0 },
      });
    }
  } catch {
    // Non-critical failure
  }
}
