// app/api/admin/workers/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { z } from "zod";

export const runtime = "nodejs";

// Worker task validation schema
const workerTaskSchema = z.object({
  name: z.string().min(1),
  taskType: z.enum(["alert_check", "screener", "recommendations", "data_sync", "cleanup", "stock_sync", "csv_processing", "historical_sync"]),
  taskCategory: z.enum(["cron", "async", "regular"]).optional(),
  priority: z.number().min(1).max(10).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  maxRetries: z.number().min(0).max(10).optional(),
  cronJobId: z.string().optional(),
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
    const limit = parseInt(searchParams.get("limit") || "50");

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (taskType) where.taskType = taskType;
    if (taskCategory) where.taskCategory = taskCategory;

    const tasks = await prisma.workerTask.findMany({
      where,
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      take: limit,
    });

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

    return NextResponse.json({ tasks, stats, statsByCategory });
  } catch (error) {
    logger.error({ msg: "Failed to fetch worker tasks", error });
    return NextResponse.json({ error: "Failed to fetch worker tasks" }, { status: 500 });
  }
}

// POST - Create a new worker task
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const validated = workerTaskSchema.parse(body);

    const task = await prisma.workerTask.create({
      data: {
        name: validated.name,
        taskType: validated.taskType,
        taskCategory: validated.taskCategory ?? "regular",
        priority: validated.priority ?? 5,
        maxRetries: validated.maxRetries ?? 3,
        payload: (validated.payload as never) ?? undefined,
        createdBy: session.user.id ? parseInt(session.user.id) : null,
        cronJobId: validated.cronJobId,
      },
    });

    logger.info({ msg: "Worker task created", taskId: task.id, taskType: task.taskType, taskCategory: task.taskCategory });
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
