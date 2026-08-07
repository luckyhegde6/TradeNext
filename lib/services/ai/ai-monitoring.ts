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
 *
 * The call is pushed to the in-memory ring buffer (fast reads) AND persisted
 * to the database. The returned promise resolves once the DB row is written —
 * callers in request handlers MUST `await` it (e.g. in a `finally` block) so
 * the serverless function does not freeze before the write lands. Fire-and-
 * forget callers (background workers) may ignore the promise.
 */
export function trackAiCall(entry: AiCallEntry): Promise<void> {
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

  // Persist to DB (awaited by request handlers so the write survives
  // serverless instance freeze; safe to ignore in worker contexts).
  return persistAiCallToDb(entry);
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
 *
 * ServerLog.source = "ai" is the durable record. Because the in-memory ring
 * buffer dies with the serverless instance, this DB row is what makes AI
 * monitoring survive page refreshes / cold starts.
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
          prompt: entry.prompt,
          result: entry.result,
          userLabel: entry.userLabel,
          timestamp: entry.timestamp,
        },
      },
    });
  } catch (err) {
    // Don't let logging failures break the app
    logger.debug({ msg: "Failed to persist AI call to DB", error: err });
  }
}

/**
 * Read AI call records that were persisted to the database.
 *
 * This is the source of truth that survives serverless instance restarts.
 * Only non-null metadata is mapped back into an {@link AiCallEntry}.
 */
export async function getPersistedAiCalls(
  limit = 100,
  timeframeMinutes?: number,
): Promise<AiCallEntry[]> {
  try {
    const where: { source: string; createdAt?: { gte: Date } } = {
      source: "ai",
    };
    if (timeframeMinutes) {
      where.createdAt = {
        gte: new Date(Date.now() - timeframeMinutes * 60 * 1000),
      };
    }

    const logs = await prisma.serverLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 500),
    });

    return logs
      .map((log) => {
        const m = (log.metadata ?? {}) as Record<string, unknown>;
        if (!m.action) return null;
        const entry: AiCallEntry = {
          timestamp:
            (m.timestamp as string) ?? log.createdAt.toISOString(),
          action: String(m.action),
          model: (m.model as string) ?? "unknown",
          status: (m.status as AiCallEntry["status"]) ?? "error",
          tokensUsed: Number(m.tokensUsed ?? 0),
          responseTimeMs: Number(m.responseTimeMs ?? 0),
        };
        if (m.error) entry.error = String(m.error);
        if (m.analysisType) entry.analysisType = String(m.analysisType);
        if (m.userId) entry.userId = Number(m.userId);
        if (m.prompt) entry.prompt = String(m.prompt);
        if (m.result) entry.result = String(m.result);
        if (m.userLabel) entry.userLabel = String(m.userLabel);
        return entry;
      })
      .filter((e): e is AiCallEntry => e !== null);
  } catch (err) {
    logger.debug({ msg: "Failed to read persisted AI calls", error: err });
    return [];
  }
}

/**
 * Get AI calls merging the in-memory buffer with DB-persisted records.
 *
 * Both sources are combined (memory entries first, then DB records older
 * than the buffer so history is never hidden). The in-memory buffer alone is
 * not authoritative — DB logs survive serverless restarts, so always reading
 * both prevents the admin page from appearing to "lose" persisted calls.
 */
export async function getAiCallsMerged(
  limit = 50,
  timeframeMinutes?: number,
): Promise<{ calls: AiCallEntry[]; source: "memory" | "database" | "hybrid" }> {
  const memoryCalls = getAiCalls(limit);
  const persisted = await getPersistedAiCalls(limit, timeframeMinutes);

  if (memoryCalls.length === 0 && persisted.length === 0) {
    return { calls: [], source: "database" };
  }
  if (memoryCalls.length === 0) {
    return { calls: persisted, source: "database" };
  }
  if (persisted.length === 0) {
    return { calls: memoryCalls, source: "memory" };
  }

  // Merge: memory first (newest, this instance), then older DB records not
  // already present in memory. Dedupe by timestamp+action+model to avoid
  // double-showing the same call.
  const seen = new Set(memoryCalls.map((c) => `${c.timestamp}|${c.action}|${c.model}`));
  const merged = [...memoryCalls];
  for (const p of persisted) {
    const key = `${p.timestamp}|${p.action}|${p.model}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(p);
    }
  }
  return { calls: merged.slice(0, limit), source: "hybrid" };
}

/**
 * Get AI stats merging the in-memory buffer with DB-persisted records.
 *
 * Stats are computed over the union of the in-memory buffer and DB-persisted
 * logs (within the timeframe) so the dashboard reflects the full history, not
 * just whatever the current serverless instance happened to buffer.
 */
export async function getAiStatsMerged(
  timeframeMinutes = 60,
): Promise<AiStats & { source: "memory" | "database" | "hybrid" }> {
  const { calls: mergedAll } = await getAiCallsMerged(1000, timeframeMinutes);

  // Apply the same timeframe cutoff used by getAiStats() so memory entries
  // outside the window are excluded (persisted rows are already filtered).
  const cutoff = Date.now() - timeframeMinutes * 60 * 1000;
  const merged = mergedAll.filter(
    (c) => new Date(c.timestamp).getTime() > cutoff,
  );

  if (merged.length === 0) {
    return { ...getAiStats(timeframeMinutes), source: "database" };
  }

  // Memory-only (no DB rows) → memory; DB-only → database; both → hybrid
  const memoryCount = getBuffer().length;
  const source: "memory" | "database" | "hybrid" =
    memoryCount > 0 && merged.length > memoryCount
      ? "hybrid"
      : memoryCount > 0
        ? "memory"
        : "database";

  const totalCalls = merged.length;
  const successCount = merged.filter((c) => c.status === "success").length;
  const errorCount = merged.filter((c) => c.status === "error").length;
  const totalTokens = merged.reduce((sum, c) => sum + (c.tokensUsed || 0), 0);
  const totalResponseTime = merged.reduce((sum, c) => sum + (c.responseTimeMs || 0), 0);

  const callsByModel: Record<string, number> = {};
  const errorsByModel: Record<string, number> = {};
  const callsByAction: Record<string, number> = {};

  for (const call of merged) {
    callsByModel[call.model] = (callsByModel[call.model] || 0) + 1;
    if (call.status === "error") {
      errorsByModel[call.model] = (errorsByModel[call.model] || 0) + 1;
    }
    callsByAction[call.action] = (callsByAction[call.action] || 0) + 1;
  }

  const recentErrors = merged
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
    source,
  };
}

/**
 * Clear the in-memory AI call buffer.
 */
export function clearAiCalls(): void {
  global._aiCalls = [];
}

/**
 * Delete persisted AI call records (source="ai") from ServerLog.
 *
 * Used by the admin "Clear Buffer" action so the durable DB log is also
 * reset — otherwise the page would re-populate from DB on the next refresh.
 */
export async function clearPersistedAiCalls(): Promise<number> {
  try {
    const result = await prisma.serverLog.deleteMany({
      where: { source: "ai" },
    });
    return result.count;
  } catch (err) {
    logger.debug({ msg: "Failed to clear persisted AI calls", error: err });
    return 0;
  }
}
