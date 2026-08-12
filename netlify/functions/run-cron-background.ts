// netlify/functions/run-cron-background.ts
//
// Background function (Netlify): executes the Daily Recommendations pipeline,
// the Recommendation Performance check, or the Daily Market Sync, up to the
// 15-minute background cap.
//
// Invoked by the scheduled functions (cron-recommendations / cron-performance
// / cron-market-sync) with an authenticated HTTP POST (`x-cron-secret` header
// == CRON_SECRET env). Returns 202 immediately — Netlify runs the payload in
// the background and retries after 1 min / 2 min if the invocation throws.
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
    const knownActions = new Set(["performance", "market-sync", "ai-connection-test"]);
    action = body?.action && knownActions.has(body.action) ? body.action : "recommendations";
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
        // Ledger helper: records the run against the SYSTEM-managed CronJob
        // so Admin → Utils → Cron shows lastRun/runCount/success/failure.
        // Best-effort; never throws.
        const recordRun = (success: boolean) =>
          import("../../lib/services/recommendationCronService").then((m) =>
            m.recordCronRun(
              action === "performance"
                ? m.RECOMMENDATION_PERFORMANCE_CRON_NAME
                : action === "market-sync"
                  ? m.MARKET_SYNC_CRON_NAME
                  : action === "ai-connection-test"
                    ? m.AI_CONNECTION_TEST_CRON_NAME
                    : m.RECOMMENDATION_CRON_NAME,
              success,
            ),
          );

        try {
          if (action === "performance") {
            const { checkRecommendationPerformance } = await import(
              "../../lib/services/dailyRecommendationService"
            );
            const result = await checkRecommendationPerformance();
            await recordRun(true);
            console.log(
              `[run-cron-background] performance done: checked=${result.checked} ` +
                `targetAchieved=${result.targetAchieved} stopLossHit=${result.stopLossHit} ` +
                `archived=${result.archived} in ${Date.now() - startedAt}ms`,
            );
          } else if (action === "market-sync") {
            const { executeStockSync, executeCorpActionsSync } = await import(
              "../../lib/services/worker/worker-service"
            );

            // Daily market data sync (06:31 AM IST Mon-Fri via cron-market-sync).
            // 1) Stock list (NIFTY TOTAL MARKET) — keeps symbols/company names fresh
            //    for screeners, dividend enrichment and the stock pickers.
            const stocks = await executeStockSync({ indexName: "NIFTY TOTAL MARKET" });
            // 2) Corporate actions (dividends/splits/bonus/rights, NIFTY 50) — the
            //    primary prod gap: without a daily run, ex-dates go stale and the
            //    dividend calendar shows no upcoming dividends.
            const corp = await executeCorpActionsSync({ indexName: "NIFTY 50" });
            // 3) Full TradingView screener snapshot (daily status baseline; also
            //    warms the Chartink-unified runner's fallback universe).
            let screener: unknown = null;
            try {
              const { executeScreenerSync } = await import(
                "../../lib/services/worker/worker-service"
              );
              screener = await executeScreenerSync();
            } catch (screenerError) {
              // A screener failure must not fail the whole market sync — the
              // stock list + corp actions already landed.
              console.warn(
                "[run-cron-background] market-sync screener snapshot failed (non-fatal)",
                screenerError,
              );
            }
            await recordRun(true);
            console.log(
              `[run-cron-background] market-sync done: ` +
                `stocks=${String((stocks as { total?: number })?.total ?? "?")} ` +
                `corp=${String((corp as { total?: number })?.total ?? "?")} ` +
                `screener=${screener ? "ok" : "skipped"} in ${Date.now() - startedAt}ms`,
            );
          } else if (action === "ai-connection-test") {
            const { executeAiConnectionTest } = await import(
              "../../lib/services/worker/worker-service"
            );
            const report = (await executeAiConnectionTest()) as {
              status?: string;
              configuredModel?: string;
              recommendedModel?: string;
            };
            await recordRun(true);
            console.log(
              `[run-cron-background] ai-connection-test done: status=${report?.status ?? "?"} ` +
                `model=${report?.configuredModel ?? "?"} ` +
                `recommended=${report?.recommendedModel ?? "-"} in ${Date.now() - startedAt}ms`,
            );
          } else {
            const { runDailyRecommendations } = await import(
              "../../lib/services/dailyRecommendationService"
            );
            const result = await runDailyRecommendations({ triggeredBy });
            await recordRun(true);
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
          await recordRun(false).catch(() => {}); // record the failure in the ledger
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
