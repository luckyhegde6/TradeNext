// netlify/functions/run-cron-background.ts
//
// Background function (Netlify): executes the Daily Recommendations pipeline
// or the Recommendation Performance check, up to the 15-minute background cap.
//
// Invoked by the scheduled functions (cron-recommendations / cron-performance)
// with an authenticated HTTP POST (`x-cron-secret` header == CRON_SECRET env).
// Returns 202 immediately — Netlify runs the payload in the background and
// retries after 1 min / 2 min if the invocation fails.
//
// Note: the service modules import via the `@/` tsconfig alias; Netlify's
// esbuild bundler resolves tsconfig `paths`, so relative imports here are not
// required (they're used only for clarity in the function entry point).

import {
  runDailyRecommendations,
  checkRecommendationPerformance,
} from "../../lib/services/dailyRecommendationService";

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

  try {
    if (action === "performance") {
      const result = await checkRecommendationPerformance();
      console.log(
        `[run-cron-background] performance done: checked=${result.checked} ` +
          `targetAchieved=${result.targetAchieved} stopLossHit=${result.stopLossHit} ` +
          `archived=${result.archived} in ${Date.now() - startedAt}ms`,
      );
    } else {
      const result = await runDailyRecommendations({ triggeredBy });
      console.log(
        `[run-cron-background] recommendations done: runId=${result.runId} ` +
          `totalStocks=${result.totalStocks} unique=${result.uniqueStocks} ` +
          `aiProcessed=${result.aiProcessed} aiFailed=${result.aiFailed} ` +
          `in ${Date.now() - startedAt}ms`,
      );
    }
    return new Response("ok", { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[run-cron-background] action=${action} failed: ${message}`, error);
    throw error; // let Netlify retry (1 min, then 2 min)
  }
};

export const config = {
  background: true,
};
