// lib/services/worker/task-orchestrator.ts
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

/**
 * Task Orchestrator — central service for spawning and tracking tasks across categories.
 *
 * - spawnCronTask:    Creates a worker task linked to a CronJob (taskCategory: "cron")
 * - spawnAsyncTask:   Creates a worker task for background processing (taskCategory: "async")
 * - spawnRegularTask: Creates an on-demand admin task (taskCategory: "regular")
 * - logTaskEvent:     Writes a granular event entry to the TaskEvent table
 * - getTaskWithEvents / getTaskStats: Read helpers for the UI
 */

// Valid event types for the TaskEvent table
export type TaskEventType =
    | "task_created"
    | "task_started"
    | "task_completed"
    | "task_failed"
    | "task_cancelled"
    | "task_retried"
    | "alert_triggered"
    | "csv_row_processed"
    | "notification_sent"
    | "data_synced";

export interface SpawnTaskOptions {
    name: string;
    taskType: string;
    priority?: number;
    maxRetries?: number;
    payload?: Record<string, unknown>;
    createdBy?: number;
    parentTaskId?: string;
}

// ---------------------------------------------------------------------------
// Spawn helpers
// ---------------------------------------------------------------------------

/**
 * Create a worker task from a CronJob definition.
 * Automatically sets taskCategory = "cron", triggeredBy = "cron", and links the cronJobId.
 */
export async function spawnCronTask(
    cronJobId: string,
    options: SpawnTaskOptions
) {
    const task = await prisma.workerTask.create({
        data: {
            name: options.name,
            taskType: options.taskType,
            taskCategory: "cron",
            triggeredBy: "cron",
            cronJobId,
            priority: options.priority ?? 7, // cron tasks default to higher priority
            maxRetries: options.maxRetries ?? 3,
            payload: (options.payload as never) ?? undefined,
            createdBy: options.createdBy ?? null,
            parentTaskId: options.parentTaskId ?? null,
        },
    });

    await logTaskEvent(task.id, "task_created", `Cron task spawned from job ${cronJobId}`, {
        cronJobId,
        taskType: options.taskType,
    });

    // Update the CronJob's lastRun and runCount
    await prisma.cronJob.update({
        where: { id: cronJobId },
        data: {
            lastRun: new Date(),
            runCount: { increment: 1 },
        },
    });

    logger.info({ msg: "Cron task spawned", taskId: task.id, cronJobId, taskType: task.taskType });
    return task;
}

/**
 * Create a background worker task for long-running operations (CSV ingest, historical sync, etc.)
 * Sets taskCategory = "async", triggeredBy = "upload" (or custom).
 */
export async function spawnAsyncTask(
    options: SpawnTaskOptions & { triggeredBy?: string }
) {
    const task = await prisma.workerTask.create({
        data: {
            name: options.name,
            taskType: options.taskType,
            taskCategory: "async",
            triggeredBy: options.triggeredBy ?? "upload",
            priority: options.priority ?? 5,
            maxRetries: options.maxRetries ?? 3,
            payload: (options.payload as never) ?? undefined,
            createdBy: options.createdBy ?? null,
            parentTaskId: options.parentTaskId ?? null,
        },
    });

    await logTaskEvent(task.id, "task_created", `Async task created: ${options.name}`, {
        taskType: options.taskType,
        triggeredBy: options.triggeredBy ?? "upload",
    });

    logger.info({ msg: "Async task spawned", taskId: task.id, taskType: task.taskType });
    return task;
}

/**
 * Create an admin-initiated regular task (password reset, notification, maintenance, etc.)
 * Sets taskCategory = "regular", triggeredBy = "admin".
 */
export async function spawnRegularTask(
    options: SpawnTaskOptions & { triggeredBy?: string }
) {
    const task = await prisma.workerTask.create({
        data: {
            name: options.name,
            taskType: options.taskType,
            taskCategory: "regular",
            triggeredBy: options.triggeredBy ?? "admin",
            priority: options.priority ?? 5,
            maxRetries: options.maxRetries ?? 3,
            payload: (options.payload as never) ?? undefined,
            createdBy: options.createdBy ?? null,
            parentTaskId: options.parentTaskId ?? null,
        },
    });

    await logTaskEvent(task.id, "task_created", `Regular task created: ${options.name}`, {
        taskType: options.taskType,
        triggeredBy: options.triggeredBy ?? "admin",
    });

    logger.info({ msg: "Regular task spawned", taskId: task.id, taskType: task.taskType });
    return task;
}

// ---------------------------------------------------------------------------
// Event logging
// ---------------------------------------------------------------------------

/**
 * Write a granular event entry to the TaskEvent table.
 */
export async function logTaskEvent(
    taskId: string,
    eventType: TaskEventType,
    message?: string,
    metadata?: Record<string, unknown>
) {
    try {
        await prisma.taskEvent.create({
            data: {
                taskId,
                eventType,
                message: message ?? null,
                metadata: (metadata as never) ?? undefined,
            },
        });
    } catch (error) {
        // Don't let event logging failures break the task flow
        logger.warn({ msg: "Failed to log task event", taskId, eventType, error });
    }
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/**
 * Fetch a single task with its full event timeline and linked CronJob info.
 */
export async function getTaskWithEvents(taskId: string) {
    return prisma.workerTask.findUnique({
        where: { id: taskId },
        include: {
            events: {
                orderBy: { createdAt: "asc" },
            },
        },
    });
}

/**
 * Aggregated stats by category and status for the dashboard summary cards.
 */
export async function getTaskStats() {
    const [byCategory, byCategoryStatus, cronJobs] = await Promise.all([
        prisma.workerTask.groupBy({
            by: ["taskCategory"],
            _count: true,
        }),
        prisma.workerTask.groupBy({
            by: ["taskCategory", "status"],
            _count: true,
        }),
        prisma.cronJob.count({ where: { isActive: true } }),
    ]);

    // Build a structured stats object
    const categories = ["cron", "async", "regular"] as const;
    const stats: Record<string, { total: number; pending: number; running: number; completed: number; failed: number }> = {};

    for (const cat of categories) {
        stats[cat] = { total: 0, pending: 0, running: 0, completed: 0, failed: 0 };
        const catRow = byCategory.find((r) => r.taskCategory === cat);
        if (catRow) stats[cat].total = catRow._count;

        for (const row of byCategoryStatus) {
            if (row.taskCategory === cat && row.status in stats[cat]) {
                (stats[cat] as Record<string, number>)[row.status] = row._count;
            }
        }
    }

    return { stats, activeCronJobs: cronJobs };
}
