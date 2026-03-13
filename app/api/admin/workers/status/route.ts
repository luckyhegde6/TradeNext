// app/api/admin/workers/status/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { z } from "zod";

export const runtime = "nodejs";

// Worker heartbeat validation
const heartbeatSchema = z.object({
  workerId: z.string(),
  workerName: z.string().optional(),
  status: z.enum(["idle", "busy", "offline"]),
  currentTaskId: z.string().optional(),
  cpuUsage: z.number().optional(),
  memoryUsage: z.number().optional(),
});

// POST - Worker heartbeat
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const validated = heartbeatSchema.parse(body);

    const worker = await prisma.workerStatus.upsert({
      where: { workerId: validated.workerId },
      create: {
        workerId: validated.workerId,
        workerName: validated.workerName,
        status: validated.status,
        currentTaskId: validated.currentTaskId,
        cpuUsage: validated.cpuUsage,
        memoryUsage: validated.memoryUsage,
        lastHeartbeat: new Date(),
      },
      update: {
        workerName: validated.workerName,
        status: validated.status,
        currentTaskId: validated.currentTaskId,
        cpuUsage: validated.cpuUsage,
        memoryUsage: validated.memoryUsage,
        lastHeartbeat: new Date(),
      },
    });

    return NextResponse.json(worker);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Validation error", details: error.issues }, { status: 400 });
    }
    logger.error({ msg: "Worker heartbeat failed", error });
    return NextResponse.json({ error: "Failed to update worker status" }, { status: 500 });
  }
}

// GET - Get all workers status
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const includeOffline = searchParams.get("includeOffline") === "true";

    const workers = await prisma.workerStatus.findMany({
      orderBy: { lastHeartbeat: "desc" },
    });

    // Filter out offline workers older than 5 minutes
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    const filteredWorkers = includeOffline
      ? workers
      : workers.filter((w) => w.lastHeartbeat > fiveMinutesAgo);

    return NextResponse.json(filteredWorkers);
  } catch (error) {
    logger.error({ msg: "Failed to fetch workers", error });
    return NextResponse.json({ error: "Failed to fetch workers" }, { status: 500 });
  }
}
