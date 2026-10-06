// ─── Degraded executor — Prisma-free task execution (v3.45.0, spec 21) ─────
//
// WHY THIS FILE IS SEPARATE FROM `worker-service.ts`. The normal executor
// cannot be reused under a plan-limit hold for three independent reasons:
//   1. `executeTask()` calls `logTaskEvent()` BEFORE dispatching, and that is a
//      Prisma write — so every task would throw before doing any work.
//   2. It imports the Prisma client at module load.
//   3. Several executors write straight to Prisma (and one sends Telegram).
// Reusing it would mean "runs, then fails at the first write", which is exactly
// the half-executed state the registry exists to prevent.
//
// THE ONE INVARIANT THIS FILE MUST KEEP: **no reachable code may reference the
// database client.** `degradedExecutor.test.ts` parses this source and asserts
// exactly that, because a mocked behavioural test cannot tell a mirror write
// from a database write — and that confusion is how `alert_check` was wrongly
// seeded as safe (Lesson 155). If you add a branch here that needs Prisma, it
// does not belong here; it belongs in the registry as unsafe.
//
// Both branches write ONLY to the SQLite mirror, which drains to Postgres on the
// existing 6h `pushSqliteToPrisma()` once the hold lifts. Nothing here needs the
// `Task` row, so nothing here touches task bookkeeping.

import logger from "@/lib/logger";
import { getSqliteFallback, type DegradedTaskRow } from "@/lib/sqlite";
import { parseActionPurpose } from "@/lib/services/corpActionPurpose";

/** The task types this executor implements. Must equal the registry's safe set. */
export const DEGRADED_EXECUTOR_TASK_TYPES = ["recommendations", "corp_actions"] as const;

/** Read the `config` object a cron enqueued with the task. */
function cronConfig(task: DegradedTaskRow): Record<string, unknown> {
  const payload = task.payload as Record<string, unknown> | null | undefined;
  const config = payload?.config;
  return config && typeof config === "object" ? (config as Record<string, unknown>) : {};
}

/**
 * Daily recommendations.
 *
 * `runDailyRecommendations` writes exclusively to the mirror (the Prisma
 * recommendation tables are written only by the 6h push sinks). Its one
 * Prisma read — the tracker backfill for symbols the mirror has never seen — is
 * made fault-tolerant in the service itself, so a cold mirror degrades to
 * "creates fresh trackers" instead of failing the whole run.
 *
 * `triggeredBy` is hard-coded to `system`: a cron payload must never be able to
 * make a degraded row look like an admin action, and there is no admin session
 * in this path.
 */
async function executeRecommendationsDegraded(task: DegradedTaskRow): Promise<void> {
  const { runDailyRecommendations } = await import("@/lib/services/dailyRecommendationService");
  const result = await runDailyRecommendations({ triggeredBy: "system" });
  logger.info({
    msg: "Degraded: daily recommendations completed",
    degradedTaskId: task.id,
    runId: result?.runId,
    stockCount: result?.totalStocks,
  });
}

/**
 * Corporate actions.
 *
 * Fetch is network-only (`getIndexCorporateActions` returns `[]` rather than
 * throwing), and the write is the SQLite mirror — which queues `_sync_outbox`
 * rows for the 6h push. Deliberately NOT reusing `executeCorpActionsSync`:
 * that one upserts into Postgres first, per row, swallowing each failure, so
 * under a hold it would pay a database round-trip (and a hold-specific error)
 * for every action before reaching the mirror write that is all we can do.
 *
 * Rows without a usable `exDate` are dropped rather than mirrored: the mirror's
 * key is (symbol, action_type, ex_date), and a NULL key is not a row the 6h
 * push could ever upsert — it would only accumulate junk in the read path.
 *
 * The readiness check is deliberate and is NOT the module-level
 * `cacheCorporateActions()` helper: that helper fire-and-forgets onto a lazily
 * created backup, so a mirror that never comes up would drop the fetch
 * silently. Here a missing mirror throws, the row is marked `failed`, and the
 * work is visible and re-claimable instead of gone.
 */
async function executeCorpActionsDegraded(task: DegradedTaskRow): Promise<void> {
  const sqlite = getSqliteFallback();
  if (!sqlite?.isReady()) {
    throw new Error("Degraded corp_actions: SQLite mirror is not ready");
  }

  const { getIndexCorporateActions } = await import("@/lib/index-service");
  const indexName = (cronConfig(task).indexName as string) || "NIFTY 50";
  const actions = (await getIndexCorporateActions(indexName)) as Array<Record<string, unknown>>;

  const mirrored = actions
    .filter((a) => {
      if (!a.symbol || !a.exDate) return false;
      return !Number.isNaN(new Date(a.exDate as string).getTime());
    })
    .map((a) => {
      const { actionType, dividendAmount } = parseActionPurpose((a.purpose as string) || "");
      return {
        symbol: a.symbol,
        company_name: (a.companyName as string) || (a.symbol as string),
        series: (a.series as string) || "EQ",
        subject: a.purpose as string,
        action_type: actionType,
        ex_date: new Date(a.exDate as string).toISOString(),
        record_date: a.recordDate ? new Date(a.recordDate as string).toISOString() : null,
        dividend_per_share: dividendAmount ?? null,
        source: "nse",
      };
    });

  sqlite.setCorporateActions(mirrored);
  logger.info({
    msg: "Degraded: corporate actions mirrored",
    degradedTaskId: task.id,
    indexName,
    fetched: actions.length,
    mirrored: mirrored.length,
  });
}

/**
 * Execute one claimed degraded task.
 *
 * Throwing is meaningful, not incidental: `degradedQueue` records the message on
 * the row as `failed` so an operator can see WHY, and the stale-reclaim path can
 * re-queue it. An unknown type throws — the queue's registry gate should already
 * have skipped it, so reaching here means the two lists disagree, which is a bug
 * worth surfacing loudly rather than completing silently.
 */
export async function executeDegradedTask(task: DegradedTaskRow): Promise<void> {
  switch (task.taskType) {
    case "recommendations": {
      await executeRecommendationsDegraded(task);
      return;
    }
    case "corp_actions": {
      await executeCorpActionsDegraded(task);
      return;
    }
    default: {
      throw new Error(`No degraded executor for task type "${task.taskType}"`);
    }
  }
}
