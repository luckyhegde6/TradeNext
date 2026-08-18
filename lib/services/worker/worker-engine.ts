// lib/services/worker/worker-engine.ts
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { executeTask } from "./worker-service";
import { createTaskLogger, writeLog, resolveLogsDir } from "./worker-logger";
import { calculateNextRun } from "@/lib/cron-parser";
import os from "os";

let workerInterval: NodeJS.Timeout | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;
let schedulerInterval: NodeJS.Timeout | null = null;
const WORKER_ID = `worker-${os.hostname()}-${process.pid}`;
const HEARTBEAT_INTERVAL_MS = 60_000; // Write heartbeat every 60s instead of every 5s
let lastHeartbeatStatus: "idle" | "busy" = "idle";
let lastHeartbeatTaskId: string | undefined;

// ─── Stale-task reaping (v3.8.0, heartbeat-aware v3.12.0, timeout v3.16.0) ──
// A task left in "running" past STALE_MS is dead: the worker crashed, the
// Netlify background function hit its ~15-min cap, or an admin runNow was
// killed by the sync-function timeout. Reaping resets it to "failed" so the
// queue never wedges and monitoring shows the truth.
//
// v3.12.0: the reaper now checks WORKER LIVENESS first. The heartbeat interval
// is 60s, so a live worker's lastHeartbeat is never more than ~2 min old.
// Tasks/runs owned by a LIVE worker are legitimately in flight (e.g. the AI
// analysis loop running on another Netlify instance) — reaping them fails
// healthy work (prod 2026-08-16: healthy run 8715fd51 was killed by another
// instance's reaper 16 min after start, then the whole run was lost).
//
// v3.16.0: STALE_MS raised from 16→30 min because the daily-recommendations
// pipeline (screener + AI pre-flight + 100-stock AI analysis in 20 batches)
// legitimately takes 15–25 min on prod. The old 16-min limit killed healthy
// tasks mid-analysis. A separate TASK_TIMEOUT_MS (25 min) wraps executeTask()
// with Promise.race so even a truly stuck task is cleaned up predictably.
//
// v3.17.0: STALE_MS raised to 45 min, TASK_TIMEOUT_MS to 40 min because
// prod daily-recommendations still takes 30+ min on slow AI days (free-tier
// OpenRouter models + retries + 20 batches). TASK_TIMEOUT_MS must stay below
// STALE_MS so the Promise.race fires first — the catch block marks the task
// "failed" cleanly instead of the reaper having to discover it.
export const STALE_MS = 45 * 60_000;
export const TASK_TIMEOUT_MS = 40 * 60_000; // hard ceiling on any single task execution
const REAP_INTERVAL_MS = 60_000; // reaper throttled to once per minute
const WORKER_ALIVE_WINDOW_MS = 3 * 60_000; // fresh heartbeat = live worker
// Task types that CREATE DailyRecommendationRun rows (runDailyRecommendations).
// A running run is legit only while one of these is executing on a live worker
// (runs carry no worker id of their own).
const RUN_PRODUCING_TASK_TYPES = ["recommendations"];
let lastReapAt = 0;

// ─── Cron spawn dedup (v3.8.0) ─────────────────────────────────────────────
// Multiple worker nodes or a slow job can otherwise stack duplicate
// executions for the same cron firing. Skip spawning while a task for the
// same cronJobId is pending/running within this window (still advance
// nextRun so the schedule keeps ticking).
const DEDUP_WINDOW_MS = 90 * 60_000;

/**
 * Start the background worker polling loop
 * NOTE: Task polling runs every 5s for responsiveness, but DB heartbeat
 * is separated into a 60s interval to reduce monthly query count by ~98%.
 * Previously: ~1,036,800 queries/month from heartbeat alone.
 * Now: ~17,280 queries/month (heartbeat) + 5s poll only queries DB when tasks exist.
 */
export function startWorker(pollingIntervalMs = 5000) {
    if (workerInterval) {
        logger.info({ msg: "Worker engine already running", workerId: WORKER_ID });
        return;
    }

    logger.info({ msg: "Starting background worker engine", workerId: WORKER_ID, interval: pollingIntervalMs, heartbeatInterval: HEARTBEAT_INTERVAL_MS });

    // Ensure a writable logs directory exists at startup — cwd/.next/server_logs
    // on local, os.tmpdir()/tradenext-logs on Netlify's read-only FS (v3.12.0;
    // the old mkdir of `.next/server_logs` threw ENOENT on every prod boot and
    // permanently disabled worker file logging).
    try {
        resolveLogsDir();
    } catch (e) {
        logger.warn({ msg: "Failed to initialize logs directory at startup", error: e instanceof Error ? e.message : String(e) });
    }

    // Task polling — only queries DB when there might be pending tasks
    workerInterval = setInterval(async () => {
        try {
            await pollAndExecute();
        } catch (error) {
            // v3.12.0: pass the MESSAGE, not the raw object — pino's serializer
            // drops non-enumerable Error props (prod logged `{"clientVersion":"7.9.1"}`
            // for a Prisma engine error, losing the actual message).
            logger.error({ msg: "Worker loop error", error: error instanceof Error ? error.message : String(error) });
        }
    }, pollingIntervalMs);

    // Initial reaping pass — clear anything stuck from a previous process
    // (e.g. an admin runNow killed by the sync-function timeout yesterday).
    maybeReap().catch(() => {});

    // Heartbeat — writes to DB every 60s for crash recovery visibility
    heartbeatInterval = setInterval(async () => {
        try {
            await updateHeartbeat(lastHeartbeatStatus, lastHeartbeatTaskId);
        } catch (error) {
            // Ignore heartbeat errors
        }
    }, HEARTBEAT_INTERVAL_MS);

    // Write initial heartbeat
    updateHeartbeat("idle").catch(() => {});
}

/**
 * Start the cron scheduler loop
 */
export function startScheduler(checkIntervalMs = 60000) {
    if (schedulerInterval) {
        logger.info({ msg: "Scheduler engine already running" });
        return;
    }

    logger.info({ msg: "Starting cron scheduler engine", interval: checkIntervalMs });

    // Ensure SYSTEM-managed recommendation crons exist (self-healing upsert).
    import("@/lib/services/recommendationCronService")
        .then(({ ensureRecommendationCrons }) => ensureRecommendationCrons())
        .then((res) => logger.info({ msg: "Recommendation crons ensured", jobs: res.jobs.length }))
        .catch((error) => logger.error({ msg: "Failed to ensure recommendation crons", error: error instanceof Error ? error.message : String(error) }));

    schedulerInterval = setInterval(async () => {
        try {
            await checkScheduledJobs();
        } catch (error) {
            logger.error({ msg: "Scheduler loop error", error: error instanceof Error ? error.message : String(error) });
        }
    }, checkIntervalMs);
}

/**
 * Stop all loops
 */
export function stopWorkerEngine() {
    if (workerInterval) {
        clearInterval(workerInterval);
        workerInterval = null;
    }
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    if (schedulerInterval) {
        clearInterval(schedulerInterval);
        schedulerInterval = null;
    }
    logger.info({ msg: "Worker and Scheduler engines stopped", workerId: WORKER_ID });
}

/**
 * Poll for pending tasks and execute them one by one
 */
async function pollAndExecute() {
    // 1. Reap stale in-flight tasks (throttled to 1/min) so a wedged
    // "running" task never blocks new work.
    await maybeReap();

    // 2. Pick up next pending task
    const task = await prisma.workerTask.findFirst({
        where: { status: "pending" },
        orderBy: [
            { priority: "desc" },
            { createdAt: "asc" },
        ],
    });

    if (!task) return;

    // 2. Claim the task
    // We use updateMany with status: "pending" to ensure atomicity
    const updateResult = await prisma.workerTask.updateMany({
        where: { id: task.id, status: "pending" },
        data: {
            status: "running",
            assignedTo: WORKER_ID,
            startedAt: new Date(),
        },
    });

    if (updateResult.count === 0) return; // Already picked up by another worker node

    // Update tracked status (will be written to DB by heartbeat interval)
    lastHeartbeatStatus = "busy";
    lastHeartbeatTaskId = task.id;
    // Write immediate heartbeat for task start (important for real-time status)
    await updateHeartbeat("busy", task.id);
    const taskLogger = createTaskLogger(task.id);
    await taskLogger.info(`Worker ${WORKER_ID} started task: ${task.name} [${task.taskType}]`);

    try {
        // 3. Execute the task logic with a hard timeout.
        // v3.17.0: TASK_TIMEOUT_MS raised to 40 min — the daily-recommendations
        // pipeline (screener + AI pre-flight + 100-stock AI analysis in 20
        // batches × 5 concurrent) legitimately takes 25–35 min on prod with
        // free-tier OpenRouter models. TASK_TIMEOUT_MS (40 min) is below
        // STALE_MS (45 min) so the Promise.race fires first and marks the task
        // "failed" cleanly. When the timeout fires, executeTask() continues in
        // the background (we can't abort Prisma/HTTP calls cleanly), but the
        // worker is free to pick up new work.
        const executePromise = executeTask(task.id, task.taskType, (task.payload as any) || {});
        const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Task timed out after ${Math.round(TASK_TIMEOUT_MS / 60000)} min`)), TASK_TIMEOUT_MS),
        );
        const result = await Promise.race([executePromise, timeoutPromise]);

        // 4. Update task status with final result
        await prisma.workerTask.update({
            where: { id: task.id },
            data: {
                status: result.success ? "completed" : "failed",
                completedAt: new Date(),
                result: (result.result as any) || null,
                error: result.error || null,
            },
        });

        await taskLogger.info(`Task ${task.id} finished with status: ${result.success ? "completed" : "failed"}`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await prisma.workerTask.update({
            where: { id: task.id },
            data: {
                status: "failed",
                completedAt: new Date(),
                error: errorMessage,
            },
        });
        await taskLogger.error(`Task ${task.id} execution failed`, error);
    } finally {
        // Update tracked status — heartbeat interval will write to DB on next tick
        lastHeartbeatStatus = "idle";
        lastHeartbeatTaskId = undefined;
        // Write immediate heartbeat for task end
        await updateHeartbeat("idle");
    }
}

/**
 * Reap stale in-flight tasks: WorkerTasks stuck in "running" for longer than
 * `staleMs` (they are dead — worker crashed or the process was restarted
 * killed at the Netlify 15-min cap) and DailyRecommendationRuns stuck in
 * "running" (keyed on createdAt — that model has no startedAt).
 *
 * v3.12.0 heartbeat-awareness: only tasks whose owning worker is DEAD (no
 * WorkerStatus row, or lastHeartbeat older than WORKER_ALIVE_WINDOW_MS) are
 * reaped. Runs are reaped only while NO live worker is executing a
 * run-producing task ("recommendations"). If liveness can't be determined
 * (heartbeat lookup fails) the reaper skips everything — fail-safe: never
 * kill work we can't prove is dead.
 *
 * Exported for tests and the cleanup tooling.
 */
export async function reapStaleWorkerTasks(staleMs: number = STALE_MS): Promise<{ reapedTasks: number; reapedRuns: number }> {
    const cutoff = new Date(Date.now() - staleMs);
    let reapedTasks = 0;
    let reapedRuns = 0;

    let aliveWorkerIds: Set<string> | null = null;
    try {
        const aliveWorkers = await prisma.workerStatus.findMany({
            where: { lastHeartbeat: { gte: new Date(Date.now() - WORKER_ALIVE_WINDOW_MS) } },
            select: { workerId: true },
        });
        aliveWorkerIds = new Set(aliveWorkers.map((w) => w.workerId));
    } catch (error) {
        logger.warn({
            msg: "Alive-worker lookup failed — skipping reap (fail-safe)",
            error: error instanceof Error ? error.message : String(error),
        });
        return { reapedTasks: 0, reapedRuns: 0 };
    }

    try {
        const tasks = await prisma.workerTask.findMany({
            where: { status: "running", startedAt: { lte: cutoff } },
            select: { id: true, assignedTo: true },
        });
        // Only reap tasks with NO owner or a DEAD owner — a task running on a
        // live worker is a legitimately long-running job (e.g. the AI analysis
        // loop), not a wedged one.
        const reapable = tasks.filter((t) => !t.assignedTo || !aliveWorkerIds!.has(t.assignedTo));
        if (reapable.length > 0) {
            await prisma.workerTask.updateMany({
                where: { id: { in: reapable.map((t) => t.id) } },
                data: {
                    status: "failed",
                    completedAt: new Date(),
                    error: `Reaped by ${WORKER_ID}: task ran past ${Math.round(staleMs / 60000)} min without completing`,
                },
            });
            reapedTasks = reapable.length;
            logger.warn({
                msg: "Reaped stale worker tasks",
                count: reapedTasks,
                skippedLiveOwners: tasks.length - reapable.length,
                cutoff: cutoff.toISOString(),
            });
        }
    } catch (error) {
        logger.warn({ msg: "Stale worker-task reap failed", error: error instanceof Error ? error.message : String(error) });
    }

    try {
        // Runs carry no worker id — a running run is legit ONLY while its
        // producing task ("recommendations") is executing on a LIVE worker.
        const liveProducers = await prisma.workerTask.findMany({
            where: {
                status: "running",
                taskType: { in: RUN_PRODUCING_TASK_TYPES },
                assignedTo: { in: [...aliveWorkerIds!] },
            },
            select: { id: true },
        });

        const runs = await prisma.dailyRecommendationRun.findMany({
            where: { status: "running", createdAt: { lte: cutoff } },
            select: { id: true },
        });
        if (runs.length > 0) {
            if (liveProducers.length > 0) {
                logger.debug({
                    msg: "Skipped run reap — live producer task in flight",
                    runCount: runs.length,
                    liveProducers: liveProducers.length,
                });
            } else {
                await prisma.dailyRecommendationRun.updateMany({
                    where: { id: { in: runs.map((r) => r.id) } },
                    data: {
                        status: "failed",
                        completedAt: new Date(),
                        errorMessage: `Reaped by ${WORKER_ID}: run past ${Math.round(staleMs / 60000)} min without completing`,
                    },
                });
                reapedRuns = runs.length;
                logger.warn({ msg: "Reaped stale recommendation runs", count: reapedRuns, cutoff: cutoff.toISOString() });
            }
        }
    } catch (error) {
        logger.warn({ msg: "Stale recommendation-run reap failed", error: error instanceof Error ? error.message : String(error) });
    }

    return { reapedTasks, reapedRuns };
}

/** Throttled wrapper — the poll loop calls this every 5s but DB work runs ≤1/min. */
async function maybeReap(): Promise<void> {
    if (Date.now() - lastReapAt < REAP_INTERVAL_MS) return;
    lastReapAt = Date.now();
    await reapStaleWorkerTasks();
}

/** Structural type for the fields spawnDueCronJob needs from a CronJob row. */
export interface DueCronJob {
    id: string;
    name: string;
    taskType: string;
    cronExpression: string;
    config?: unknown;
}

/**
 * Spawn a worker task for one due cron job.
 *
 * Shared by the 60s poll scheduler (checkScheduledJobs) and the in-process
 * node-cron daemon (cron-daemon.ts) so both paths behave identically:
 *   - Dedup guard (v3.8.0): if a task for this cron job is already
 *     pending/running within the window, skip spawning — a busy job
 *     or a second server instance must not stack duplicate executions.
 *     nextRun is still advanced so the schedule keeps ticking.
 *   - Payload defaults (indexName) derived from taskType.
 *   - nextRun advanced via calculateNextRun after a successful spawn.
 */
export async function spawnDueCronJob(job: DueCronJob): Promise<void> {
    const { spawnCronTask } = await import("./task-orchestrator");

    logger.info({ msg: "Cron job due, spawning task", jobName: job.name, jobId: job.id, taskType: job.taskType });

    const existing = await prisma.workerTask.findFirst({
        where: {
            cronJobId: job.id,
            status: { in: ["pending", "running"] },
            createdAt: { gte: new Date(Date.now() - DEDUP_WINDOW_MS) },
        },
        select: { id: true, name: true },
    });
    if (existing) {
        logger.info({
            msg: "Skipping cron spawn — task already pending/running",
            jobName: job.name,
            jobId: job.id,
            existingTaskId: existing.id,
        });
        await prisma.cronJob.update({
            where: { id: job.id },
            data: {
                nextRun: calculateNextRun(job.cronExpression),
                updatedAt: new Date()
            },
        });
        return;
    }

    // Build payload with default indexName based on task type
    let payload = (job.config as Record<string, unknown>) || {};

    // Add default indexName if not specified in config
    if (!payload.indexName) {
        if (job.taskType === 'stock_sync' || job.taskType === 'market_data') {
            payload = { ...payload, indexName: "NIFTY TOTAL MARKET" };
        } else if (job.taskType === 'corp_actions' || job.taskType === 'events_fetch') {
            payload = { ...payload, indexName: "NIFTY 50" };
        }
    }

    await spawnCronTask(job.id, {
        name: `Scheduled: ${job.name}`,
        taskType: job.taskType,
        payload,
        // System-managed jobs (e.g. recommendation crons upserted by
        // ensureRecommendationCrons) carry a systemManaged flag so the
        // spawned task is marked triggeredBy: "system" for audit.
        triggeredBy: (job.config as Record<string, unknown>)?.systemManaged === true ? "system" : "cron",
    });

    // Calculate and update next run time
    await prisma.cronJob.update({
        where: { id: job.id },
        data: {
            nextRun: calculateNextRun(job.cronExpression),
            updatedAt: new Date()
        },
    });
}

/**
 * Check for due cron jobs and spawn worker tasks
 * (exported for tests)
 */
export async function checkScheduledJobs() {
    const now = new Date();

    const dueJobs = await prisma.cronJob.findMany({
        where: {
            isActive: true,
            nextRun: { lte: now },
        },
    });

    if (dueJobs.length === 0) return;

    for (const job of dueJobs) {
        try {
            await spawnDueCronJob(job);
        } catch (error) {
            logger.error({ msg: "Failed to spawn task for cron job", jobId: job.id, error: error instanceof Error ? error.message : String(error) });
        }
    }
}

/**
 * Update worker heartbeat in worker_status table
 */
async function updateHeartbeat(status: "idle" | "busy", currentTaskId?: string) {
    try {
        const mem = process.memoryUsage();
        await prisma.workerStatus.upsert({
            where: { workerId: WORKER_ID },
            create: {
                workerId: WORKER_ID,
                workerName: os.hostname(),
                status,
                currentTaskId: currentTaskId || null,
                lastHeartbeat: new Date(),
                memoryUsage: mem.heapUsed / 1024 / 1024,
                cpuUsage: os.loadavg()[0],
            },
            update: {
                status,
                currentTaskId: currentTaskId || null,
                lastHeartbeat: new Date(),
                memoryUsage: mem.heapUsed / 1024 / 1024,
                cpuUsage: os.loadavg()[0],
            },
        });
    } catch (error) {
        // Ignore heartbeat errors
    }
}

// calculateNextRun is imported from "@/lib/cron-parser" (shared, testable).
