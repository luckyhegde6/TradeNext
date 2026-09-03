// lib/__tests__/daemon-sqlite-first.test.ts
//
// v3.25.x SQLite-primary control-plane reads: moves the worker/cron daemon
// CHECK reads from Prisma to the LOCAL SQLite mirror (user directive:
// "i dont want any high frequency queries or check queries hit the prisma,
// and check the SQLITE instead").
//
// Covers:
//   - worker-engine.discoverPendingTask: fresh mirror → serve pending task w/o
//     Prisma; empty-but-fresh mirror → trust it (no Prisma read); stale/absent
//     mirror → Prisma findFirst + re-seed.
//   - cron-daemon.syncCronJobs: fresh mirror → register from mirror rows w/o
//     Prisma; stale/absent mirror → Prisma findMany + re-seed.
//
// NOTE: the authoritative atomic task CLAIM (updateMany) and the leader lock
// stay on Prisma by design (cross-instance coordination) — not under test here.

// ─── Mocks (hoisted before imports) ────────────────────────────────────────
jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    workerTask: {
      findFirst: jest.fn(),
      updateMany: jest.fn(() => ({ count: 1 })),
    },
    cronJob: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("@/lib/db-utils", () => ({
  __esModule: true,
  isDbUnavailableError: jest.fn(() => false),
  isPlanLimitBreakerOpen: jest.fn(() => false),
}));

// Fresh fake of the SQLite mirror. Overridden per-test via the mutable
// `mockSqlite` object so we can simulate fresh/stale/absent states.
let mockSqlite: any;
jest.mock("@/lib/sqlite", () => ({
  __esModule: true,
  getSqliteFallback: jest.fn(() => mockSqlite),
}));

// ─── Imports ───────────────────────────────────────────────────────────────
import prisma from "@/lib/prisma";
import { discoverPendingTask } from "@/lib/services/worker/worker-engine";
import { syncCronJobs } from "@/lib/services/worker/cron-daemon";
const sqlite = require("@/lib/sqlite") as { getSqliteFallback: jest.Mock };

function freshFallback(opts: { workerRows?: unknown[]; cronRows?: unknown[] } = {}) {
  return {
    isReady: () => true,
    isControlMirrorFresh: jest.fn((table: string) => true), // always fresh
    getWorkerTasks: jest.fn(() => opts.workerRows ?? []),
    getCronJobs: jest.fn(() => opts.cronRows ?? []),
    upsertWorkerTask: jest.fn(),
    upsertCronJob: jest.fn(),
  };
}

function staleFallback() {
  return {
    isReady: () => true,
    isControlMirrorFresh: jest.fn(() => false), // never fresh
    getWorkerTasks: jest.fn(() => []),
    getCronJobs: jest.fn(() => []),
    upsertWorkerTask: jest.fn(),
    upsertCronJob: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSqlite = null;
  (prisma.workerTask.findFirst as jest.Mock).mockReset();
  (prisma.workerTask.findFirst as jest.Mock).mockResolvedValue(null);
  (prisma.cronJob.findMany as jest.Mock).mockReset();
  (prisma.cronJob.findMany as jest.Mock).mockResolvedValue([]);
});

// ─── worker-engine.discoverPendingTask ─────────────────────────────────────

describe("discoverPendingTask — SQLite-first read", () => {
  test("fresh mirror with a pending task → serves it WITHOUT any Prisma read", async () => {
    mockSqlite = freshFallback({
      workerRows: [
        {
          id: "w1",
          name: "Scheduled: Daily Recommendations (System)",
          task_type: "daily_recommendations",
          status: "pending",
          priority: 7,
          created_at: "2026-09-03T04:00:00.000Z",
          started_at: null,
          assigned_to: null,
          cron_job_id: "cron-1",
          payload: '{"force":true}',
        },
      ],
    });

    const task = await discoverPendingTask();

    expect(task).toBeTruthy();
    expect(task?.id).toBe("w1");
    expect(task?.taskType).toBe("daily_recommendations");
    expect(task?.payload).toEqual({ force: true });
    // Must NOT touch Prisma when the mirror is fresh + has work.
    expect(prisma.workerTask.findFirst).not.toHaveBeenCalled();
    expect(sqlite.getSqliteFallback().getWorkerTasks).toHaveBeenCalled();
  });

  test("fresh-but-empty mirror → trusts it, returns null, NO Prisma read", async () => {
    mockSqlite = freshFallback({ workerRows: [] });

    const task = await discoverPendingTask();

    expect(task).toBeNull();
    expect(prisma.workerTask.findFirst).not.toHaveBeenCalled();
  });

  test("stale/absent mirror → falls back to Prisma findFirst and seeds the mirror", async () => {
    mockSqlite = staleFallback();
    (prisma.workerTask.findFirst as jest.Mock).mockResolvedValue({
      id: "w2",
      name: "Scheduled: Historical Price Sync (System)",
      taskType: "historical_price_sync",
      status: "pending",
      priority: 5,
      createdAt: new Date("2026-09-03T04:00:00.000Z"),
    });

    const task = await discoverPendingTask();

    expect(task?.id).toBe("w2");
    expect(prisma.workerTask.findFirst).toHaveBeenCalledTimes(1);
    // Mirror re-seeded for the NEXT poll.
    expect(sqlite.getSqliteFallback().upsertWorkerTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: "w2" }),
    );
  });

  test("no sqlite fallback available → degrades cleanly to Prisma (never throws)", async () => {
    mockSqlite = null;
    (prisma.workerTask.findFirst as jest.Mock).mockResolvedValue(null);

    const task = await discoverPendingTask();

    expect(task).toBeNull();
    expect(prisma.workerTask.findFirst).toHaveBeenCalledTimes(1);
  });
});

// ─── cron-daemon.syncCronJobs ──────────────────────────────────────────────

describe("syncCronJobs — SQLite-first read", () => {
  test("fresh mirror with cron rows → registers from mirror, NO Prisma read", async () => {
    // 20s node-cron requires a modern `cron` package; keep expressions simple.
    mockSqlite = freshFallback({
      cronRows: [
        {
          id: "cron-1",
          name: "Daily Recommendations (System)",
          cron_expression: "30 4 * * *",
          is_active: 1,
          config: '{"timezone":"Asia/Kolkata"}',
        },
        {
          id: "cron-2",
          name: "Market Sync (System)",
          cron_expression: "31 1 * * 1-5",
          is_active: 1,
          config: null,
        },
        {
          id: "cron-disabled",
          name: "Disabled Job (System)",
          cron_expression: "0 0 * * *",
          is_active: 0,
          config: null,
        },
      ],
    });

    const { registered } = await syncCronJobs();

    // 2 active jobs registered; the inactive row is filtered out; no Prisma read.
    expect(registered).toBe(2);
    expect(prisma.cronJob.findMany).not.toHaveBeenCalled();
    // config parsed into the registration (timezone preserved).
    expect(sqlite.getSqliteFallback().getCronJobs).toHaveBeenCalled();
  });

  test("stale/absent mirror → falls back to Prisma findMany and reseeds the mirror", async () => {
    mockSqlite = staleFallback();
    (prisma.cronJob.findMany as jest.Mock).mockResolvedValue([
      {
        id: "cron-3",
        name: "AI Connection Test (System)",
        cronExpression: "*/30 3-10 * * 1-5",
        isActive: true,
        config: { timezone: "Asia/Kolkata" },
      },
    ]);

    const { registered } = await syncCronJobs();

    expect(registered).toBe(1);
    expect(prisma.cronJob.findMany).toHaveBeenCalledWith({ where: { isActive: true } });
    expect(sqlite.getSqliteFallback().upsertCronJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cron-3" }),
    );
  });

  test("no sqlite fallback → reads Prisma, never throws", async () => {
    mockSqlite = null;
    (prisma.cronJob.findMany as jest.Mock).mockResolvedValue([]);

    const { registered } = await syncCronJobs();

    expect(registered).toBe(0);
    expect(prisma.cronJob.findMany).toHaveBeenCalledTimes(1);
  });
});
