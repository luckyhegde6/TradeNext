/**
 * AI Monitoring Service — Tracks OpenRouter/AI call observability
 *
 * Provides in-memory tracking of AI calls (similar to trackNseApiCall)
 * and persistent logging via ServerLog / APIRequestLog models.
 *
 * Features:
 * - In-memory ring buffer of last 1000 AI calls
 * - Aggregated stats: total calls, success rate, avg tokens, avg latency, calls by model
 * - Error tracking with model-level breakdown
 * - Integration with existing API monitoring infrastructure
 */
import logger from "@/lib/logger";
import prisma from "@/lib/prisma";

// ─── Types ───────────────────────────────────────────────────────────────

export interface AiCallEntry {
  timestamp: string;
  action: string;      // "screener" | "alerts" | "query" | "test" | "direct"
  model: string;
  status: "success" | "error" | "timeout";
  tokensUsed: number;
  responseTimeMs: number;
  error?: string;
  analysisType?: string; // "screener" | "portfolio" | "dividend" | "market" | "alert" | "general"
  userId?: number;
  /** Truncated prompt sent to the model (first 500 chars) */
  prompt?: string;
  /** Truncated result from the model (first 1000 chars) */
  result?: string;
  /** User email/name for identification */
  userLabel?: string;
}

export interface AiStats {
  totalCalls: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  avgTokens: number;
  avgResponseTimeMs: number;
  totalTokens: number;
  callsByModel: Record<string, number>;
  errorsByModel: Record<string, number>;
  callsByAction: Record<string, number>;
  recentErrors: AiCallEntry[];
  timeframeMinutes: number;
}

// ─── In-memory ring buffer ───────────────────────────────────────────────

declare global {
  var _aiCalls: AiCallEntry[] | undefined;
}

const MAX_CALLS = 1000;

function getBuffer(): AiCallEntry[] {
  if (!global._aiCalls) {
    global._aiCalls = [];
  }
  return global._aiCalls;
}

// ─── Track AI call ───────────────────────────────────────────────────────

/**
 * Record an AI call for observability.
 */
export function trackAiCall(entry: AiCallEntry): void {
  const buffer = getBuffer();
  buffer.push(entry);

  // Trim to max size
  if (buffer.length > MAX_CALLS) {
    buffer.splice(0, buffer.length - MAX_CALLS);
  }

  // Log to the main logger
  const logLevel = entry.status === "error" ? "warn" : "info";
  logger[logLevel]({
    msg: `AI call: ${entry.action}`,
    action: entry.action,
    model: entry.model,
    status: entry.status,
    tokens: entry.tokensUsed,
    responseTimeMs: entry.responseTimeMs,
    error: entry.error,
  });
}

// ─── Query functions ────────────────────────────────────────────────────

/**
 * Get recent AI calls from the in-memory buffer.
 */
export function getAiCalls(limit = 50): AiCallEntry[] {
  const buffer = getBuffer();
  return buffer.slice(-limit).reverse();
}

/**
 * Get aggregated AI call statistics.
 */
export function getAiStats(timeframeMinutes = 60): AiStats {
  const buffer = getBuffer();
  const cutoff = Date.now() - timeframeMinutes * 60 * 1000;
  const recent = buffer.filter((c) => new Date(c.timestamp).getTime() > cutoff);

  const totalCalls = recent.length;
  const successCount = recent.filter((c) => c.status === "success").length;
  const errorCount = recent.filter((c) => c.status === "error").length;
  const totalTokens = recent.reduce((sum, c) => sum + (c.tokensUsed || 0), 0);
  const totalResponseTime = recent.reduce((sum, c) => sum + (c.responseTimeMs || 0), 0);

  // Breakdowns
  const callsByModel: Record<string, number> = {};
  const errorsByModel: Record<string, number> = {};
  const callsByAction: Record<string, number> = {};

  for (const call of recent) {
    callsByModel[call.model] = (callsByModel[call.model] || 0) + 1;
    if (call.status === "error") {
      errorsByModel[call.model] = (errorsByModel[call.model] || 0) + 1;
    }
    callsByAction[call.action] = (callsByAction[call.action] || 0) + 1;
  }

  // Recent errors
  const recentErrors = recent
    .filter((c) => c.status === "error")
    .slice(-10)
    .reverse();

  return {
    totalCalls,
    successCount,
    errorCount,
    successRate: totalCalls > 0 ? Math.round((successCount / totalCalls) * 100) : 0,
    avgTokens: totalCalls > 0 ? Math.round(totalTokens / totalCalls) : 0,
    avgResponseTimeMs: totalCalls > 0 ? Math.round(totalResponseTime / totalCalls) : 0,
    totalTokens,
    callsByModel,
    errorsByModel,
    callsByAction,
    recentErrors,
    timeframeMinutes,
  };
}

/**
 * Persist an AI call to the database log for long-term storage.
 */
export async function persistAiCallToDb(entry: AiCallEntry): Promise<void> {
  try {
    await prisma.serverLog.create({
      data: {
        level: entry.status === "error" ? "warn" : "info",
        message: `AI call: ${entry.action}`,
        source: "ai",
        taskId: `${entry.action}-${entry.model}`,
        metadata: {
          action: entry.action,
          model: entry.model,
          status: entry.status,
          tokensUsed: entry.tokensUsed,
          responseTimeMs: entry.responseTimeMs,
          error: entry.error,
          analysisType: entry.analysisType,
          userId: entry.userId,
        },
      },
    });
  } catch (err) {
    // Don't let logging failures break the app
    logger.debug({ msg: "Failed to persist AI call to DB", error: err });
  }
}

/**
 * Clear the in-memory AI call buffer.
 */
export function clearAiCalls(): void {
  global._aiCalls = [];
}
