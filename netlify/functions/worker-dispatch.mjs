// netlify/functions/worker-dispatch.mjs
//
// Spec 42 — Netlify Scheduled Function: one-minute UTC wake-up.
//
// Responsibilities (FR-01):
//   - Runs on `* * * * *` UTC (configured in netlify.toml [[functions]]).
//   - Performs ONLY authenticated dispatch: POSTs a fixed envelope to the
//     standalone Background Function (`worker-runner-background`).
//   - No Prisma access, no task execution, no business logic.
//   - Bounded HTTP timeout below the 30-second platform limit.
//   - No user-supplied task IDs, cron IDs, task types, or payloads.
//
// Security (FR-02, FR-03):
//   - Requires WORKER_DISPATCH_SECRET env (fail closed if missing).
//   - Bearer token sent to background function; never logged.
//   - Fixed envelope: source=scheduled, scheduledAt, nextRun (informational).
//
// The Background Function re-validates the secret on its side; the scheduled
// function is only a wake-up courier.

export const config = {
  // Schedule is also declared in netlify.toml [[functions]]. Keeping it here
  // as documentation of the contract; Netlify uses the toml value for the
  // actual trigger on published deploys.
  schedule: "* * * * *",
};

const BACKGROUND_PATH = "/.netlify/functions/worker-runner-background";
const HTTP_TIMEOUT_MS = 10_000; // well under the 30s scheduled-function cap

function backgroundUrl() {
  const base =
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.DEPLOY_URL ||
    "";
  if (!base) return null;
  // Strip trailing slash so path concatenation is stable.
  return base.replace(/\/$/, "") + BACKGROUND_PATH;
}

function isConfigured() {
  return typeof process.env.WORKER_DISPATCH_SECRET === "string" &&
    process.env.WORKER_DISPATCH_SECRET.length > 0;
}

export default async function handler(request) {
  const startedAt = Date.now();

  // Scheduled Functions send the schedule event as POST with a body containing
  // `next_run`. We only care about the trigger; the envelope is fixed.
  let scheduledAt = null;
  let nextRun = null;
  try {
    const body = request.body ? await request.json().catch(() => ({})) : {};
    scheduledAt = body.next_run ?? null;
    nextRun = body.next_run ?? null;
  } catch {
    // Ignore body parse issues — schedule-triggered invocations are trusted.
  }

  const nowIso = new Date(startedAt).toISOString();

  // Fail closed if the dispatch secret is not configured.
  if (!isConfigured()) {
    return new Response(
      JSON.stringify({
        error: "worker_dispatch_not_configured",
        message: "WORKER_DISPATCH_SECRET is not set on this deploy.",
        scheduledAt: nowIso,
      }),
      {
        status: 503,
        headers: { "content-type": "application/json" },
      },
    );
  }

  const url = backgroundUrl();
  if (!url) {
    return new Response(
      JSON.stringify({
        error: "no_site_url",
        message: "Cannot determine site URL to dispatch background function.",
        scheduledAt: nowIso,
      }),
      {
        status: 503,
        headers: { "content-type": "application/json" },
      },
    );
  }

  // Fixed envelope — no user-controlled fields.
  const envelope = {
    source: "scheduled",
    scheduledAt: nowIso,
    nextRun: nextRun ?? null,
  };

  let dispatchResult = null;
  let dispatchError = null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.WORKER_DISPATCH_SECRET}`,
      },
      body: JSON.stringify(envelope),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    dispatchResult = {
      status: resp.status,
      statusText: resp.statusText,
      ok: resp.ok,
    };

    if (!resp.ok) {
      dispatchError = `background function returned ${resp.status}`;
    }
  } catch (err) {
    // Sanitize the error message — never expose raw error details (stack
    // traces, internal URLs, or provider-specific messages) to the caller.
    dispatchError = "dispatch_failed";
  }

  const durationMs = Date.now() - startedAt;

  // Sanitized response — never leak secrets or internal details.
  return new Response(
    JSON.stringify({
      source: "scheduled",
      scheduledAt: nowIso,
      dispatched: !!dispatchResult && dispatchResult.ok,
      durationMs,
      error: dispatchError ?? null,
      backgroundStatus: dispatchResult?.status ?? null,
    }),
    {
      status: dispatchError ? 502 : 200,
      headers: { "content-type": "application/json" },
    },
  );
}
