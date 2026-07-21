// lib/services/worker/worker-engine.ts
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { executeTask } from "./worker-service";
import { createTaskLogger, writeLog } from "./worker-logger";
import { join } from "path";
import { existsSync, mkdirSync, chmodSync } from "fs";
import os from "os";

let workerInterval: NodeJS.Timeout | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;
let schedulerInterval: NodeJS.Timeout | null = null;
const WORKER_ID = `worker-${os.hostname()}-${process.pid}`;
const HEARTBEAT_INTERVAL_MS = 60_000; // Write heartbeat every 60s instead of every 5s
let lastHeartbeatStatus: "idle" | "busy" = "idle";
let lastHeartbeatTaskId: string | undefined;

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

    // Ensure logs directory exists at startup
    try {
        const logsDir = join(process.cwd(), ".next", "server_logs");
        if (!existsSync(logsDir)) {
            mkdirSync(logsDir, { recursive: true, mode: 0o777 });
            chmodSync(logsDir, 0o777);
        }
    } catch (e) {
        logger.warn({ msg: "Failed to initialize logs directory at startup", error: e });
    }

    // Task polling — only queries DB when there might be pending tasks
    workerInterval = setInterval(async () => {
        try {
            await pollAndExecute();
        } catch (error) {
            logger.error({ msg: "Worker loop error", error });
        }
    }, pollingIntervalMs);

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

    schedulerInterval = setInterval(async () => {
        try {
            await checkScheduledJobs();
        } catch (error) {
            logger.error({ msg: "Scheduler loop error", error });
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
    // 1. Pick up next pending task
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
        // 3. Execute the task logic
        const result = await executeTask(task.id, task.taskType, (task.payload as any) || {});

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
 * Check for due cron jobs and spawn worker tasks
 */
async function checkScheduledJobs() {
    const now = new Date();

    const dueJobs = await prisma.cronJob.findMany({
        where: {
            isActive: true,
            nextRun: { lte: now },
        },
    });

    if (dueJobs.length === 0) return;

    const { spawnCronTask } = await import("./task-orchestrator");

    for (const job of dueJobs) {
        try {
            logger.info({ msg: "Cron job due, spawning task", jobName: job.name, jobId: job.id, taskType: job.taskType });

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
            });

            // Calculate and update next run time
            const nextRun = calculateNextRun(job.cronExpression);
            await prisma.cronJob.update({
                where: { id: job.id },
                data: {
                    nextRun,
                    updatedAt: new Date()
                },
            });
        } catch (error) {
            logger.error({ msg: "Failed to spawn task for cron job", jobId: job.id, error });
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

/**
 * Simple cron next-run calculator
 * In production, use a library like 'cron-parser'
 */
function calculateNextRun(cronExpression: string): Date {
    const parts = cronExpression.split(" ");
    const now = new Date();
    const next = new Date(now);

    if (parts.length >= 5) {
        const [minute, hour, dom, month, dow] = parts;

        // Simple hourly/daily logic
        if (minute !== "*" && hour !== "*" && dom === "*" && month === "*" && dow === "*") {
            // Daily at HH:mm
            next.setHours(parseInt(hour), parseInt(minute), 0, 0);
            if (next <= now) next.setDate(next.getDate() + 1);
        } else if (minute.startsWith("*/")) {
            // Every X minutes
            const interval = parseInt(minute.replace("*/", "")) || 5;
            next.setMinutes(Math.floor(now.getMinutes() / interval) * interval + interval, 0, 0);
        } else {
            // Default to 1 hour from now if complex
            next.setHours(next.getHours() + 1);
        }
    } else {
        next.setHours(next.getHours() + 1);
    }

    return next;
}
