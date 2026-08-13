// netlify/functions/cron-market-sync.ts
//
// Scheduled function (Netlify): fires the Daily Market Sync background run at
// 06:31 AM IST, Monday–Friday (cron is UTC: `1 1 * * 1-5`).
//
// WHY THIS EXISTS:
// Netlify has no persistent process, and the in-app worker scheduler
// (lib/services/worker/worker-engine.ts `checkScheduledJobs`) only runs while
// someone hits the admin workers engine endpoint — so on prod the NSE stock
// list and corporate actions were never synced daily. Corporate-action
// ex-dates went stale and the dividend calendar showed no upcoming dividends.
// This scheduled function fans out to `run-cron-background` (15 min cap) via
// an authenticated HTTP POST, which executes:
//   1. executeStockSync          (NIFTY TOTAL MARKET stock list)
//   2. executeCorpActionsSync    (NIFTY 50 dividends/splits/bonus/rights)
//   3. executeScreenerSync       (full TradingView daily snapshot; non-fatal)
// and records the run against the "Daily Market Sync (System)" CronJob so
// Admin → Utils → Cron shows the ledger.
//
// Netlify scheduled functions have a 30s execution cap — the sync cannot run
// here; this only fans out to the background function (returns 202/200).
//
// Runs only on published deploys. Test via Netlify UI "Run now" or
// `netlify functions:invoke cron-market-sync`.

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
    console.error("[cron-market-sync] CRON_SECRET not configured — background run skipped");
    return new Response("CRON_SECRET not configured", { status: 500 });
  }

  const res = await fetch(`${baseUrl}/.netlify/functions/run-cron-background`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cron-secret": secret,
    },
    body: JSON.stringify({ action: "market-sync", triggeredBy: "system" }),
  });

  console.log(
    `[cron-market-sync] next_run=${nextRun} fan-out=${res.status} in ${Date.now() - start}ms`,
  );
  return new Response(`fanned out (${res.status})`, {
    status: res.status === 202 || res.status === 200 ? 200 : res.status,
  });
};

export const config = {
  schedule: "1 1 * * 1-5", // 06:31 AM IST Mon-Fri (UTC)
};