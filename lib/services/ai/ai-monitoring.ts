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
import { randomUUID } from "crypto";

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
 * the write lands before the handler returns. Fire-and-forget callers
 * (background workers) may ignore the promise.
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

  // Persist to DB (awaited by request handlers so the write survives handler
  // completion; safe to ignore in worker contexts).
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
 * buffer dies with the process, this DB row is what makes AI monitoring
 * survive page refreshes / restarts.
 */
export async function persistAiCallToDb(entry: AiCallEntry): Promise<void> {
  try {
    // WRITE-BEHIND QUEUE (v3.22.0): land in local SQLite with a client-side
    // uuid id (idempotent bulk-flush to Prisma), zero Prisma ops per call.
    // The row is durable in SQLite (survives handler completion / restart) and
    // reaches Prisma via drainWriteBehind. The in-memory buffer still serves
    // getAiCalls immediately; the DB tier catches up on flush.
    void import("@/lib/sqlite").then(({ enqueueWriteBehind }) => {
      enqueueWriteBehind("server_log", {
        id: randomUUID(),
        level: entry.status === "error" ? "warn" : "info",
        message: `AI call: ${entry.action}`,
        source: "ai",
        task_id: `${entry.action}-${entry.model}`,
        metadata: JSON.stringify({
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
        }),
      });
    });
  } catch (err) {
    // Don't let logging failures break the app
    logger.debug({ msg: "Failed to persist AI call to DB", error: err });
  }
}

/**
 * Read AI call records that were persisted to the database OR the local
 * SQLite write-behind queue.
 *
 * Two durable tiers exist since v3.22.0:
 *   - Prisma `serverLog` (source="ai"): only the rows `drainWriteBehind`
 *     promoted (error/warn — `isWbImportant`). Survives across deploys.
 *   - Local SQLite `wb_server_log` (source="ai"): ALL AI calls land here via
 *     `enqueueWriteBehind`; info-level success calls are retained here only.
 *     Survives process restarts but is wiped on a re-deploy/restart of state.
 *
 * We read BOTH (Prisma + SQLite) so the admin page shows the full persisted
 * history (including info-level success calls) whenever the in-memory buffer
 * is cold — without any extra Prisma ops (SQLite reads are free).
 */
export async function getPersistedAiCalls(
  limit = 100,
  timeframeMinutes?: number,
): Promise<AiCallEntry[]> {
  const entries: AiCallEntry[] = [];

  // Tier 1: Prisma `serverLog` promoted rows (survive deploys).
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

    for (const log of logs) {
      const m = (log.metadata ?? {}) as Record<string, unknown>;
      if (!m.action) continue;
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
      entries.push(entry);
    }
  } catch (err) {
    logger.debug({ msg: "Failed to read persisted AI calls (Prisma)", error: err });
  }

  // Tier 2: SQLite write-behind queue (source="ai") — full history incl.
  // info-level success calls that are never promoted to Prisma. Zero Prisma ops.
  try {
    const sqlite = (await import("@/lib/sqlite")).getSqliteFallback();
    const wbRows = sqlite?.getWriteBehindLogsBySource?.("ai", limit) ?? [];
    const cutoff = timeframeMinutes
      ? Date.now() - timeframeMinutes * 60 * 1000
      : 0;
    for (const row of wbRows) {
      let m: Record<string, unknown> = {};
      if (typeof row.metadata === "string") {
        try {
          m = JSON.parse(row.metadata) as Record<string, unknown>;
        } catch {
          m = {};
        }
      } else if (row.metadata && typeof row.metadata === "object") {
        m = row.metadata as Record<string, unknown>;
      }
      if (!m.action) continue;
      const queuedAt = row.queued_at as string | undefined;
      const ts = (m.timestamp as string) ?? queuedAt;
      if (!ts) continue;
      const tsMs = new Date(ts).getTime();
      if (cutoff && !(tsMs > cutoff)) continue;
      entries.push({
        timestamp: ts,
        action: String(m.action),
        model: (m.model as string) ?? "unknown",
        status: (m.status as AiCallEntry["status"]) ?? "error",
        tokensUsed: Number(m.tokensUsed ?? 0),
        responseTimeMs: Number(m.responseTimeMs ?? 0),
        error: m.error ? String(m.error) : undefined,
        analysisType: m.analysisType ? String(m.analysisType) : undefined,
        userId: m.userId ? Number(m.userId) : undefined,
        prompt: m.prompt ? String(m.prompt) : undefined,
        result: m.result ? String(m.result) : undefined,
        userLabel: m.userLabel ? String(m.userLabel) : undefined,
      });
    }
  } catch (err) {
    logger.debug({ msg: "Failed to read persisted AI calls (SQLite wb)", error: err });
  }

  // Order newest-first; SQLite `queued_at` is chronological so rows appended to
  // the tail of this array are the newest from the queue — sort by timestamp.
  return entries
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

/**
 * Get AI calls merging the in-memory buffer with DB-persisted records.
 *
 * Both sources are combined (memory entries first, then DB records older
 * than the buffer so history is never hidden). The in-memory buffer alone is
 * not authoritative — DB logs survive restarts, so always reading
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
 * just whatever the current process happened to buffer.
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
