// lib/services/worker/netlify-runner.ts
//
// Spec 42 — Bounded serverless runner for Netlify Background Functions.
//
// Responsibilities:
//   - Acquire the shared worker lease with failOpen:false (no local leader
//     fallback on DB unavailability — FR-06).
//   - Run a durable cron tick (ensure crons + catch up missed + daily-rec
//     catch-up) under the shared lease (FR-08).
//   - Claim at most ONE task per invocation via atomic pending→running
//     updateMany (FR-09, concurrency 1).
//   - Stop claiming by the 13-minute budget mark, leaving ≥2 minutes for
//     persistence and shutdown (FR-10).
//   - Defer (never mark successful) tasks whose conservative runtime budget
//     cannot fit in remaining time (FR-12).
//   - Release the lease on completion or lease loss (FR-07).
//
// The runner is invoked by the standalone Netlify Background Function
// (`netlify/functions/worker-runner-background.mts`). One task per
// invocation; the next scheduled tick continues any remaining queue work.

import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import {
  acquireLeaderLock,
  releaseLeaderLock,
  renewLeaderLock,
  leaderWorkerId,
  LEADER_SELF,
  LEADER_HEARTBEAT_MS,
} from "@/lib/services/leader";
import {
  catchUpMissedCronJobs,
  ensureDailyRecommendationRan,
} from "@/lib/services/worker/worker-engine";
import { ensureRecommendationCrons } from "@/lib/services/recommendationCronService";
import { executeTask } from "@/lib/services/worker/worker-service";
import { isDbUnavailableError } from "@/lib/db-utils";
import { isNetlifyRuntime } from "@/lib/netlify";

// ─── Runtime budget ─────────────────────────────────────────────────────

// Netlify Background Function hard limit: 15 minutes. Target runner budget
// is 13 minutes, leaving ≥2 minutes for persistence, lease release, and
// shutdown. Never rely on finally / process shutdown hooks at the deadline.
export const RUNNER_BUDGET_MS = 13 * 60_000;
// Minimum headroom before the hard deadline — stop claiming new work once
// remaining time drops below this.
export const CLAIM_HEADROOM_MS = 2 * 60_000;
// Lease renewal cadence — well under LEADER_STALENESS_MS (10 min).
const LEASE_RENEW_MS = LEADER_HEARTBEAT_MS; // 5 min

// ─── Task runtime eligibility ───────────────────────────────────────────

/**
 * Conservative maximum runtime (ms) per task type. Tasks not listed here
 * are deferred (never claimed on the serverless path) until a measured,
 * defensible bound exists. Do not use average duration — use p95/worst safe
 * bound plus cancellation/partial-write analysis (Spec 42 §5.6).
 */
export const TASK_RUNTIME_BUDGET_MS: Record<string, number> = {
  // Fast, safe tasks (≤2 min each).
  ai_connection_test: 2 * 60_000,
  historical_price_sync: 2 * 60_000,
  market_data: 2 * 60_000,
  market_data_fetch: 2 * 60_000,
  corp_actions: 3 * 60_000,
  corp_actions_fetch: 3 * 60_000,
  events_fetch: 2 * 60_000,
  announcement_fetch: 2 * 60_000,
  alert_check: 3 * 60_000,
  screener: 3 * 60_000,
  password_reset: 1 * 60_000,
  notification_broadcast: 2 * 60_000,
  announcement_mgmt: 1 * 60_000,
  maintenance: 2 * 60_000,
  cleanup: 2 * 60_000,
  deploy_prep: 2 * 60_000,
  google_sheets_rescan: 5 * 60_000,
  // F-Score batches — conservative.
  fscore_calc: 2 * 60_000,
  fscore_single: 1 * 60_000,
  fscore_batch: 5 * 60_000,
  // recommendation_performance — reads trackers + prices, typically fast.
  recommendation_performance: 5 * 60_000,
  // recommendations — runs via coordinator/batch/finalizer checkpoint phases
  // (Spec 42 §5.5). Each phase is bounded; 5 min covers any single phase.
  recommendations: 5 * 60_000,
  // swing_performance — deferred until measured (Spec 42 §5.6).
};

// Task types that are explicitly deferred on the serverless path until a
// durable checkpoint/batch contract is in place.
export const DEFERRED_TASK_TYPES = new Set([
  // "recommendations" removed — runs via coordinator/batch/finalizer phases (Spec 42 §5.5)
  "swing_performance",
  "csv_processing",
  "data_sync",
  "historical_sync",
  "news_fetch",
  "screener_sync",
]);

/**
 * Returns the conservative runtime budget (ms) for a task type, or undefined
 * if the type is not eligible for serverless execution.
 */
export function taskRuntimeBudget(taskType: string): number | undefined {
  if (DEFERRED_TASK_TYPES.has(taskType)) return undefined;
  return TASK_RUNTIME_BUDGET_MS[taskType];
}

// ─── Serverless cron tick ───────────────────────────────────────────────

/**
 * Run the durable cron tick under the shared lease:
 *   1. Ensure system cron definitions exist (idempotent upsert by name).
 *   2. Catch up missed cron jobs (nextRun <= now).
 *   3. Day-level Daily Recommendations catch-up (leader-gated, ≤1/day).
 *
 * All three are idempotent under duplicate scheduled ticks because:
 *   - ensureRecommendationCrons upserts by stable name.
 *   - catchUpMissedCronJobs spawns via spawnDueCronJob which dedups on
 *     cronJobId + pending/running within DEDUP_WINDOW_MS.
 *   - ensureDailyRecommendationRan enforces ≤1 catch-up per UTC day.
 */
export async function serverlessCronTick(): Promise<{
  cronsEnsured: number;
  cronJobsRecovered: number;
  dailyRecCatchup: { enqueued: boolean; reason: string | null };
}> {
  // 1. Ensure system crons exist.
  const ensured = await ensureRecommendationCrons();

  // 2. Catch up any jobs whose nextRun is in the past (Netlify ~2h instance
  //    suspension can miss node-cron ticks; this is the recovery path).
  const recovered = await catchUpMissedCronJobs();

  // 3. Day-level Daily Recommendations catch-up (leader-only already inside).
  const dailyRecCatchup = await ensureDailyRecommendationRan();

  return {
    cronsEnsured: ensured.jobs.length,
    cronJobsRecovered: recovered.recovered,
    dailyRecCatchup,
  };
}

// ─── Bounded runner ─────────────────────────────────────────────────────

export interface RunnerResult {
  invokedAt: string;
  leaseAcquired: boolean;
  leaseLost: boolean;
  budgetMs: number;
  tick?: {
    cronsEnsured: number;
    cronJobsRecovered: number;
    dailyRecCatchup: { enqueued: boolean; reason: string | null };
  };
  task?: {
    id: string;
    name: string;
    taskType: string;
    triggeredBy: string | null;
    status: "completed" | "failed" | "deferred";
    durationMs: number | null;
    reason?: string;
  };
  leaseRenewals: number;
  durationMs: number;
}

export async function runBounded(): Promise<RunnerResult> {
  const invokedAt = new Date().toISOString();
  const startTime = Date.now();
  let leaseRenewals = 0;

  // Guard: only run on Netlify runtime. Persistent Node uses the in-process
  // worker engine (instrumentation.ts), not this path.
  if (!isNetlifyRuntime()) {
    logger.warn({
      msg: "netlify-runner invoked outside Netlify runtime — refusing",
    });
    return {
      invokedAt,
      leaseAcquired: false,
      leaseLost: false,
      budgetMs: RUNNER_BUDGET_MS,
      leaseRenewals: 0,
      durationMs: 0,
      task: {
        id: "",
        name: "",
        taskType: "",
        triggeredBy: null,
        status: "deferred",
        durationMs: 0,
        reason: "not-netlify-runtime",
      },
    };
  }

  // Fail closed: acquire the shared worker lease. On DB unavailability,
  // acquireLeaderLock({failOpen:false}) returns false — no local leader,
  // no claims, retry on the next scheduled tick.
  let leaseHeld = false;
  try {
    leaseHeld = await acquireLeaderLock("worker", { failOpen: false });
  } catch (error) {
    logger.error({
      msg: "netlify-runner: leader acquisition threw — failing closed",
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      invokedAt,
      leaseAcquired: false,
      leaseLost: false,
      budgetMs: RUNNER_BUDGET_MS,
      leaseRenewals: 0,
      durationMs: Date.now() - startTime,
      task: {
        id: "",
        name: "",
        taskType: "",
        triggeredBy: null,
        status: "deferred",
        durationMs: 0,
        reason: "acquisition-error",
      },
    };
  }

  if (!leaseHeld) {
    // Another instance holds the lease (duplicate wake-up / concurrent runner).
    // No-op — safe to skip, next tick retries.
    logger.info({
      msg: "netlify-runner: lease held by another instance — no-op",
      workerId: leaderWorkerId("worker"),
      self: LEADER_SELF,
    });
    return {
      invokedAt,
      leaseAcquired: false,
      leaseLost: false,
      budgetMs: RUNNER_BUDGET_MS,
      leaseRenewals: 0,
      durationMs: Date.now() - startTime,
      task: {
        id: "",
        name: "",
        taskType: "",
        triggeredBy: null,
        status: "deferred",
        durationMs: 0,
        reason: "lease-held",
      },
    };
  }

  // Lease acquired. Set up renewal heartbeat so the row stays fresh while we
  // work. If renewal ever returns false, stop claiming immediately.
  let leaseLost = false;
  let renewTimer: NodeJS.Timeout | null = null;

  const scheduleRenewal = () => {
    if (renewTimer) clearTimeout(renewTimer);
    renewTimer = setTimeout(async () => {
      try {
        const stillLeader = await renewLeaderLock("worker", {
          failOpen: false,
        });
        if (!stillLeader) {
          leaseLost = true;
          logger.warn({
            msg: "netlify-runner: lease lost on renewal — stopping claims",
            workerId: leaderWorkerId("worker"),
            self: LEADER_SELF,
          });
        } else {
          leaseRenewals += 1;
          scheduleRenewal();
        }
      } catch {
        // Renewal threw — treat as lease loss to be safe.
        leaseLost = true;
      }
    }, LEASE_RENEW_MS);
    renewTimer.unref?.();
  };
  scheduleRenewal();

  const result: RunnerResult = {
    invokedAt,
    leaseAcquired: true,
    leaseLost: false,
    budgetMs: RUNNER_BUDGET_MS,
    leaseRenewals: 0,
    durationMs: 0,
    task: {
      id: "",
      name: "",
      taskType: "",
      triggeredBy: null,
      status: "deferred",
      durationMs: 0,
      reason: "no-task",
    },
  };

  try {
    // Durable cron tick under the lease.
    result.tick = await serverlessCronTick();

    // Claim and execute at most one task within the remaining budget.
    await claimAndExecuteOne(result, startTime);

    result.durationMs = Date.now() - startTime;
  } finally {
    // Stop the renewal timer.
    if (renewTimer) {
      clearTimeout(renewTimer);
      renewTimer = null;
    }
    result.leaseLost = leaseLost;
    result.leaseRenewals = leaseRenewals;

    // Release the lease only if it's still ours.
    try {
      await releaseLeaderLock("worker");
    } catch (error) {
      // Non-fatal — lease expiry will handle cleanup on the next tick.
      logger.warn({
        msg: "netlify-runner: lease release failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }

    result.durationMs = Date.now() - startTime;
  }

  return result;
}

/**
 * Pick one eligible pending task and execute it within the remaining budget.
 * Returns when: a task completes/fails, no eligible task fits the budget,
 * or the lease is lost.
 */
async function claimAndExecuteOne(
  result: RunnerResult,
  startTime: number,
): Promise<void> {
  const now = () => Date.now();
  const remaining = () =>
    Math.max(0, RUNNER_BUDGET_MS - (now() - startTime));

  // Stop claiming when remaining time drops below the headroom margin.
  if (remaining() <= CLAIM_HEADROOM_MS) {
    result.task = {
      id: "",
      name: "",
      taskType: "",
      triggeredBy: null,
      status: "deferred",
      durationMs: 0,
      reason: "budget-headroom",
    };
    return;
  }

  // Lease loss check before every claim (FR-07).
  if (result.leaseLost) {
    result.task = {
      id: "",
      name: "",
      taskType: "",
      triggeredBy: null,
      status: "deferred",
      durationMs: 0,
      reason: "lease-lost",
    };
    return;
  }

  // Discover next pending task. The atomic claim (updateMany pending→running)
  // is the cross-instance execution gate — discovery may read the SQLite
  // mirror, but the claim itself is on Prisma.
  const task = await discoverPendingTask();
  if (!task) {
    result.task = {
      id: "",
      name: "",
      taskType: "",
      triggeredBy: null,
      status: "deferred",
      durationMs: 0,
      reason: "no-pending-task",
    };
    return;
  }

  const taskType = String(task.taskType ?? "unknown");

  // Deferred types are never claimed on the serverless path.
  if (DEFERRED_TASK_TYPES.has(taskType)) {
    result.task = {
      id: String(task.id),
      name: String(task.name ?? taskType),
      taskType,
      triggeredBy: task.triggeredBy ?? null,
      status: "deferred",
      durationMs: 0,
      reason: "deferred-type",
    };
    return;
  }

  const budget = taskRuntimeBudget(taskType);
  if (budget === undefined) {
    // Unknown/unsafe task type — defer with explicit reason, never mark
    // successful merely because skipped (FR-12).
    result.task = {
      id: String(task.id),
      name: String(task.name ?? taskType),
      taskType,
      triggeredBy: task.triggeredBy ?? null,
      status: "deferred",
      durationMs: 0,
      reason: "no-runtime-budget",
    };
    return;
  }

  // Conservative check: does this task's budget + safety margin fit in
  // remaining time?
  if (budget + CLAIM_HEADROOM_MS > remaining()) {
    result.task = {
      id: String(task.id),
      name: String(task.name ?? taskType),
      taskType,
      triggeredBy: task.triggeredBy ?? null,
      status: "deferred",
      durationMs: 0,
      reason: "insufficient-budget",
    };
    return;
  }

  // Atomic claim: pending → running. If another worker already claimed it,
  // updateMany returns 0 and we skip (idempotent under duplicate runners).
  let claimResult: { count: number } | null = null;
  try {
    claimResult = await prisma.workerTask.updateMany({
      where: { id: task.id, status: "pending" },
      data: {
        status: "running",
        assignedTo: LEADER_SELF,
        startedAt: new Date(),
      },
    });
  } catch (error) {
    if (isDbUnavailableError(error)) {
      // DB went mid-tick — cannot claim safely. Defer; next tick retries.
      result.task = {
        id: String(task.id),
        name: String(task.name ?? taskType),
        taskType,
        triggeredBy: task.triggeredBy ?? null,
        status: "deferred",
        durationMs: 0,
        reason: "db-unavailable",
      };
      return;
    }
    throw error;
  }

  if (!claimResult || claimResult.count === 0) {
    // Stolen by another node — skip idempotently.
    result.task = {
      id: String(task.id),
      name: String(task.name ?? taskType),
      taskType,
      triggeredBy: task.triggeredBy ?? null,
      status: "deferred",
      durationMs: 0,
      reason: "claim-stolen",
    };
    return;
  }

  // Owned. Execute within the task's budget.
  const taskStart = Date.now();
  let status: "completed" | "failed" = "failed";
  let durationMs: number | null = null;
  let reason: string | undefined;

  try {
    const execPromise = executeTask(
      String(task.id),
      taskType,
      (task.payload as Record<string, unknown> | undefined) ?? {},
    );
    const budgetPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Task exceeded conservative budget of ${Math.round(
                budget / 1000,
              )}s`,
            ),
          ),
        budget,
      ),
    );
    const execResult = await Promise.race([execPromise, budgetPromise]);

    status = execResult.success ? "completed" : "failed";
    reason = execResult.error;
  } catch (error) {
    status = "failed";
    reason =
      error instanceof Error ? error.message : String(error);
    // Log but don't rethrow — the task row will be marked failed below.
    logger.error({
      msg: "netlify-runner: task execution threw",
      taskId: task.id,
      taskType,
      error: reason,
    });
  }

  durationMs = Date.now() - taskStart;

  // Persist final task status (Prisma remains authoritative).
  try {
    await prisma.workerTask.update({
      where: { id: task.id },
      data: {
        status,
        completedAt: new Date(),
        error: reason || null,
      },
    });
  } catch (error) {
    logger.error({
      msg: "netlify-runner: failed to persist task outcome",
      taskId: task.id,
      taskType,
      status,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  result.task = {
    id: String(task.id),
    name: String(task.name ?? taskType),
    taskType,
    triggeredBy: task.triggeredBy ?? null,
    status,
    durationMs,
    reason,
  };
}

/**
 * Discover the next pending task. Prefers the SQLite mirror (zero Prisma)
 * when fresh; falls back to Prisma and seeds the mirror. The atomic claim
 * is always on Prisma.
 */
async function discoverPendingTask(): Promise<any | null> {
  try {
    const sqlite = (await import("@/lib/sqlite")).getSqliteFallback?.();
    const fresh =
      sqlite?.isReady &&
      typeof sqlite.isControlMirrorFresh === "function" &&
      sqlite.isControlMirrorFresh("worker_task", 5 * 60_000);

    if (fresh) {
      const rows = (sqlite.getWorkerTasks?.(50) || []) as Array<
        Record<string, unknown>
      >;
      const pending = rows
        .filter((r) => r.status === "pending")
        .sort(
          (a, b) =>
            Number(b.priority) - Number(a.priority) ||
            String(a.created_at ?? "").localeCompare(
              String(b.created_at ?? ""),
            ),
        );
      const top = pending[0];
      if (top && top.id) {
        return {
          id: String(top.id),
          name: String(top.name ?? top.task_type ?? "task"),
          taskType: String(top.task_type ?? "unknown"),
          status: "pending",
          priority: Number(top.priority ?? 0),
          createdAt: top.created_at
            ? new Date(String(top.created_at))
            : new Date(),
          payload: safeJson(top.payload),
          triggeredBy: top.triggered_by ?? null,
        };
      }
      return null; // Fresh mirror, no pending work — skip Prisma.
    }

    const task = await prisma.workerTask.findFirst({
      where: { status: "pending" },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
    if (task && sqlite?.upsertWorkerTask) {
      sqlite.upsertWorkerTask(task);
    } else if (!task && sqlite?.touchControlMirror) {
      sqlite.touchControlMirror("worker_task");
    }
    return task;
  } catch (error) {
    // If discovery throws (e.g., DB blip), return null — the runner will
    // no-op and retry on the next tick.
    logger.warn({
      msg: "netlify-runner: task discovery failed — no-op this tick",
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function safeJson(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
