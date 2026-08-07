// netlify/functions/run-cron-background.ts
//
// Background function (Netlify): executes the Daily Recommendations pipeline
// or the Recommendation Performance check, up to the 15-minute background cap.
//
// Invoked by the scheduled functions (cron-recommendations / cron-performance)
// with an authenticated HTTP POST (`x-cron-secret` header == CRON_SECRET env).
// Returns 202 immediately — Netlify runs the payload in the background and
// retries after 1 min / 2 min if the invocation throws.
//
// Scheduling is handled by node-cron (v4): a fire-once task (6-field
// every-second expression + `maxExecutions: 1`) dispatches the pipeline and
// auto-destroys after a single run. The returned promise keeps the function
// alive until the job completes, within the 15-minute background cap.
//
// The service module is imported dynamically (not at module scope) so that any
// initialization error in the heavy import chain (Prisma, AI provider, etc.)
// is caught, logged, and returned — instead of crashing the function before it
// can produce a run row or emit any log line.

import cron from "node-cron";

export default async (req: Request) => {
  const secret = process.env.CRON_SECRET || "";
  const provided = req.headers.get("x-cron-secret") || "";

  if (!secret || provided !== secret) {
    console.warn("[run-cron-background] unauthorized cron invocation");
    return new Response("Unauthorized", { status: 401 });
  }

  let action = "recommendations";
  let triggeredBy = "system";
  try {
    const body = (await req.json()) as { action?: string; triggeredBy?: string };
    action = body?.action === "performance" ? "performance" : "recommendations";
    triggeredBy = body?.triggeredBy || "system";
  } catch {
    // default action
  }

  const startedAt = Date.now();
  console.log(`[run-cron-background] starting action=${action} triggeredBy=${triggeredBy}`);

  // Fire-once node-cron task. `maxExecutions: 1` ensures a single dispatch,
  // after which the task auto-destroys. The outer promise keeps the function
  // alive until the job finishes (or the safety-net timeout below).
  return await new Promise<Response>((resolve) => {
    const task = cron.schedule(
      "* * * * * *",
      async () => {
        try {
          if (action === "performance") {
            const { checkRecommendationPerformance } = await import(
              "../../lib/services/dailyRecommendationService"
            );
            const result = await checkRecommendationPerformance();
            console.log(
              `[run-cron-background] performance done: checked=${result.checked} ` +
                `targetAchieved=${result.targetAchieved} stopLossHit=${result.stopLossHit} ` +
                `archived=${result.archived} in ${Date.now() - startedAt}ms`,
            );
          } else {
            const { runDailyRecommendations } = await import(
              "../../lib/services/dailyRecommendationService"
            );
            const result = await runDailyRecommendations({ triggeredBy });
            console.log(
              `[run-cron-background] recommendations done: runId=${result.runId} ` +
                `totalStocks=${result.totalStocks} unique=${result.uniqueStocks} ` +
                `aiProcessed=${result.aiProcessed} aiFailed=${result.aiFailed} ` +
                `in ${Date.now() - startedAt}ms`,
            );
          }
          resolve(new Response("ok", { status: 200 }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[run-cron-background] action=${action} failed: ${message}`, error);
          resolve(new Response(`failed: ${message}`, { status: 500 }));
        }
      },
      { maxExecutions: 1, name: `cron-${action}-${startedAt}` },
    );

    // Safety net: never hold the function beyond the 15-minute background cap.
    setTimeout(() => {
      task.destroy();
      resolve(new Response("timeout", { status: 500 }));
    }, 14 * 60 * 1000);
  });
};

export const config = {
  background: true,
};
