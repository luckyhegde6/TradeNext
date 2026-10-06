// ─── Degraded task queue — the durable hand-off during a plan-limit hold ─────
//
// WHY THIS FILE EXISTS (spec 21, finding F2). Production behaviour while the
// Prisma plan-limit breaker was open: ZERO jobs executed. Not "some jobs" —
// none. `checkScheduledJobs` and `pollAndExecute` hard-return on the breaker,
// `fireJob` throws on `prisma.cronJob.findUnique`, and the dedup guard, task
// creation and `nextRun` advance are all Prisma. So a multi-day hold silently
// starves every cron on the box.
//
// The fix is NOT to remove those gates. Removing them alone causes N-instance
// duplicate execution (F5): duplicate Telegram broadcasts, duplicate
// Google-Sheets appends, N× NSE load. So this queue provides the missing
// durable hand-off, and `degradedLeader.ts` provides the missing election.
// Together: jobs still run, exactly once, on exactly one instance.
//
// WHAT "DURABLE" MEANS HERE. `_degraded_task` is the ONLY record that a job
// was owed. A crash between "cron fired" and "executor ran" cannot lose the
// work, because the enqueue is committed to SQLite before anything else
// happens. That is the entire point: SQLite is the one store that is not
// subject to the hold that caused this subsystem to exist.
//
// NEVER THROWS. Every function here is best-effort and returns a null/empty
// value instead. Callers are the 30s worker loop and the cron daemon; a throw
// from bookkeeping must not take down the loop that also serves normal
// requests.

import logger from "@/lib/logger";
import { createAuditLog } from "@/lib/audit";
import { getSqliteFallback, type DegradedTaskRow } from "@/lib/sqlite";
import { getDegradedCapability } from "./degradedTaskRegistry";

/**
 * The subset of `DueCronJob` this module needs.
 *
 * Declared structurally instead of importing `worker-engine`'s type: that
 * module will import THIS one, and a type-only cycle is still a cycle. The
 * fields are identical, so `DueCronJob` is assignable to this.
 */
export interface DegradableCronJob {
  id: string;
  name: string;
  taskType: string;
  cronExpression: string;
  config?: unknown;
}

/**
 * Dedup window for enqueue, in ms.
 *
 * 90 min mirrors `DEDUP_WINDOW_MS` in `worker-engine.ts` deliberately: the
 * degraded path must dedup exactly as strictly as the Prisma path it replaces,
 * or the "fix" would let more work through than the code it replaced.
 */
const DEDUP_WINDOW_MS = 90 * 60_000;

/**
 * Jobs drained per `runDegradedQueueOnce()` call.
 *
 * The caller is a 30s poll that also owns heartbeat + stale-task reaping.
 * An unbounded drain of a 200-row backlog would run 200 executors inside one
 * tick — each up to minutes — which is indistinguishable from a wedged worker
 * to the cross-instance reaper (the exact failure v3.37.0 fixed). Bounded means
 * the backlog drains over several ticks instead, and heartbeats keep flowing.
 */
const DEFAULT_MAX_PER_PASS = 5;

/**
 * Reclaim threshold for a row stuck in `running`.
 *
 * A crash between claim and complete strands the row forever: nothing else
 * would ever re-claim it, so the job is silently lost — the mirror image of
 * the "queue accepts work and never runs it" defect (Lesson 153). We reclaim
 * only well past the 10-min leader lease (degradedLeader LEASE_MS), so a
 * still-live leader's in-flight row is never stolen out from under it.
 */
const STALE_RUNNING_MS = 30 * 60_000;

export type DegradedOutcome = "completed" | "failed" | "skipped";

/** Executes one claimed task. Throwing marks the row `failed`. */
export type DegradedExecutor = (task: DegradedTaskRow) => Promise<void>;

/** Audit without an `auth()` round-trip — see recordDegradedSkip. */
const SYSTEM_SESSION = { user: { email: "system@tradenext6.app" } };

/** The mirror must be ready before any of this is meaningful. */
function mirror(): ReturnType<typeof getSqliteFallback> {
  const sqlite = getSqliteFallback();
  if (!sqlite?.isReady()) return null;
  return sqlite;
}

/**
 * Queue one due cron job.
 *
 * Idempotent within the dedup window via the accessor's pending/running guard,
 * so N instances firing the same cron produce one row, not N. A COMPLETED row
 * does not suppress a later legitimate re-fire.
 */
export function enqueueDegradedTask(
  job: DegradableCronJob,
  opts: { dedupWindowMs?: number } = {},
): string | null {
  const sqlite = mirror();
  if (!sqlite) {
    logger.debug({ msg: "Degraded queue: mirror not ready, not enqueuing", jobId: job.id });
    return null;
  }
  const id = sqlite.enqueueDegradedTask({
    taskType: job.taskType,
    // Cron-scoped: one logical job, deduped against itself. Payload carries the
    // scheduling detail instead, so a re-fire of the same job id is recognised.
    dedupKey: `cron:${job.id}`,
    payload: {
      cronJobId: job.id,
      cronJobName: job.name,
      cronExpression: job.cronExpression,
      config: job.config ?? null,
    },
    dedupWindowMs: opts.dedupWindowMs ?? DEDUP_WINDOW_MS,
  });
  if (id) {
    logger.info({
      msg: "Degraded queue: job enqueued",
      jobId: job.id,
      jobName: job.name,
      taskType: job.taskType,
      degradedTaskId: id,
    });
  }
  return id;
}

/**
 * Claim the oldest pending row for `leaderId`.
 *
 * The cross-instance guarantee comes from `canExecuteDegradedWork()`, not from
 * here: the caller MUST have passed the leader gate before calling. Atomicity
 * within this instance comes from the status-guarded UPDATE inside the
 * accessor (`status = 'pending'`), so even a bug that called this twice in a
 * loop cannot double-claim.
 */
export function claimNextDegradedTask(leaderId: string): DegradedTaskRow | null {
  const sqlite = mirror();
  if (!sqlite) return null;
  return sqlite.claimNextDegradedTask(leaderId);
}

/** Terminal state write. Idempotent by design — a retry must not resurrect. */
export function completeDegradedTask(
  id: string,
  outcome: DegradedOutcome,
  error?: string | null,
): void {
  const sqlite = mirror();
  if (!sqlite) return;
  sqlite.completeDegradedTask(id, outcome, error ?? null);
}

/**
 * Audit an unsafe skip.
 *
 * `createAuditLog` writes through the SQLite write-behind queue (`wb_audit_log`)
 * at zero Prisma ops, so it IS safe with the DB held. We pass an explicit
 * session anyway: without one it falls back to `await auth()`, which hits the
 * database that is currently on hold — a guaranteed slow timeout inside the
 * drain loop, per skipped task.
 */
function recordDegradedSkip(taskType: string, reason: string, taskId: string): void {
  void createAuditLog({
    action: "DEGRADED_JOB_SKIPPED",
    resource: "degraded_task",
    resourceId: taskId,
    session: SYSTEM_SESSION,
    metadata: { taskType, reason },
  });
}

/** Per-pass drain accounting, for logs and tests. */
export interface DegradedDrainResult {
  claimed: number;
  completed: number;
  failed: number;
  skipped: number;
  requeuedStale: number;
}

export interface DegradedDrainOptions {
  /** Injected so this module never imports the Prisma-writing executor. */
  execute: DegradedExecutor;
  /** Identity recorded in `claimed_by`. */
  leaderId: string;
  maxPerPass?: number;
}

/**
 * Drain up to `maxPerPass` queued tasks.
 *
 * Order of operations per task is deliberate: registry gate BEFORE execute, so
 * an unverified type is refused rather than half-run, and the refusal is
 * recorded durably in the row (`skipped`) as well as the audit log.
 */
export async function runDegradedQueueOnce(
  opts: DegradedDrainOptions,
): Promise<DegradedDrainResult> {
  const result: DegradedDrainResult = {
    claimed: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    requeuedStale: 0,
  };
  const max = Math.max(1, Math.floor(opts.maxPerPass ?? DEFAULT_MAX_PER_PASS));
  const sqlite = mirror();
  if (!sqlite) return result;

  // Reclaim stranded rows BEFORE claiming, so a crashed leader's work is not
  // left dead behind an otherwise-empty queue.
  result.requeuedStale = sqlite.requeueStaleDegradedTasks(STALE_RUNNING_MS);

  for (let n = 0; n < max; n++) {
    const task = claimNextDegradedTask(opts.leaderId);
    if (!task) break; // queue empty (or another instance won the row)
    result.claimed++;

    const cap = getDegradedCapability(task.taskType);
    if (!cap.degradedSafe) {
      // Fail closed: skip loudly. Running an unverified executor with the DB
      // held throws mid-run and can double an irreversible external side
      // effect, which is strictly worse than a missed tick the cron re-fires.
      completeDegradedTask(task.id, "skipped", cap.reason);
      result.skipped++;
      recordDegradedSkip(task.taskType, cap.reason, task.id);
      logger.warn({
        msg: "Degraded queue: task skipped (no verified SQLite write path)",
        taskType: task.taskType,
        degradedTaskId: task.id,
        known: cap.known,
        reason: cap.reason,
      });
      continue;
    }

    try {
      await opts.execute(task);
      completeDegradedTask(task.id, "completed", null);
      result.completed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      completeDegradedTask(task.id, "failed", message);
      result.failed++;
      logger.error({
        msg: "Degraded queue: task execution failed",
        taskType: task.taskType,
        degradedTaskId: task.id,
        attempts: task.attempts,
        error: message,
      });
    }
  }

  return result;
}

/** Admin/monitoring snapshot. Never throws. */
export function getDegradedQueueStatus(): ReturnType<
  NonNullable<ReturnType<typeof getSqliteFallback>>["getDegradedTaskStats"]
> {
  const sqlite = mirror();
  if (!sqlite) {
    return {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      oldestPendingAt: null,
    };
  }
  return sqlite.getDegradedTaskStats();
}

/** Test hook — the constants above are module-private by design. */
export const DEGRADED_QUEUE_LIMITS = {
  DEDUP_WINDOW_MS,
  DEFAULT_MAX_PER_PASS,
  STALE_RUNNING_MS,
} as const;