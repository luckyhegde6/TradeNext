/**
 * Trace-ID & Correlation-ID System
 *
 * Provides distributed tracing context for log correlation across API routes,
 * service calls, and background jobs. Uses Node.js AsyncLocalStorage for
 * per-request context propagation.
 *
 * @module lib/trace
 * @version 3.3.0
 */

import { AsyncLocalStorage } from "async_hooks";
import { randomBytes } from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────

/** Trace context carried through a request lifecycle. */
export interface TraceContext {
  /** Unique trace ID — identifies the full request chain. */
  traceId: string;
  /** Correlation ID — links related operations within a trace. */
  correlationId: string;
  /** Span ID — identifies a single operation within a trace. */
  spanId: string;
  /** Human-readable label for the current operation. */
  operation?: string;
  /** Parent span ID if this is a child operation. */
  parentSpanId?: string;
  /** Timestamp when this context was created. */
  startedAt: number;
}

/** Options for creating a child span. */
export interface SpanOptions {
  operation: string;
  parentSpanId?: string;
}

// ─── AsyncLocalStorage ───────────────────────────────────────────────────

const traceStorage = new AsyncLocalStorage<TraceContext>();

// ─── ID Generation ───────────────────────────────────────────────────────

/**
 * Generate a compact trace ID (16 hex chars).
 * Example: "a1b2c3d4e5f67890"
 */
export function generateTraceId(): string {
  return randomBytes(8).toString("hex");
}

/**
 * Generate a compact span ID (8 hex chars).
 * Example: "f6e5d4c3"
 */
export function generateSpanId(): string {
  return randomBytes(4).toString("hex");
}

/**
 * Generate a correlation ID (12 hex chars).
 * Used to link related operations across services.
 */
export function generateCorrelationId(): string {
  return randomBytes(6).toString("hex");
}

// ─── Context Management ──────────────────────────────────────────────────

/**
 * Create a new root trace context.
 *
 * @param operation  Name of the top-level operation (e.g. "GET /api/recommendations")
 * @param incomingHeaders  Optional incoming request headers to extract trace IDs from
 */
export function createTraceContext(
  operation?: string,
  incomingHeaders?: Record<string, string | undefined>,
): TraceContext {
  // Reuse incoming trace ID if present (for distributed tracing)
  const traceId =
    incomingHeaders?.["x-trace-id"] ||
    incomingHeaders?.["x-request-id"] ||
    generateTraceId();

  // Reuse incoming correlation ID or generate new one
  const correlationId =
    incomingHeaders?.["x-correlation-id"] || generateCorrelationId();

  return {
    traceId,
    correlationId,
    spanId: generateSpanId(),
    operation,
    startedAt: Date.now(),
  };
}

/**
 * Create a child span from the current trace context.
 */
export function createChildSpan(options: SpanOptions): TraceContext {
  const parent = traceStorage.getStore();
  if (!parent) {
    // No parent context — create a root context
    return createTraceContext(options.operation);
  }

  return {
    traceId: parent.traceId,
    correlationId: parent.correlationId,
    spanId: generateSpanId(),
    operation: options.operation,
    parentSpanId: options.parentSpanId || parent.spanId,
    startedAt: Date.now(),
  };
}

/**
 * Run a function within a trace context.
 * The context is available via `getTraceContext()` inside the callback.
 */
export function withTrace<T>(
  context: TraceContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return traceStorage.run(context, fn);
}

/**
 * Get the current trace context (if any).
 * Returns `undefined` when called outside a trace context.
 */
export function getTraceContext(): TraceContext | undefined {
  return traceStorage.getStore();
}

/**
 * Get the current trace context, or create a new one if none exists.
 */
export function getOrCreateTraceContext(operation?: string): TraceContext {
  return traceStorage.getStore() || createTraceContext(operation);
}

// ─── Formatting Helpers ──────────────────────────────────────────────────

/**
 * Format a trace context as a log prefix string.
 * Example: "[trace=a1b2c3d4 span=f6e5d4c3 corr=x9y8z7]"
 */
export function formatTracePrefix(ctx?: TraceContext): string {
  const c = ctx || traceStorage.getStore();
  if (!c) return "";
  return `[trace=${c.traceId} span=${c.spanId} corr=${c.correlationId}]`;
}

/**
 * Extract trace headers from a context for forwarding to downstream services.
 */
export function getTraceHeaders(ctx?: TraceContext): Record<string, string> {
  const c = ctx || traceStorage.getStore();
  if (!c) return {};
  return {
    "x-trace-id": c.traceId,
    "x-correlation-id": c.correlationId,
    "x-span-id": c.spanId,
  };
}

/**
 * Calculate elapsed time since the trace context was created.
 */
export function getTraceElapsed(ctx?: TraceContext): number {
  const c = ctx || traceStorage.getStore();
  if (!c) return 0;
  return Date.now() - c.startedAt;
}

// ─── Middleware Helper ────────────────────────────────────────────────────

/**
 * Extract trace context from Next.js request headers.
 * Use this in API route handlers to continue an incoming trace.
 *
 * @example
 * ```ts
 * export async function GET(req: NextRequest) {
 *   const ctx = extractTraceFromRequest(req, "GET /api/recommendations");
 *   return withTrace(ctx, async () => {
 *     logger.info({ msg: "Handling request", ...traceFields(ctx) });
 *     // ... handler logic
 *   });
 * }
 * ```
 */
export function extractTraceFromRequest(
  req: { headers: { get?: (name: string) => string | null } },
  operation?: string,
): TraceContext {
  const get = req.headers.get;
  const headers: Record<string, string | undefined> = {};
  if (get) {
    const traceId = get("x-trace-id");
    const correlationId = get("x-correlation-id");
    const requestId = get("x-request-id");
    if (traceId) headers["x-trace-id"] = traceId;
    if (correlationId) headers["x-correlation-id"] = correlationId;
    if (requestId) headers["x-request-id"] = requestId;
  }
  return createTraceContext(operation, headers);
}

/**
 * Helper to spread trace context fields into a log object.
 *
 * @example
 * ```ts
 * logger.info({ msg: "Processing stock", symbol, ...traceFields() });
 * ```
 */
export function traceFields(ctx?: TraceContext): {
  traceId: string;
  correlationId: string;
  spanId: string;
} {
  const c = ctx || traceStorage.getStore();
  if (!c) {
    return { traceId: "none", correlationId: "none", spanId: "none" };
  }
  return {
    traceId: c.traceId,
    correlationId: c.correlationId,
    spanId: c.spanId,
  };
}
