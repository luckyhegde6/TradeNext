// app/api/admin/workers/execute/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

export const runtime = "nodejs";

// GET - Worker picks up next available task
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const workerId = searchParams.get("workerId");

    if (!workerId) {
      return NextResponse.json({ error: "Missing workerId" }, { status: 400 });
    }

    // Find next pending task (highest priority first)
    const task = await prisma.workerTask.findFirst({
      where: {
        status: "pending",
      },
      orderBy: [
        { priority: "desc" },
        { createdAt: "asc" },
      ],
    });

    if (!task) {
      return NextResponse.json({ task: null, message: "No tasks available" });
    }

    // Assign task to worker
    const updatedTask = await prisma.workerTask.update({
      where: { id: task.id },
      data: {
        status: "running",
        assignedTo: workerId,
        startedAt: new Date(),
      },
    });

    logger.info({ msg: "Task assigned to worker", taskId: task.id, workerId });

    return NextResponse.json({ task: updatedTask });
  } catch (error) {
    logger.error({ msg: "Failed to get task", error });
    return NextResponse.json({ error: "Failed to get task" }, { status: 500 });
  }
}

// PUT - Worker completes or fails a task
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { taskId, status, result, error } = body;

    if (!taskId || !status) {
      return NextResponse.json({ error: "Missing taskId or status" }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {
      status,
    };

    if (status === "completed") {
      updateData.completedAt = new Date();
      updateData.result = result;
    } else if (status === "failed") {
      updateData.completedAt = new Date();
      updateData.error = error;
      
      // Check if we should retry
      const task = await prisma.workerTask.findUnique({ where: { id: taskId } });
      if (task && task.retryCount < task.maxRetries) {
        updateData.status = "pending";
        updateData.retryCount = { increment: 1 };
        updateData.assignedTo = null;
        updateData.startedAt = null;
      }
    }

    const updatedTask = await prisma.workerTask.update({
      where: { id: taskId },
      data: updateData,
    });

    logger.info({ msg: "Task updated", taskId, status });

    return NextResponse.json({ task: updatedTask });
  } catch (error) {
    logger.error({ msg: "Failed to update task", error });
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}
