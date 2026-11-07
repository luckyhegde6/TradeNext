import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

export const runtime = "nodejs";

const ACTIVE_WINDOW_MS = 15 * 60_000;
const HISTORY_WINDOW_MS = 24 * 60 * 60_000;
const TASK_HISTORY_WINDOW_MS = 7 * 24 * 60 * 60_000;
const MAX_INSTANCES = 50;
const MAX_CRONS = 30;
const MAX_TASKS = 40;
const MAX_LEASE_EVENTS = 20;

const TRACKED_TASK_TYPES = [
  "recommendations",
  "recommendation_performance",
  "swing_performance",
  "historical_price_sync",
];

function iso(value: Date | null | undefined): string | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

/** Leader lease workerId constant (shared with lib/services/leader.ts). */
const LEASE_WORKER_ID = "leader-worker";

/**
 * Admin-only runtime ledger. Kept separate from /api/admin/db-health so the
 * core DB-health refresh remains zero-Prisma; this view is intentionally bounded.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const historyCutoff = new Date(now - HISTORY_WINDOW_MS);
  const taskHistoryCutoff = new Date(now - TASK_HISTORY_WINDOW_MS);

  try {
    const [workers, crons, tasks, leaseRow, pendingCount, recentEvents] =
      await Promise.all([
        prisma.workerStatus.findMany({
          where: { lastHeartbeat: { gte: historyCutoff } },
          orderBy: { lastHeartbeat: "desc" },
          take: MAX_INSTANCES,
          select: {
            workerId: true,
            workerName: true,
            status: true,
            currentTaskId: true,
            lastHeartbeat: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.cronJob.findMany({
          orderBy: [{ nextRun: "asc" }, { lastRun: "desc" }],
          take: MAX_CRONS,
          select: {
            id: true,
            name: true,
            taskType: true,
            cronExpression: true,
            isActive: true,
            lastRun: true,
            nextRun: true,
            runCount: true,
            successCount: true,
            failureCount: true,
            createdAt: true,
            updatedAt: true,
            config: true,
          },
        }),
        prisma.workerTask.findMany({
          where: {
            taskType: { in: TRACKED_TASK_TYPES },
            createdAt: { gte: taskHistoryCutoff },
          },
          orderBy: { createdAt: "desc" },
          take: MAX_TASKS,
          select: {
            id: true,
            name: true,
            taskType: true,
            taskCategory: true,
            status: true,
            triggeredBy: true,
            cronJobId: true,
            assignedTo: true,
            createdAt: true,
            startedAt: true,
            completedAt: true,
            error: true,
            events: {
              orderBy: { createdAt: "desc" },
              take: 6,
              select: { eventType: true, message: true, createdAt: true },
            },
          },
        }),
        // Lease row — the shared worker lease for serverless runners.
        prisma.workerStatus.findUnique({
          where: { workerId: LEASE_WORKER_ID },
          select: {
            workerId: true,
            workerName: true,
            status: true,
            currentTaskId: true,
            lastHeartbeat: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        // Queue depth: pending tasks eligible for claiming.
        prisma.workerTask.count({
          where: { status: "pending" },
        }),
        // Recent task events for tick→runner→task→publish correlation.
        prisma.taskEvent.findMany({
          where: { createdAt: { gte: taskHistoryCutoff } },
          orderBy: { createdAt: "desc" },
          take: MAX_LEASE_EVENTS,
          select: {
            id: true,
            taskId: true,
            eventType: true,
            message: true,
            metadata: true,
            createdAt: true,
          },
        }),
      ]);

    return NextResponse.json({
      timestamp: new Date(now).toISOString(),
      activeWindowMs: ACTIVE_WINDOW_MS,
      historyWindowMs: HISTORY_WINDOW_MS,
      taskHistoryWindowMs: TASK_HISTORY_WINDOW_MS,
      // This is a live-instance view, not a worker-status archive. Idle or
      // stale records are omitted; their persisted rows remain for diagnostics.
      excludedInstanceCount: workers.filter((w) => {
        const heartbeatAt = iso(w.lastHeartbeat);
        const ageMs = heartbeatAt ? Math.max(0, now - new Date(heartbeatAt).getTime()) : null;
        return ageMs === null || ageMs > ACTIVE_WINDOW_MS || String(w.status).toLowerCase() === "idle";
      }).length,
      instances: workers.flatMap((w) => {
        const heartbeatAt = iso(w.lastHeartbeat);
        const ageMs = heartbeatAt ? Math.max(0, now - new Date(heartbeatAt).getTime()) : null;
        const active = ageMs !== null && ageMs <= ACTIVE_WINDOW_MS;
        if (!active || String(w.status).toLowerCase() === "idle") return [];
        return [{
          workerId: w.workerId,
          workerName: w.workerName,
          role: w.workerId.startsWith("leader-")
            ? w.workerId.slice("leader-".length)
            : w.workerId.startsWith("cron-daemon-")
              ? "cron-daemon"
              : "worker",
          status: w.status,
          currentTaskId: w.currentTaskId,
          firstSeenAt: iso(w.createdAt),
          lastHeartbeatAt: heartbeatAt,
          heartbeatAgeMs: ageMs,
          active,
          updatedAt: iso(w.updatedAt),
        }];
      }),
      crons: crons.map((c) => ({
        id: c.id,
        name: c.name,
        taskType: c.taskType,
        cronExpression: c.cronExpression,
        timezone: typeof c.config === "object" && c.config && "timezone" in c.config
          ? String((c.config as Record<string, unknown>).timezone)
          : "UTC",
        isActive: c.isActive,
        lastRunAt: iso(c.lastRun),
        nextRunAt: iso(c.nextRun),
        runCount: c.runCount,
        successCount: c.successCount,
        failureCount: c.failureCount,
        createdAt: iso(c.createdAt),
        updatedAt: iso(c.updatedAt),
      })),
      tasks: tasks.map((t) => {
        const cronName = t.cronJobId ? crons.find((c) => c.id === t.cronJobId)?.name : null;
        const triggerLabel = cronName?.includes("(System)")
          ? "system cron"
          : t.triggeredBy ?? "unknown";
        return {
        id: t.id,
        name: t.name,
        taskType: t.taskType,
        taskCategory: t.taskCategory,
        status: t.status,
        triggeredBy: t.triggeredBy,
        triggerLabel,
        cronJobId: t.cronJobId,
        assignedTo: t.assignedTo,
        createdAt: iso(t.createdAt),
        startedAt: iso(t.startedAt),
        completedAt: iso(t.completedAt),
        durationMs: t.startedAt && t.completedAt
          ? Math.max(0, t.completedAt.getTime() - t.startedAt.getTime())
          : null,
        error: t.error,
        events: t.events.map((e) => ({
          eventType: e.eventType,
          message: e.message,
          at: iso(e.createdAt),
        })),
      };
      }),
      // Lease observability — shared worker lease for serverless runners
      // (Spec 42 §5.8). Fail-closed lease means no local leader on DB down.
      lease: leaseRow
        ? {
            workerId: leaseRow.workerId,
            workerName: leaseRow.workerName ?? null,
            status: leaseRow.status,
            currentTaskId: leaseRow.currentTaskId ?? null,
            lastHeartbeatAt: iso(leaseRow.lastHeartbeat),
            createdAt: iso(leaseRow.createdAt),
            updatedAt: iso(leaseRow.updatedAt),
            heartbeatAgeMs:
              leaseRow.lastHeartbeat !== null
                ? Math.max(0, now - new Date(leaseRow.lastHeartbeat).getTime())
                : null,
          }
        : null,
      // Scheduler observability — cron tick → runner → task → publish.
      scheduler: {
        queueDepth: pendingCount,
        trackedCrons: crons.filter((c) =>
          TRACKED_TASK_TYPES.includes(c.taskType),
        ).map((c) => ({
          id: c.id,
          name: c.name,
          taskType: c.taskType,
          nextRunAt: iso(c.nextRun),
          lastRunAt: iso(c.lastRun),
          runCount: c.runCount,
          successCount: c.successCount,
          failureCount: c.failureCount,
        })),
        recentEvents: recentEvents.map((e) => ({
          id: e.id,
          taskId: e.taskId,
          eventType: e.eventType,
          message: e.message ?? null,
          at: iso(e.createdAt),
        })),
      },
    });
  } catch (error) {
    logger.error({
      msg: "DB Health runtime activity read failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Runtime activity unavailable" }, { status: 503 });
  }
}
