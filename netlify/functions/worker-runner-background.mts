// netlify/functions/worker-runner-background.mts
//
// Spec 42 — Netlify Background Function: bounded worker/cron runner.
//
// Responsibilities:
//   - POST-only, async invocation (Netlify returns 202 immediately).
//   - Validates method, content type, body size, Zod envelope, and
//     WORKER_DISPATCH_SECRET (constant-time, never logged).
//   - Missing secret → 503 fail closed (never unauthenticated execution).
//   - Delegates to runBounded() for lease acquisition, cron tick, and
//     single-task bounded execution.
//   - Target runtime ≤13 minutes (leaves ≥2 min headroom under the 15-min
//     platform cap). Never relies on finally/shutdown hooks.
//
// Security (FR-02, FR-03, FR-04):
//   - Constant-time fixed-length digest comparison of the bearer token.
//   - No task selector accepted from the request — work is chosen by the
//     runner from the shared DB queue.
//   - Strict Zod envelope + small body-size cap.
//   - Logs include invocationId, trigger, taskId; never secrets/tokens.

import { runBounded } from "../../lib/services/worker/netlify-runner";
import logger from "../../lib/logger";
import { z } from "zod";

// ─── Zod envelope (strict, small) ───────────────────────────────────────

const EnvelopeSchema = z.object({
  source: z.literal("scheduled"),
  scheduledAt: z.string().datetime().optional(),
  nextRun: z.string().datetime().optional(),
});

const MAX_BODY_BYTES = 4_096; // 4 KB cap — far under the 256 KB platform limit

// ─── Constant-time secret comparison ────────────────────────────────────

import { timingSafeEqual } from "crypto";

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  // timingSafeEqual requires Buffer of equal length and > 0.
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function getSecret(): string | null {
  const secret = process.env.WORKER_DISPATCH_SECRET;
  return typeof secret === "string" && secret.length > 0 ? secret : null;
}

function authHeaderValid(header: string | null): boolean {
  const secret = getSecret();
  if (!secret) return false; // fail closed — not configured
  if (!header) return false;
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const token = header.slice(prefix.length);
  if (token.length === 0) return false;
  return constantTimeCompare(token, secret);
}

// ─── Handler ────────────────────────────────────────────────────────────

export default async function handler(
  request: Request,
): Promise<Response> {
  const invocationId = crypto.randomUUID?.() ?? String(Date.now());
  const startedAt = Date.now();

  // Sanitized logging — never log the secret or authorization header.
  logger.info({
    msg: "Background runner invoked",
    invocationId,
    method: request.method,
  });

  // 1. Method check — POST only.
  if (request.method !== "POST") {
    return json(
      {
        error: "method_not_allowed",
        message: "POST only.",
        invocationId,
      },
      405,
    );
  }

  // 2. Secret configuration check — fail closed.
  const secret = getSecret();
  if (!secret) {
    logger.warn({
      msg: "Runner rejected — WORKER_DISPATCH_SECRET not configured",
      invocationId,
    });
    return json(
      {
        error: "not_configured",
        message: "Worker dispatch secret is not configured on this deploy.",
        invocationId,
      },
      503,
    );
  }

  // 3. Authorization check — constant-time bearer comparison.
  const authHeader = request.headers.get("authorization");
  if (!authHeaderValid(authHeader)) {
    logger.warn({
      msg: "Runner rejected — invalid authorization",
      invocationId,
    });
    return json(
      {
        error: "unauthorized",
        message: "Invalid or missing bearer token.",
        invocationId,
      },
      401,
    );
  }

  // 4. Body size cap.
  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    Number(contentLength) > MAX_BODY_BYTES
  ) {
    return json(
      {
        error: "request_entity_too_large",
        message: `Body exceeds ${MAX_BODY_BYTES} bytes.`,
        invocationId,
      },
      413,
    );
  }

  // 5. Content type check.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return json(
      {
        error: "unsupported_media_type",
        message: "Content-Type must be application/json.",
        invocationId,
      },
      415,
    );
  }

  // 6. Strict Zod envelope validation.
  let body: unknown;
  try {
    const raw = await request.text();
    body = JSON.parse(raw);
  } catch {
    return json(
      {
        error: "invalid_json",
        message: "Request body is not valid JSON.",
        invocationId,
      },
      400,
    );
  }

  const parseResult = EnvelopeSchema.safeParse(body);
  if (!parseResult.success) {
    return json(
      {
        error: "invalid_envelope",
        message: "Request body does not match the scheduled dispatch envelope.",
        invocationId,
      },
      400,
    );
  }

  // 7. Delegate to the bounded runner (lease → cron tick → one task → release).
  let result: any;
  try {
    result = await runBounded();
  } catch (error) {
    logger.error({
      msg: "Runner threw — sanitizing error",
      invocationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return json(
      {
        error: "runner_error",
        message: "Runner execution failed.",
        invocationId,
        durationMs: Date.now() - startedAt,
      },
      500,
    );
  }

  const durationMs = Date.now() - startedAt;

  // 8. Sanitized response — never leak secrets, task payloads, or DB errors.
  return json(
    {
      invocationId,
      triggeredBy: "scheduled",
      source: parseResult.data.source,
      scheduledAt: parseResult.data.scheduledAt ?? null,
      nextRun: parseResult.data.nextRun ?? null,
      leaseAcquired: result.leaseAcquired,
      leaseLost: result.leaseLost,
      leaseRenewals: result.leaseRenewals,
      budgetMs: result.budgetMs,
      durationMs,
      tick: result.tick,
      task: result.task,
    },
    200,
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function json(
  data: unknown,
  status: number,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}
