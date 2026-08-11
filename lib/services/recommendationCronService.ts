// lib/services/recommendationCronService.ts
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { calculateNextRun } from "@/lib/cron-parser";

/**
 * Self-healing cron jobs for the Daily Recommendations engine (v3.5.0)
 * plus the Daily Market Sync (v3.5.8).
 *
 * Ensures the three SYSTEM-managed jobs exist and are active:
 *   - Daily Recommendations          `30 4 * * 1-5`   = 10:00 AM IST (Mon-Fri)
 *   - Recommendation Performance     `30 10 * * 1-5`  = 04:00 PM IST (Mon-Fri)
 *   - Daily Market Sync              `1 1 * * 1-5`    = 06:31 AM IST (Mon-Fri)
 *
 * The Market Sync job exists for the ledger + admin visibility: on Netlify the
 * actual morning sync runs via the scheduled function cron-market-sync → the
 * `market-sync` action of netlify/functions/run-cron-background.ts, which
 * records the run against MARKET_SYNC_CRON_NAME (same as the two
 * recommendation jobs). It never flows through the worker scheduler loop.
 *
 * Times are UTC: IST = UTC + 5:30. The worker scheduler (worker-engine.ts)
 * picks up due jobs via `nextRun` and spawns tasks through `spawnCronTask`,
 * which marks them `triggeredBy: "cron"`. Admin-triggered runs pass
 * `triggeredBy: "system"` to distinguish system-spawned tasks.
 *
 * Idempotent: safe to call on every worker/scheduler start and from the
 * admin recommendations GET handler (upsert by stable name).
 */
export const RECOMMENDATION_CRON_NAME = "Daily Recommendations (System)";
export const RECOMMENDATION_PERFORMANCE_CRON_NAME = "Recommendation Performance Check (System)";
export const MARKET_SYNC_CRON_NAME = "Daily Market Sync (System)";
export const RECOMMENDATION_CRON_EXPR = "30 4 * * 1-5"; // 10:00 AM IST Mon-Fri
export const RECOMMENDATION_PERFORMANCE_CRON_EXPR = "30 10 * * 1-5"; // 04:00 PM IST Mon-Fri
export const MARKET_SYNC_CRON_EXPR = "1 1 * * 1-5"; // 06:31 AM IST Mon-Fri (UTC 01:01)

export interface EnsureRecommendationCronsResult {
  ensured: number;
  jobs: Array<{ name: string; taskType: string; cronExpression: string }>;
}

export interface RecordCronRunResult {
  found: boolean;
  lastRun?: Date | null;
  runCount?: number;
  successCount?: number;
  failureCount?: number;
  nextRun?: Date | null;
}

/**
 * Record an execution of a SYSTEM-managed recommendation cron job.
 *
 * WHY THIS EXISTS:
 * On Netlify (serverless) the actual scheduled runs execute directly via
 * netlify/functions/run-cron-background.ts → runDailyRecommendations() /
 * checkRecommendationPerformance() — they never pass through
 * spawnCronTask() or the resident worker-engine scheduler loop, so the
 * CronJob ledger (lastRun / runCount / successCount / failureCount /
 * nextRun) stayed at defaults and the Admin → Utils → Cron page showed
 * "no recent runs". successCount/failureCount previously had NO writer.
 *
 * This is the single ledger-writer for the real execution paths:
 *   - netlify/functions/run-cron-background.ts (scheduled runs, success+failure)
 *   - app/api/admin/workers/route.ts PATCH runNow/retry (manual runs for
 *     tasks WITHOUT a cronJobId — cronJobId-linked tasks are already counted
 *     at spawn time by spawnCronTask, so we skip them to avoid double-count)
 *
 * Job is located by stable name (idempotent with ensureRecommendationCrons).
 * Safe no-op (found:false) when the job does not exist — never throws.
 */
export async function recordCronRun(jobName: string, success: boolean): Promise<RecordCronRunResult> {
  try {
    const job = await prisma.cronJob.findFirst({ where: { name: jobName } });
    if (!job) {
      logger.warn({ msg: "recordCronRun: cron job not found (no-op)", jobName });
      return { found: false };
    }

    const nextRun = calculateNextRun(job.cronExpression);
    const updated = await prisma.cronJob.update({
      where: { id: job.id },
      data: {
        lastRun: new Date(),
        runCount: { increment: 1 },
        successCount: success ? { increment: 1 } : undefined,
        failureCount: success ? undefined : { increment: 1 },
        nextRun,
      },
    });

    logger.info({
      msg: "Recorded cron job run",
      jobName,
      success,
      runCount: updated.runCount,
      successCount: updated.successCount,
      failureCount: updated.failureCount,
      nextRun: updated.nextRun,
    });

    return {
      found: true,
      lastRun: updated.lastRun,
      runCount: updated.runCount,
      successCount: updated.successCount,
      failureCount: updated.failureCount,
      nextRun: updated.nextRun,
    };
  } catch (error) {
    logger.error({ msg: "Failed to record cron job run (non-fatal)", jobName, error });
    return { found: false };
  }
}

export async function ensureRecommendationCrons(): Promise<EnsureRecommendationCronsResult> {
  const definitions = [
    {
      name: RECOMMENDATION_CRON_NAME,
      description: "System-managed daily recommendation generation (10:00 AM IST, Mon-Fri)",
      taskType: "recommendations",
      cronExpression: RECOMMENDATION_CRON_EXPR,
    },
    {
      name: RECOMMENDATION_PERFORMANCE_CRON_NAME,
      description: "System-managed recommendation performance check + archival (04:00 PM IST, Mon-Fri)",
      taskType: "recommendation_performance",
      cronExpression: RECOMMENDATION_PERFORMANCE_CRON_EXPR,
    },
    {
      name: MARKET_SYNC_CRON_NAME,
      description: "System-managed daily NSE market sync — corporate actions + stock list (06:31 AM IST, Mon-Fri)",
      taskType: "market_data",
      cronExpression: MARKET_SYNC_CRON_EXPR,
    },
  ];

  const jobs: EnsureRecommendationCronsResult["jobs"] = [];
  let ensured = 0;

  for (const def of definitions) {
    try {
      const existing = await prisma.cronJob.findFirst({
        where: { name: def.name },
      });

      const nextRun = calculateNextRun(def.cronExpression);

      if (existing) {
        // Self-heal: keep the job active + fix schedule if drifted
        const changed =
          existing.isActive !== true ||
          existing.taskType !== def.taskType ||
          existing.cronExpression !== def.cronExpression;

        if (changed) {
          await prisma.cronJob.update({
            where: { id: existing.id },
            data: {
              taskType: def.taskType,
              cronExpression: def.cronExpression,
              description: def.description,
              isActive: true,
              nextRun,
              config: { systemManaged: true, timezone: "Asia/Kolkata" },
            },
          });
          logger.info({ msg: "Self-healed recommendation cron job", name: def.name, nextRun });
        }
      } else {
        await prisma.cronJob.create({
          data: {
            name: def.name,
            description: def.description,
            taskType: def.taskType,
            cronExpression: def.cronExpression,
            isActive: true,
            nextRun,
            config: { systemManaged: true, timezone: "Asia/Kolkata" },
          },
        });
        logger.info({ msg: "Created system recommendation cron job", name: def.name, nextRun });
      }

      ensured += 1;
      jobs.push({ name: def.name, taskType: def.taskType, cronExpression: def.cronExpression });
    } catch (error) {
      logger.error({ msg: "Failed to ensure recommendation cron job", name: def.name, error });
    }
  }

  return { ensured, jobs };
}
