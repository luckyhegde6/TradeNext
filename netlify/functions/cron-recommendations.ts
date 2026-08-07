// netlify/functions/cron-recommendations.ts
//
// Scheduled function (Netlify): fires the Daily Recommendations background run
// at 10:00 AM IST, Monday–Friday (cron is UTC: `30 4 * * 1-5`).
//
// Netlify scheduled functions have a 30s execution cap — the ~11 min pipeline
// cannot run here. This function only fans out to the background function
// `run-cron-background` (15 min cap) via an authenticated HTTP POST, which
// returns 202 immediately.
//
// Runs only on published deploys. Test via Netlify UI "Run now" or
// `netlify functions:invoke cron-recommendations`.

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
    console.error("[cron-recommendations] CRON_SECRET not configured — background run skipped");
    return new Response("CRON_SECRET not configured", { status: 500 });
  }

  const res = await fetch(`${baseUrl}/.netlify/functions/run-cron-background`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cron-secret": secret,
    },
    body: JSON.stringify({ action: "recommendations", triggeredBy: "system" }),
  });

  console.log(
    `[cron-recommendations] next_run=${nextRun} fan-out=${res.status} in ${Date.now() - start}ms`,
  );
  return new Response(`fanned out (${res.status})`, {
    status: res.status === 202 || res.status === 200 ? 200 : res.status,
  });
};

export const config = {
  schedule: "30 4 * * 1-5", // 10:00 AM IST Mon-Fri (UTC)
};
