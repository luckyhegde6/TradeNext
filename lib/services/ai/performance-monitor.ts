/**
 * AI Performance Monitor — Tracks success rates, response times, and token usage.
 *
 * Detects performance degradation via rolling-window metrics and triggers
 * alerts when thresholds are breached. Designed to complement:
 * - circuit-breaker.ts (per-provider resilience)
 * - ai-monitoring.ts (observability ring buffer)
 * - prediction-tracker.ts (outcome accuracy)
 *
 * Thresholds:
 *   Success rate <80% → warning, <60% → critical
 *   Avg response time >10s → warning, >30s → critical
 *   Token usage >80% of limit → warning
 */
import logger from "@/lib/logger";

// ─── Types ───────────────────────────────────────────────────────────────

export type AlertLevel = "normal" | "warning" | "critical";

export interface PerformanceMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  avgResponseTimeMs: number;
  avgTokensUsed: number;
  alertLevel: AlertLevel;
  alerts: string[];
}

export interface DegradationResult {
  level: AlertLevel;
  alerts: string[];
}

interface WindowEntry {
  success: boolean;
  responseTimeMs: number;
  tokensUsed: number;
  timestamp: number;
}

// ─── Thresholds ──────────────────────────────────────────────────────────

const WARN_SUCCESS_RATE = 80;
const CRIT_SUCCESS_RATE = 60;
const WARN_RESPONSE_MS = 10_000;
const CRIT_RESPONSE_MS = 30_000;
const TOKEN_WARN_PERCENT = 80;

// ─── Rolling Window ──────────────────────────────────────────────────────

class PerformanceWindow {
  private entries: WindowEntry[] = [];
  private readonly maxEntries = 100;
  private readonly windowMs = 60 * 60 * 1000; // 1 hour

  /** Record a single request outcome. */
  record(entry: Omit<WindowEntry, "timestamp">): void {
    this.entries.push({ ...entry, timestamp: Date.now() });
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  /** Compute aggregated metrics across the current window. */
  getMetrics(): PerformanceMetrics {
    this.cleanup();

    const total = this.entries.length;
    if (total === 0) {
      return {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        successRate: 100,
        avgResponseTimeMs: 0,
        avgTokensUsed: 0,
        alertLevel: "normal",
        alerts: [],
      };
    }

    let successes = 0;
    let totalResponseTime = 0;
    let totalTokens = 0;

    for (const e of this.entries) {
      if (e.success) successes++;
      totalResponseTime += e.responseTimeMs;
      totalTokens += e.tokensUsed;
    }

    const failed = total - successes;
    const successRate = Math.round((successes / total) * 100 * 100) / 100;
    const avgResponseTimeMs = Math.round(totalResponseTime / total);
    const avgTokensUsed = Math.round(totalTokens / total);

    const { level, alerts } = checkDegradation({
      totalRequests: total,
      successfulRequests: successes,
      failedRequests: failed,
      successRate,
      avgResponseTimeMs,
      avgTokensUsed,
      alertLevel: "normal",
      alerts: [],
    });

    return {
      totalRequests: total,
      successfulRequests: successes,
      failedRequests: failed,
      successRate,
      avgResponseTimeMs,
      avgTokensUsed,
      alertLevel: level,
      alerts,
    };
  }

  /** Remove entries older than the rolling window. */
  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.entries.length > 0 && this.entries[0].timestamp < cutoff) {
      this.entries.shift();
    }
  }
}

// ─── Singletons ──────────────────────────────────────────────────────────

declare global {
  var _perfWindows: Map<string, PerformanceWindow> | undefined;
}

function getWindows(): Map<string, PerformanceWindow> {
  if (!global._perfWindows) {
    global._perfWindows = new Map();
  }
  return global._perfWindows;
}

function getOrCreateWindow(name: string): PerformanceWindow {
  const windows = getWindows();
  let w = windows.get(name);
  if (!w) {
    w = new PerformanceWindow();
    windows.set(name, w);
  }
  return w;
}

/** Get the performance window for the recommendation agent. */
export function getRecommendationMetrics(): PerformanceWindow {
  return getOrCreateWindow("recommendation");
}

/** Get the performance window for a named agent. */
export function getAgentMetrics(agentName: string): PerformanceWindow {
  return getOrCreateWindow(agentName);
}

// ─── Degradation Detection ──────────────────────────────────────────────

/**
 * Check performance metrics against thresholds and return alert level + messages.
 */
export function checkDegradation(metrics: PerformanceMetrics): DegradationResult {
  const alerts: string[] = [];
  let worst: AlertLevel = "normal";

  if (metrics.totalRequests === 0) {
    return { level: "normal", alerts: [] };
  }

  // Success rate checks
  if (metrics.successRate < CRIT_SUCCESS_RATE) {
    worst = "critical";
    alerts.push(
      `Success rate CRITICAL: ${metrics.successRate}% (threshold: ${CRIT_SUCCESS_RATE}%)`
    );
  } else if (metrics.successRate < WARN_SUCCESS_RATE) {
    worst = "warning";
    alerts.push(
      `Success rate WARNING: ${metrics.successRate}% (threshold: ${WARN_SUCCESS_RATE}%)`
    );
  }

  // Response time checks
  if (metrics.avgResponseTimeMs > CRIT_RESPONSE_MS) {
    worst = "critical";
    alerts.push(
      `Avg response time CRITICAL: ${(metrics.avgResponseTimeMs / 1000).toFixed(1)}s (threshold: ${CRIT_RESPONSE_MS / 1000}s)`
    );
  } else if (metrics.avgResponseTimeMs > WARN_RESPONSE_MS) {
    if (worst !== "critical") worst = "warning";
    alerts.push(
      `Avg response time WARNING: ${(metrics.avgResponseTimeMs / 1000).toFixed(1)}s (threshold: ${WARN_RESPONSE_MS / 1000}s)`
    );
  }

  // Token usage check (against a configurable limit)
  const tokenLimit = getTokenLimit();
  if (tokenLimit > 0) {
    const tokenPercent = (metrics.avgTokensUsed / tokenLimit) * 100;
    if (tokenPercent > TOKEN_WARN_PERCENT) {
      if (worst !== "critical") worst = "warning";
      alerts.push(
        `Token usage WARNING: ${tokenPercent.toFixed(1)}% of limit (avg ${metrics.avgTokensUsed} tokens)`
      );
    }
  }

  return { level: worst, alerts };
}

// ─── Token Limit ─────────────────────────────────────────────────────────

/**
 * Resolve the effective token limit from config or environment.
 * Returns 0 if no limit is set (disables token usage alerts).
 */
function getTokenLimit(): number {
  const configLimit = process.env.AI_MAX_TOKENS;
  if (configLimit) {
    const parsed = parseInt(configLimit, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 2048; // default from config.ts getDefaultConfig()
}

// ─── Periodic Summary ────────────────────────────────────────────────────

/**
 * Log a performance summary for all tracked agents.
 * Intended to be called periodically (e.g., every 15 minutes).
 */
export function logPerformanceSummary(): void {
  const windows = getWindows();
  if (windows.size === 0) {
    logger.debug({ msg: "Performance monitor: no agents tracked yet" });
    return;
  }

  for (const [name, window] of windows) {
    const metrics = window.getMetrics();
    if (metrics.totalRequests === 0) continue;

    const logFn =
      metrics.alertLevel === "critical"
        ? logger.error
        : metrics.alertLevel === "warning"
          ? logger.warn
          : logger.info;

    logFn({
      msg: `Performance summary [${name}]`,
      totalRequests: metrics.totalRequests,
      successRate: metrics.successRate,
      avgResponseTimeMs: metrics.avgResponseTimeMs,
      avgTokensUsed: metrics.avgTokensUsed,
      alertLevel: metrics.alertLevel,
      alerts: metrics.alerts.length > 0 ? metrics.alerts : undefined,
    });
  }
}

/**
 * Get metrics for all tracked agents (useful for admin API).
 */
export function getAllAgentMetrics(): Record<string, PerformanceMetrics> {
  const windows = getWindows();
  const result: Record<string, PerformanceMetrics> = {};

  for (const [name, window] of windows) {
    result[name] = window.getMetrics();
  }

  return result;
}

/**
 * Reset all performance windows (for testing or admin override).
 */
export function resetPerformanceWindows(): void {
  getWindows().clear();
  logger.info({ msg: "Performance monitor: all windows reset" });
}
