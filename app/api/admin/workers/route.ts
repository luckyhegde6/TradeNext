// app/api/admin/workers/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { z } from "zod";
import {
  spawnCronTask,
  spawnAsyncTask,
  spawnRegularTask,
  getTaskWithEvents,
  getTaskStats,
} from "@/lib/services/worker/task-orchestrator";
import { executeTask } from "@/lib/services/worker/worker-service";

export const runtime = "nodejs";

// Worker task validation schema
const workerTaskSchema = z.object({
  name: z.string().min(1),
  taskType: z.enum([
    // Cron types
    "alert_check", "screener", "recommendations", "data_sync", "stock_sync", "corp_actions", "market_data",
    "corp_actions_fetch", "events_fetch", "news_fetch", "market_data_fetch", "announcement_fetch", "screener_sync",
    // Async types
    "csv_processing", "historical_sync",
    // Regular types
    "cleanup", "password_reset", "notification_broadcast", "announcement_mgmt", "user_query", "maintenance",
    // F-Score types
    "fscore_calc", "fscore_batch", "fscore_single",
  ]),
  taskCategory: z.enum(["cron", "async", "regular"]).optional(),
  priority: z.number().min(1).max(10).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  maxRetries: z.number().min(0).max(10).optional(),
  cronJobId: z.string().optional(),
  parentTaskId: z.string().optional(),
  triggeredBy: z.string().optional(),
});

// Action schema for task management
const taskActionSchema = z.object({
  action: z.enum(["runNow", "cancel", "retry", "delete"]),
  taskId: z.string().min(1),
});

// GET - List worker tasks
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const taskType = searchParams.get("taskType");
    const taskCategory = searchParams.get("taskCategory");
    const taskId = searchParams.get("taskId");
    const limit = parseInt(searchParams.get("limit") || "50");

    // If requesting a specific task with events
    if (taskId) {
      const task = await getTaskWithEvents(taskId);
      if (!task) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }
      return NextResponse.json({ task });
    }

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (taskType) where.taskType = taskType;
    if (taskCategory) where.taskCategory = taskCategory;

    const tasks = await prisma.workerTask.findMany({
      where,
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: limit,
    });

    // Get stats from orchestrator
    const taskStats = await getTaskStats();

    // Get queue stats by category
    const statsByCategory = await prisma.workerTask.groupBy({
      by: ["taskCategory", "status"],
      _count: true,
    });

    // Get overall stats
    const stats = await prisma.workerTask.groupBy({
      by: ["status"],
      _count: true,
    });

    return NextResponse.json({ tasks, stats, statsByCategory, taskStats });
  } catch (error) {
    logger.error({ msg: "Failed to fetch worker tasks", error });
    return NextResponse.json({ error: "Failed to fetch worker tasks" }, { status: 500 });
  }
}

// POST - Create a new worker task via orchestrator
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const validated = workerTaskSchema.parse(body);
    const createdBy = session.user.id ? parseInt(session.user.id) : undefined;
    const category = validated.taskCategory ?? "regular";

    let task;

    switch (category) {
      case "cron":
        if (!validated.cronJobId) {
          return NextResponse.json({ error: "cronJobId required for cron tasks" }, { status: 400 });
        }
        task = await spawnCronTask(validated.cronJobId, {
          name: validated.name,
          taskType: validated.taskType,
          priority: validated.priority,
          maxRetries: validated.maxRetries,
          payload: validated.payload,
          createdBy,
          parentTaskId: validated.parentTaskId,
        });
        break;

      case "async":
        task = await spawnAsyncTask({
          name: validated.name,
          taskType: validated.taskType,
          priority: validated.priority,
          maxRetries: validated.maxRetries,
          payload: validated.payload,
          createdBy,
          parentTaskId: validated.parentTaskId,
          triggeredBy: validated.triggeredBy,
        });
        break;

      default:
        task = await spawnRegularTask({
          name: validated.name,
          taskType: validated.taskType,
          priority: validated.priority,
          maxRetries: validated.maxRetries,
          payload: validated.payload,
          createdBy,
          parentTaskId: validated.parentTaskId,
          triggeredBy: validated.triggeredBy,
        });
        break;
    }

    logger.info({ msg: "Worker task created via orchestrator", taskId: task.id, taskType: task.taskType, taskCategory: task.taskCategory });
    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Validation error", details: error.issues }, { status: 400 });
    }
    logger.error({ msg: "Failed to create worker task", error });
    return NextResponse.json({ error: "Failed to create worker task" }, { status: 500 });
  }
}

// PUT - Update a worker task
export async function PUT(req: Request) {
  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing task ID" }, { status: 400 });
    }

    const body = await req.json();
    const { status, result, error } = body;

    const updateData: Record<string, unknown> = {};
    if (status) updateData.status = status;
    if (result) updateData.result = result;
    if (error) updateData.error = error;

    // Update timestamps based on status
    if (status === "running" && !body.startedAt) {
      updateData.startedAt = new Date();
    }
    if ((status === "completed" || status === "failed") && !body.completedAt) {
      updateData.completedAt = new Date();
    }

    const task = await prisma.workerTask.update({
      where: { id },
      data: updateData,
    });

    logger.info({ msg: "Worker task updated", taskId: task.id, status: task.status });
    return NextResponse.json(task);
  } catch (error) {
    logger.error({ msg: "Failed to update worker task", error });
    return NextResponse.json({ error: "Failed to update worker task" }, { status: 500 });
  }
}

// DELETE - Delete a worker task
export async function DELETE(req: Request) {
  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing task ID" }, { status: 400 });
    }

    await prisma.workerTask.delete({ where: { id } });

    logger.info({ msg: "Worker task deleted", taskId: id });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ msg: "Failed to delete worker task", error });
    return NextResponse.json({ error: "Failed to delete worker task" }, { status: 500 });
  }
}

// PATCH - Task actions (run now, cancel, retry)
export async function PATCH(req: Request) {
  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { action, taskId } = taskActionSchema.parse(body);

    // Get the task
    const task = await prisma.workerTask.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    switch (action) {
      case "runNow": {
        // Can only run pending tasks immediately
        if (task.status !== "pending" && task.status !== "failed") {
          return NextResponse.json({ 
            error: `Cannot run task in "${task.status}" status. Only "pending" or "failed" tasks can be run.` 
          }, { status: 400 });
        }

        // Update status to pending
        await prisma.workerTask.update({
          where: { id: taskId },
          data: { status: "pending", startedAt: null, completedAt: null, error: null },
        });

        // Execute the task
        const result = await executeTask(taskId, task.taskType, task.payload as Record<string, unknown>);

        return NextResponse.json({ 
          success: true, 
          action: "runNow",
          taskId,
          result 
        });
      }

      case "cancel": {
        // Can only cancel pending or running tasks
        if (task.status !== "pending" && task.status !== "running") {
          return NextResponse.json({ 
            error: `Cannot cancel task in "${task.status}" status. Only "pending" or "running" tasks can be cancelled.` 
          }, { status: 400 });
        }

        // Update status to cancelled
        await prisma.workerTask.update({
          where: { id: taskId },
          data: { 
            status: "cancelled", 
            completedAt: new Date(),
          },
        });

        logger.info({ msg: "Worker task cancelled by admin", taskId });

        return NextResponse.json({ 
          success: true, 
          action: "cancel",
          taskId 
        });
      }

      case "retry": {
        // Can only retry failed tasks
        if (task.status !== "failed") {
          return NextResponse.json({ 
            error: `Cannot retry task in "${task.status}" status. Only "failed" tasks can be retried.` 
          }, { status: 400 });
        }

        // Update status to pending
        await prisma.workerTask.update({
          where: { id: taskId },
          data: { status: "pending", startedAt: null, completedAt: null, error: null },
        });

        // Execute the task
        const result = await executeTask(taskId, task.taskType, task.payload as Record<string, unknown>);

        return NextResponse.json({ 
          success: true, 
          action: "retry",
          taskId,
          result 
        });
      }

      case "delete": {
        await prisma.workerTask.delete({ where: { id: taskId } });
        logger.info({ msg: "Worker task deleted by admin", taskId });
        return NextResponse.json({ success: true, action: "delete", taskId });
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Validation error", details: error.issues }, { status: 400 });
    }
    logger.error({ msg: "Failed to perform task action", error });
    return NextResponse.json({ error: "Failed to perform task action" }, { status: 500 });
  }
}
