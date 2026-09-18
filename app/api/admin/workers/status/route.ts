// app/api/admin/workers/status/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { isDbUnavailableError } from "@/lib/db-utils";
import { getSqliteFallback } from "@/lib/sqlite";
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

/** SQLite mirror row (snake_case) → the Prisma `workerStatus` camelCase shape. */
function mapMirrorWorkerStatus(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id ?? null,
    workerId: row.workerId ?? row.worker_id ?? null,
    workerName: row.workerName ?? row.worker_name ?? null,
    status: row.status ?? "offline",
    currentTaskId: row.currentTaskId ?? row.current_task_id ?? null,
    cpuUsage: row.cpuUsage ?? row.cpu_usage ?? null,
    memoryUsage: row.memoryUsage ?? row.memory_usage ?? null,
    lastHeartbeat: row.lastHeartbeat ?? row.last_heartbeat ?? null,
  };
}

/** Drop workers whose heartbeat is older than 5 minutes (ISO string or Date). */
function filterWorkers<T extends { lastHeartbeat?: Date | string | null }>(
  workers: T[],
  includeOffline: boolean,
): T[] {
  if (includeOffline) return workers;
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  return workers.filter((w) => {
    const hb = w.lastHeartbeat;
    const ms = hb instanceof Date ? hb.getTime() : hb ? new Date(String(hb)).getTime() : NaN;
    return Number.isFinite(ms) && ms > fiveMinutesAgo;
  });
}

// POST - Worker heartbeat
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const includeOffline = searchParams.get("includeOffline") === "true";

    try {
      const workers = await prisma.workerStatus.findMany({
        orderBy: { lastHeartbeat: "desc" },
      });
      return NextResponse.json(filterWorkers(workers, includeOffline));
    } catch (error) {
      if (!isDbUnavailableError(error)) throw error;

      // Plan-limit hold / DB outage — serve the SQLite worker_status mirror.
      const sqlite = getSqliteFallback();
      const mirrored = sqlite?.isReady()
        ? sqlite.getWorkerStatuses().map(mapMirrorWorkerStatus)
        : [];
      logger.warn({ msg: "Workers status: DB unavailable — serving SQLite mirror", count: mirrored.length });
      return NextResponse.json(filterWorkers(mirrored, includeOffline));
    }
  } catch (error) {
    logger.error({ msg: "Failed to fetch workers", error });
    return NextResponse.json({ error: "Failed to fetch workers" }, { status: 500 });
  }
}
