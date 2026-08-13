// netlify/functions/cron-ai-connection-test.ts
//
// Scheduled function (Netlify): fires the AI Connection Test background run
// every 30 minutes, 08:30–15:30 IST, Monday–Friday (cron is UTC:
// `*/30 3-10 * * 1-5`).
//
// WHY THIS EXISTS:
// The daily recommendations run (10:00 AM IST) silently produced all-HOLD
// results when the configured OpenRouter model was dead/misconfigured (v3.5.4
// root cause). This scheduled function fans out to `run-cron-background`
// (15 min cap) via an authenticated HTTP POST, which executes
// `executeAiConnectionTest` — a tiny probe against the configured model with
// automatic fallback probing (`openrouter/free`, `openrouter/auto`) — so a
// dead model is caught early instead of only surfacing after an all-HOLD run.
//
// Every probe attempt is persisted via trackAiCall (ServerLog.source="ai",
// action "connection_test") AND recorded in the audit log (AI_CONNECTION_TEST
// / AI_CONNECTION_TEST_FAILED with the full status); an overall failure
// notifies admins (in-app + best-effort Telegram). The run is also recorded
// against the "AI Connection Test (System)" CronJob so Admin → Utils → Cron
// shows the ledger.
//
// Netlify scheduled functions have a 30s execution cap — the probe (≤3 × 20s)
// must not run here; this only fans out to the background function (202/200).
//
// Runs only on published deploys. Test via Netlify UI "Run now" or
// `netlify functions:invoke cron-ai-connection-test`.

export default async (req: Request) => {
  const start = Date.now();

  // Scheduled invocations receive a JSON body with `next_run`.
  let nextRun = "unknown";
  try {
    const body = (await req.json()) as { next_run?: string };
    nextRun = body?.next_run ?? "unknown";
  } catch {
    // body not required for our fan-out; ignore
  }

  const baseUrl = process.env.URL || process.env.SITE_URL || "https://tradenext6.netlify.app";
  const secret = process.env.CRON_SECRET || "";

  if (!secret) {
    console.error("[cron-ai-connection-test] CRON_SECRET not configured — background run skipped");
    return new Response("CRON_SECRET not configured", { status: 500 });
  }

  const res = await fetch(`${baseUrl}/.netlify/functions/run-cron-background`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cron-secret": secret,
    },
    body: JSON.stringify({ action: "ai-connection-test", triggeredBy: "system" }),
  });

  console.log(
    `[cron-ai-connection-test] next_run=${nextRun} fan-out=${res.status} in ${Date.now() - start}ms`,
  );
  return new Response(`fanned out (${res.status})`, {
    status: res.status === 202 || res.status === 200 ? 200 : res.status,
  });
};

export const config = {
  schedule: "*/30 3-10 * * 1-5", // every 30 min, 08:30–15:30 IST Mon-Fri (UTC)
};
