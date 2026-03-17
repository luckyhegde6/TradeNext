// app/api/admin/workers/trigger/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { spawnCronTask, getTaskWithEvents } from "@/lib/services/worker/task-orchestrator";

export const runtime = "nodejs";

/**
 * POST — Trigger a cron job to run now (creates a worker task from a CronJob).
 * GET  — Fetch a task with its full event timeline.
 */

// POST - Trigger a cron job
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session || session.user.role !== "admin") {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { cronJobId } = body;

        if (!cronJobId) {
            return NextResponse.json({ error: "cronJobId is required" }, { status: 400 });
        }

        // Fetch the cron job
        const cronJob = await prisma.cronJob.findUnique({ where: { id: cronJobId } });
        if (!cronJob) {
            return NextResponse.json({ error: "Cron job not found" }, { status: 404 });
        }

        // Spawn a cron task from this job
        const task = await spawnCronTask(cronJobId, {
            name: `Manual: ${cronJob.name}`,
            taskType: cronJob.taskType,
            priority: 8, // Manual triggers get high priority
            payload: (cronJob.config as Record<string, unknown>) ?? undefined,
            createdBy: session.user.id ? parseInt(session.user.id) : undefined,
        });

        logger.info({ msg: "Cron job triggered manually", cronJobId, taskId: task.id });

        return NextResponse.json({ task, cronJob: { id: cronJob.id, name: cronJob.name } }, { status: 201 });
    } catch (error) {
        logger.error({ msg: "Failed to trigger cron job", error });
        return NextResponse.json({ error: "Failed to trigger cron job" }, { status: 500 });
    }
}

// GET - Fetch task with events timeline
export async function GET(req: Request) {
    try {
        const session = await auth();
        if (!session || session.user.role !== "admin") {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const taskId = searchParams.get("taskId");

        if (!taskId) {
            return NextResponse.json({ error: "taskId is required" }, { status: 400 });
        }

        const task = await getTaskWithEvents(taskId);
        if (!task) {
            return NextResponse.json({ error: "Task not found" }, { status: 404 });
        }

        // Also fetch linked cron job if present
        let cronJob = null;
        if (task.cronJobId) {
            cronJob = await prisma.cronJob.findUnique({ where: { id: task.cronJobId } });
        }

        return NextResponse.json({ task, cronJob });
    } catch (error) {
        logger.error({ msg: "Failed to fetch task details", error });
        return NextResponse.json({ error: "Failed to fetch task details" }, { status: 500 });
    }
}
