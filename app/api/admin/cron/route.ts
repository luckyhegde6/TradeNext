// app/api/admin/cron/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { z } from "zod";

export const runtime = "nodejs";

// Cron job validation schema
const cronJobSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  taskType: z.enum(["stock_sync", "corp_actions", "alert_check", "screener", "recommendations", "market_data"]),
  cronExpression: z.string().min(9), // Minimum cron expression
  isActive: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

// GET - List all cron jobs
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const isActive = searchParams.get("isActive");
    const taskType = searchParams.get("taskType");

    const where: Record<string, unknown> = {};
    if (isActive !== null) where.isActive = isActive === "true";
    if (taskType) where.taskType = taskType;

    const cronJobs = await prisma.cronJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(cronJobs);
  } catch (error) {
    logger.error({ msg: "Failed to fetch cron jobs", error });
    return NextResponse.json({ error: "Failed to fetch cron jobs" }, { status: 500 });
  }
}

// POST - Create a new cron job
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const validated = cronJobSchema.parse(body);

    // Calculate next run time
    const nextRun = calculateNextRun(validated.cronExpression);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const configData = validated.config as any;

    const cronJob = await prisma.cronJob.create({
      data: {
        name: validated.name,
        description: validated.description || null,
        taskType: validated.taskType,
        cronExpression: validated.cronExpression,
        isActive: validated.isActive ?? true,
        config: configData || undefined,
        nextRun,
        createdBy: session.user.id ? parseInt(session.user.id) : null,
      },
    });

    logger.info({ msg: "Cron job created", cronJobId: cronJob.id, taskType: cronJob.taskType });
    return NextResponse.json(cronJob, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Validation error", details: error.issues }, { status: 400 });
    }
    logger.error({ msg: "Failed to create cron job", error });
    return NextResponse.json({ error: "Failed to create cron job" }, { status: 500 });
  }
}

// PUT - Update a cron job
export async function PUT(req: Request) {
  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing cron job ID" }, { status: 400 });
    }

    const body = await req.json();
    const validated = cronJobSchema.partial().parse(body);

    // Build update data
    const dataToUpdate: Record<string, unknown> = {};
    if (validated.name !== undefined) dataToUpdate.name = validated.name;
    if (validated.description !== undefined) dataToUpdate.description = validated.description || null;
    if (validated.taskType !== undefined) dataToUpdate.taskType = validated.taskType;
    if (validated.cronExpression !== undefined) {
      dataToUpdate.cronExpression = validated.cronExpression;
      dataToUpdate.nextRun = calculateNextRun(validated.cronExpression);
    }
    if (validated.isActive !== undefined) dataToUpdate.isActive = validated.isActive;
    if (validated.config !== undefined) dataToUpdate.config = validated.config as never;

    const cronJob = await prisma.cronJob.update({
      where: { id },
      data: dataToUpdate,
    });

    logger.info({ msg: "Cron job updated", cronJobId: cronJob.id });
    return NextResponse.json(cronJob);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Validation error", details: error.issues }, { status: 400 });
    }
    logger.error({ msg: "Failed to update cron job", error });
    return NextResponse.json({ error: "Failed to update cron job" }, { status: 500 });
  }
}

// DELETE - Delete a cron job
export async function DELETE(req: Request) {
  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing cron job ID" }, { status: 400 });
    }

    await prisma.cronJob.delete({ where: { id } });

    logger.info({ msg: "Cron job deleted", cronJobId: id });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ msg: "Failed to delete cron job", error });
    return NextResponse.json({ error: "Failed to delete cron job" }, { status: 500 });
  }
}

// Helper function to calculate next run time from cron expression
function calculateNextRun(cronExpression: string): Date {
  // Simple cron parser for common intervals
  // Format: minute hour day month dayOfWeek
  const parts = cronExpression.split(" ");
  
  const now = new Date();
  const next = new Date(now);

  // Handle different cron patterns
  if (parts.length >= 5) {
    const [minute, hour] = parts;
    
    // Daily at specific time (e.g., "0 6 * * *" = daily at 6 AM)
    if (parts[2] === "*" && parts[3] === "*") {
      next.setHours(parseInt(hour) || 0, parseInt(minute) || 0, 0, 0);
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
    }
    // Weekly (e.g., "0 6 * * 1" = every Monday at 6 AM)
    else if (parts[2] === "*" && parts[3] === "*" && parts[4] !== "*") {
      const dayOfWeek = parseInt(parts[4]);
      next.setHours(parseInt(hour) || 0, parseInt(minute) || 0, 0, 0);
      while (next.getDay() !== dayOfWeek || next <= now) {
        next.setDate(next.getDate() + 1);
      }
    }
    // Monthly (e.g., "0 6 1 * *" = 1st of every month at 6 AM)
    else if (parts[3] === "*" && parts[4] === "*") {
      const dayOfMonth = parseInt(parts[2]) || 1;
      next.setDate(dayOfMonth);
      next.setHours(parseInt(hour) || 0, parseInt(minute) || 0, 0, 0);
      if (next <= now) {
        next.setMonth(next.getMonth() + 1);
      }
    }
    // Hourly (e.g., "0 * * * *" = every hour)
    else if (parts[0] !== "*" && parts[1] === "*") {
      next.setHours(next.getHours() + 1, parseInt(minute) || 0, 0, 0);
    }
    // Every 5 minutes for testing (e.g., "*/5 * * * *")
    else if (parts[0].startsWith("*/")) {
      const interval = parseInt(parts[0].replace("*/", "")) || 5;
      next.setMinutes(next.getMinutes() + interval, 0, 0);
    }
  }

  return next;
}
