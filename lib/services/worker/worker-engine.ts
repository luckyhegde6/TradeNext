// lib/services/worker/worker-engine.ts
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { executeTask } from "./worker-service";
import { createTaskLogger, writeLog } from "./worker-logger";
import { join } from "path";
import { existsSync, mkdirSync, chmodSync } from "fs";
import os from "os";

let workerInterval: NodeJS.Timeout | null = null;
let schedulerInterval: NodeJS.Timeout | null = null;
const WORKER_ID = `worker-${os.hostname()}-${process.pid}`;

/**
 * Start the background worker polling loop
 */
export function startWorker(pollingIntervalMs = 5000) {
    if (workerInterval) {
        logger.info({ msg: "Worker engine already running", workerId: WORKER_ID });
        return;
    }

    logger.info({ msg: "Starting background worker engine", workerId: WORKER_ID, interval: pollingIntervalMs });

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

    workerInterval = setInterval(async () => {
        try {
            await pollAndExecute();
            await updateHeartbeat("idle");
        } catch (error) {
            logger.error({ msg: "Worker loop error", error });
        }
    }, pollingIntervalMs);
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
            logger.info({ msg: "Cron job due, spawning task", jobName: job.name, jobId: job.id });

            await spawnCronTask(job.id, {
                name: `Scheduled: ${job.name}`,
                taskType: job.taskType,
                payload: (job.config as any) || {},
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
