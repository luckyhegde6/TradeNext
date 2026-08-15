// lib/services/recommendationCronService.ts
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { calculateNextRun } from "@/lib/cron-parser";

/**
 * Self-healing cron jobs for the Daily Recommendations engine (v3.5.0)
 * plus the Daily Market Sync (v3.5.8) and the AI Connection Test (v3.7.1).
 *
 * Ensures the four SYSTEM-managed jobs exist and are active:
 *   - Daily Recommendations          `30 4 * * 1-5`    = 10:00 AM IST (Mon-Fri)
 *   - Recommendation Performance     `30 10 * * 1-5`   = 04:00 PM IST (Mon-Fri)
 *   - Daily Market Sync              `1 1 * * 1-5`     = 06:31 AM IST (Mon-Fri)
 *   - AI Connection Test             step 30 every min (08:30–15:30 IST, Mon-Fri)
 *     (Mon-Fri, every 30 min) — probes the configured AI model + fallback
 *     routes BEFORE the 10:00 AM IST recommendations run so a dead model is
 *     caught early instead of producing an all-HOLD run.
 *
 * The four jobs are executed by the in-process cron daemon (v3.11.0):
 * lib/services/worker/cron-daemon.ts registers each active CronJob row on
 * the node-cron scheduler (timezone Asia/Kolkata) and spawns a WorkerTask
 * via spawnDueCronJob → spawnCronTask. The daemon replaced the old Netlify
 * scheduled functions (cron-recommendations / cron-performance /
 * cron-market-sync / cron-ai-connection-test → run-cron-background.ts,
 * deleted in v3.11.0). WorkerTask execution still flows through
 * executeTask, which handles all four taskTypes (plus `ai_connection_test`
 * for local/admin-triggered runs).
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
export const AI_CONNECTION_TEST_CRON_NAME = "AI Connection Test (System)";
export const RECOMMENDATION_CRON_EXPR = "30 4 * * 1-5"; // 10:00 AM IST Mon-Fri
export const RECOMMENDATION_PERFORMANCE_CRON_EXPR = "30 10 * * 1-5"; // 04:00 PM IST Mon-Fri
export const MARKET_SYNC_CRON_EXPR = "1 1 * * 1-5"; // 06:31 AM IST Mon-Fri (UTC 01:01)
export const AI_CONNECTION_TEST_CRON_EXPR = "*/30 3-10 * * 1-5"; // 08:30–15:30 IST Mon-Fri

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

export interface RecordCronRunOptions {
  /**
   * True when the run was spawned via spawnCronTask (cronJobId linked) — that
   * path already increments runCount and advances nextRun at spawn time, so
   * only the outcome counters (and a completion-time lastRun) are written
   * here to avoid double counting. v3.11.0: the in-process cron daemon always
   * spawns via spawnCronTask, so scheduled runs use this.
   */
  skipSpawnCounted?: boolean;
}

/**
 * Record an execution of a SYSTEM-managed recommendation cron job.
 *
 * WHY THIS EXISTS:
 * Scheduled runs (in-process cron daemon, v3.11.0) execute via
 * spawnDueCronJob → spawnCronTask, which writes the ledger (lastRun /
 * runCount / successCount / failureCount / nextRun) at spawn time — but the
 * success/failure OUTCOME is only known after executeTask finishes. Manual
 * admin runs (spawnRegularTask, no cronJobId) never touch the ledger. So
 * this function is the single writer for run OUTCOMES:
 *   - worker-service.ts executeTask completion paths for system task types
 *     (recommendations / recommendation_performance) — success + failure
 *   - app/api/admin/workers/route.ts PATCH runNow/retry (manual runs for
 *     tasks WITHOUT a cronJobId — cronJobId-linked tasks are already counted
 *     at spawn time by spawnCronTask, so we skip them to avoid double-count)
 *
 * Job is located by stable name (idempotent with ensureRecommendationCrons).
 * Safe no-op (found:false) when the job does not exist — never throws.
 */
export async function recordCronRun(jobName: string, success: boolean, options?: RecordCronRunOptions): Promise<RecordCronRunResult> {
  try {
    const job = await prisma.cronJob.findFirst({ where: { name: jobName } });
    if (!job) {
      logger.warn({ msg: "recordCronRun: cron job not found (no-op)", jobName });
      return { found: false };
    }

    const data: Record<string, unknown> = {
      lastRun: new Date(),
      successCount: success ? { increment: 1 } : undefined,
      failureCount: success ? undefined : { increment: 1 },
    };
    if (!options?.skipSpawnCounted) {
      data.runCount = { increment: 1 };
      data.nextRun = calculateNextRun(job.cronExpression);
    }

    const updated = await prisma.cronJob.update({
      where: { id: job.id },
      data: data as never,
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
    {
      name: AI_CONNECTION_TEST_CRON_NAME,
      description: "System-managed AI provider connection test — probes the configured model + fallback routes (every 30 min, 08:30–15:30 IST, Mon-Fri)",
      taskType: "ai_connection_test",
      cronExpression: AI_CONNECTION_TEST_CRON_EXPR,
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
        // Self-heal: keep the job active + fix schedule if drifted. nextRun
        // is ALWAYS recomputed (v3.10.1 UTC semantics) so rows anchored by the
        // old local-timezone parser (e.g. an IST dev machine computing
        // "30 4 * * 1-5" as 04:30 IST = 23:00 UTC) self-correct on the next
        // worker/Netlify startup. ensureRecommendationCrons runs once per
        // start, never inside the 5s poll loop, so re-anchoring to the next
        // future occurrence is safe (strictly-future; no immediate fire).
        const changed =
          existing.isActive !== true ||
          existing.taskType !== def.taskType ||
          existing.cronExpression !== def.cronExpression;

        const data: Parameters<typeof prisma.cronJob.update>[0]["data"] = { nextRun };
        if (changed) {
          data.taskType = def.taskType;
          data.cronExpression = def.cronExpression;
          data.description = def.description;
          data.isActive = true;
          data.config = { systemManaged: true, timezone: "Asia/Kolkata" };
        }

        await prisma.cronJob.update({ where: { id: existing.id }, data });
        logger.info({
          msg: changed ? "Self-healed recommendation cron job" : "Recomputed recommendation cron job nextRun",
          name: def.name,
          nextRun,
          changed,
        });
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

  // Post-pass dedupe (v3.8.0): CronJob.name has NO unique constraint, so two
  // Netlify instances racing the findFirst-then-create above can leave
  // duplicate rows for the same system job. Migration-free fix: keep the
  // EARLIEST row per system name and delete the rest. Scoped strictly to the
  // four system names — user-created crons are never touched.
  const systemNames = definitions.map((d) => d.name);
  const systemCrons = await prisma.cronJob.findMany({
    where: { name: { in: systemNames } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, createdAt: true },
  });

  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  for (const row of systemCrons) {
    if (seen.has(row.name)) {
      duplicateIds.push(row.id);
    } else {
      seen.add(row.name);
    }
  }

  if (duplicateIds.length > 0) {
    await prisma.cronJob.deleteMany({
      where: { id: { in: duplicateIds } },
    });
    logger.warn({
      msg: "Removed duplicate system cron jobs",
      count: duplicateIds.length,
      names: Array.from(seen),
    });
  }

  return { ensured, jobs };
}
