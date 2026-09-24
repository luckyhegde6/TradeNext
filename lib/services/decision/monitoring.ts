/**
 * Decision Engine Monitoring — in-memory performance tracing for the
 * ph22 System One decision engine (spec 17).
 *
 * Mirrors `lib/services/ai/ai-monitoring.ts` (ring buffer + aggregated stats)
 * but for decision-engine evaluations, pings, and POC gate outcomes.
 *
 * Deliberately IN-MEMORY ONLY (no Prisma, no SQLite write-behind): the engine
 * is a Laya-only mock until P1–P6 land, so traces are cheap observability for
 * the admin "Decision Engine" tab. Persistence ships with the real provider.
 *
 * Features:
 * - In-memory ring buffer of last 500 decision traces
 * - Aggregated stats: totals, success/inert/error, avg latency, avg retry
 *   attempts, questions evaluated, gates emitted
 * - Breakdowns by kind, provider, and gate outcome
 * - Recent-error capture for the admin page
 */
import type { Gate } from "./types";

// ─── Types ───────────────────────────────────────────────────────────────

export type DecisionTraceKind =
  | "evaluate"
  | "ping"
  | "poc-a-screener"
  | "poc-b-autoseed-gate";

export interface DecisionTraceEntry {
  timestamp: string;
  /** What produced the trace. */
  kind: DecisionTraceKind;
  /** Resolved provider mode ("none" | "laya"). */
  mode: "none" | "laya";
  /** Answering provider ("laya-mock") or "local" for POC fusion. */
  provider?: string;
  /** success | error | inert (engine off → evaluate returns null). */
  status: "success" | "error" | "inert";
  latencyMs: number;
  /** Retry attempts used by evaluate (1..4). */
  attempts?: number;
  error?: string;
  /** Number of questions evaluated. */
  questionCount?: number;
  /** Unique question types evaluated, e.g. ["choice","noul"]. */
  questionTypes?: string[];
  /** Gate emitted by the engine / POC outcome. */
  gate?: Gate;
  /** Gate reason / detail (e.g. "trending", "engine-off"). */
  reason?: string;
  /** POC A: results scored in the screener pass. */
  scoredCount?: number;
  /** POC A: act/review/escalate distribution of the pass. */
  gateDistribution?: { act: number; review: number; escalate: number };
  /** POC B: noul threshold read by the gate. */
  noulAmount?: number;
  /** POC B: whether the gate allowed the auto-generate. */
  allowed?: boolean;
}

export interface DecisionStats {
  totalTraces: number;
  successCount: number;
  errorCount: number;
  inertCount: number;
  successRate: number;
  avgLatencyMs: number;
  /** Average retry attempts across evaluate traces. */
  avgAttempts: number;
  /** Total questions evaluated across evaluate traces. */
  totalQuestionsEvaluated: number;
  /** Total gate outcomes recorded (POC A + POC B). */
  totalGatesEmitted: number;
  tracesByKind: Record<string, number>;
  tracesByProvider: Record<string, number>;
  tracesByGate: Record<string, number>;
  recentErrors: DecisionTraceEntry[];
  timeframeMinutes: number;
}

// ─── In-memory ring buffer ───────────────────────────────────────────────

declare global {
  var _decisionTraces: DecisionTraceEntry[] | undefined;
}

const MAX_TRACES = 500;

function getBuffer(): DecisionTraceEntry[] {
  if (!global._decisionTraces) {
    global._decisionTraces = [];
  }
  return global._decisionTraces;
}

// ─── Track decision trace ────────────────────────────────────────────────

/**
 * Record a decision-engine trace for observability.
 *
 * Pure in-memory, synchronous, never throws — callers must NOT change runtime
 * behavior because of tracing.
 */
export function trackDecisionTrace(entry: DecisionTraceEntry): void {
  const buffer = getBuffer();
  buffer.push(entry);
  if (buffer.length > MAX_TRACES) {
    buffer.splice(0, buffer.length - MAX_TRACES);
  }
}

// ─── Query functions ────────────────────────────────────────────────────

/**
 * Get recent decision traces from the in-memory buffer (newest first).
 */
export function getDecisionTraces(limit = 50): DecisionTraceEntry[] {
  const buffer = getBuffer();
  return buffer.slice(-limit).reverse();
}

function gateCount(entry: DecisionTraceEntry): {
  gate: Gate;
  count: number;
} | null {
  if (entry.status === "inert" || entry.status === "error") return null;
  if (!entry.gate) return null;
  return { gate: entry.gate, count: 1 };
}

/**
 * Get aggregated decision-engine trace statistics over a timeframe window.
 */
export function getDecisionStats(timeframeMinutes = 60): DecisionStats {
  const buffer = getBuffer();
  const cutoff = Date.now() - timeframeMinutes * 60 * 1000;
  const recent = buffer.filter(
    (t) => new Date(t.timestamp).getTime() > cutoff
  );

  const totalTraces = recent.length;
  const successCount = recent.filter((t) => t.status === "success").length;
  const errorCount = recent.filter((t) => t.status === "error").length;
  const inertCount = recent.filter((t) => t.status === "inert").length;

  const totalLatency = recent.reduce((sum, t) => sum + (t.latencyMs || 0), 0);

  // Evaluate-only aggregates (retry attempts + questions).
  const evaluateTraces = recent.filter((t) => t.kind === "evaluate");
  const attemptsSum = evaluateTraces.reduce(
    (sum, t) => sum + (t.attempts ?? 0),
    0
  );
  const questionsSum = evaluateTraces.reduce(
    (sum, t) => sum + (t.questionCount ?? 0),
    0
  );

  // Breakdowns.
  const tracesByKind: Record<string, number> = {};
  const tracesByProvider: Record<string, number> = {};
  const tracesByGate: Record<string, number> = {};

  for (const trace of recent) {
    tracesByKind[trace.kind] = (tracesByKind[trace.kind] || 0) + 1;
    if (trace.provider) {
      tracesByProvider[trace.provider] =
        (tracesByProvider[trace.provider] || 0) + 1;
    }
    const g = gateCount(trace);
    if (g) tracesByGate[g.gate] = (tracesByGate[g.gate] || 0) + g.count;
  }

  const recentErrors = recent
    .filter((t) => t.status === "error")
    .slice(-5)
    .reverse();

  return {
    totalTraces,
    successCount,
    errorCount,
    inertCount,
    successRate: totalTraces > 0 ? Math.round((successCount / totalTraces) * 100) : 0,
    avgLatencyMs: totalTraces > 0 ? Math.round(totalLatency / totalTraces) : 0,
    avgAttempts:
      evaluateTraces.length > 0
        ? Math.round((attemptsSum / evaluateTraces.length) * 10) / 10
        : 0,
    totalQuestionsEvaluated: questionsSum,
    totalGatesEmitted: Object.values(tracesByGate).reduce((s, v) => s + v, 0),
    tracesByKind,
    tracesByProvider,
    tracesByGate,
    recentErrors,
    timeframeMinutes,
  };
}

/**
 * Clear the in-memory decision trace buffer.
 */
export function clearDecisionTraces(): void {
  global._decisionTraces = [];
}