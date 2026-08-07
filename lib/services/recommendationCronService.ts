// lib/services/recommendationCronService.ts
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { calculateNextRun } from "@/lib/cron-parser";

/**
 * Self-healing cron jobs for the Daily Recommendations engine (v3.5.0).
 *
 * Ensures the two SYSTEM-managed recommendation jobs exist and are active:
 *   - Daily Recommendations          `30 4 * * 1-5`   = 10:00 AM IST (Mon-Fri)
 *   - Recommendation Performance     `30 10 * * 1-5`  = 04:00 PM IST (Mon-Fri)
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
export const RECOMMENDATION_CRON_EXPR = "30 4 * * 1-5"; // 10:00 AM IST Mon-Fri
export const RECOMMENDATION_PERFORMANCE_CRON_EXPR = "30 10 * * 1-5"; // 04:00 PM IST Mon-Fri

export interface EnsureRecommendationCronsResult {
  ensured: number;
  jobs: Array<{ name: string; taskType: string; cronExpression: string }>;
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
