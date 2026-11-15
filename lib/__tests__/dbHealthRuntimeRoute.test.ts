/* @jest-environment node */

import { GET } from "@/app/api/admin/db-health/runtime/route";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    workerStatus: { findMany: jest.fn(), findUnique: jest.fn() },
    cronJob: { findMany: jest.fn() },
    workerTask: { findMany: jest.fn(), count: jest.fn() },
    taskEvent: { findMany: jest.fn() },
  },
}));

const mockAuth = auth as jest.Mock;
const mockPrisma = prisma as unknown as {
  workerStatus: { findMany: jest.Mock; findUnique: jest.Mock };
  cronJob: { findMany: jest.Mock };
  workerTask: { findMany: jest.Mock; count: jest.Mock };
  taskEvent: { findMany: jest.Mock };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "1", role: "admin" } });
  mockPrisma.workerStatus.findMany.mockResolvedValue([
    {
      workerId: "worker-instance-a",
      workerName: "node-a",
      status: "busy",
      currentTaskId: "task-a",
      lastHeartbeat: new Date(),
      createdAt: new Date("2026-11-04T00:00:00.000Z"),
      updatedAt: new Date(),
    },
    {
      workerId: "worker-stale",
      workerName: "node-old",
      status: "idle",
      currentTaskId: null,
      lastHeartbeat: new Date(Date.now() - 60 * 60_000),
      createdAt: new Date("2026-11-03T00:00:00.000Z"),
      updatedAt: new Date(),
    },
    {
      workerId: "worker-idle-live",
      workerName: "node-idle",
      status: "idle",
      currentTaskId: null,
      lastHeartbeat: new Date(),
      createdAt: new Date("2026-11-04T00:00:00.000Z"),
      updatedAt: new Date(),
    },
  ]);
  mockPrisma.cronJob.findMany.mockResolvedValue([
    {
      id: "cron-1", name: "Daily Recommendations (System)", taskType: "recommendations",
      cronExpression: "30 4 * * 1-5", isActive: true, lastRun: new Date("2026-11-03T04:30:00Z"),
      nextRun: new Date("2026-11-04T04:30:00Z"), runCount: 10, successCount: 9, failureCount: 1,
      createdAt: new Date(), updatedAt: new Date(), config: { timezone: "UTC" },
    },
  ]);
  mockPrisma.workerTask.findMany.mockResolvedValue([
    {
      id: "task-1", name: "Daily Recommendations (System)", taskType: "recommendations",
      taskCategory: "cron", status: "completed", triggeredBy: "cron", cronJobId: "cron-1",
      assignedTo: "worker-instance-a", createdAt: new Date("2026-11-04T04:00:00Z"),
      startedAt: new Date("2026-11-04T04:01:00Z"), completedAt: new Date("2026-11-04T04:06:00Z"),
      error: null, events: [{ eventType: "task_completed", message: "done", createdAt: new Date() }],
    },
  ]);
  mockPrisma.workerStatus.findUnique.mockResolvedValue({
    workerId: "leader-worker",
    workerName: "node-a",
    status: "busy",
    currentTaskId: "task-a",
    lastHeartbeat: new Date(),
    createdAt: new Date("2026-11-04T00:00:00.000Z"),
    updatedAt: new Date(),
  });
  mockPrisma.workerTask.count.mockResolvedValue(0);
  mockPrisma.taskEvent.findMany.mockResolvedValue([]);
});

describe("GET /api/admin/db-health/runtime", () => {
  it("requires admin auth", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "user" } });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockPrisma.workerStatus.findMany).not.toHaveBeenCalled();
  });

  it("returns bounded instance, cron and task timestamps with active/stale classification", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.instances).toHaveLength(1);
    expect(body.instances[0].active).toBe(true);
    expect(body.instances[0].firstSeenAt).toBe("2026-11-04T00:00:00.000Z");
    expect(body.excludedInstanceCount).toBe(2);
    expect(body.instances.some((x: { status: string }) => x.status === "idle")).toBe(false);
    expect(body.crons[0].nextRunAt).toBe("2026-11-04T04:30:00.000Z");
    expect(body.tasks[0].triggerLabel).toBe("system cron");
    expect(body.tasks[0].durationMs).toBe(5 * 60_000);
    expect(body.tasks[0].events[0].eventType).toBe("task_completed");
    expect(mockPrisma.workerTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 40,
      where: expect.objectContaining({ taskType: { in: expect.arrayContaining(["recommendations", "recommendation_performance", "swing_performance"]) } }),
    }));
  });

  it("returns a safe service error on database failure", async () => {
    mockPrisma.cronJob.findMany.mockRejectedValue(new Error("database secret details"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Runtime activity unavailable" });
  });
});
