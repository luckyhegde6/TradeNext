// lib/__tests__/sqlite.test.ts
//
// Tests for the SQLite backup fallback layer.
// Mocks sql.js with a minimal in-memory implementation + mocks Prisma.

/* eslint-disable @typescript-eslint/no-require-imports */

// ── Mock sql.js ──────────────────────────────────────────────────────────
// The store is a global object so the mock class and test code share it.
// We initialize it INSIDE the factory (jest.mock is hoisted, so module-level
// const/let are still in TDZ when the factory first runs).

jest.mock("sql.js", () => {
  const store: Record<string, { columns: string[]; rows: any[][] }> = {};

  class MockDatabase {
    run(sql: string, _params: any[] = []) {
      // Split multi-statement SQL on ; and process each
      const stmts = sql.split(";").map((s) => s.trim()).filter(Boolean);
      for (const stmt of stmts) {
        const upper = stmt.toUpperCase();
        if (upper.startsWith("CREATE TABLE")) {
          const m = stmt.match(/CREATE TABLE IF NOT EXISTS (\w+)/i);
          if (m && !store[m[1]]) store[m[1]] = { columns: [], rows: [] };
        } else if (upper.startsWith("DELETE")) {
          const m = stmt.match(/DELETE FROM (\w+)/i);
          if (m && store[m[1]]) store[m[1]].rows = [];
        } else if (upper.startsWith("INSERT")) {
          const m = stmt.match(/INSERT OR REPLACE INTO (\w+)/i);
          if (m && store[m[1]]) {
            const t = store[m[1]];
            if (t.columns.length === 0) {
              const colM = stmt.match(/\(([^)]+)\)/);
              if (colM) t.columns = colM[1].split(",").map((c: string) => c.trim());
            }
            t.rows.push([..._params]);
          }
        }
      }
    }

    exec(sql: string, params: any[] = []) {
      const upper = sql.trim().toUpperCase();
      if (!upper.startsWith("SELECT")) return [];

      // COUNT(*) handling
      if (upper.includes("COUNT(*)")) {
        const tableM = sql.match(/FROM (\w+)/i);
        if (!tableM) return [];
        const t = store[tableM[1]];
        if (!t) return [{ columns: ["cnt"], values: [[0]] }];
        return [{ columns: ["cnt"], values: [[t.rows.length]] }];
      }

      const tableM = sql.match(/FROM (\w+)/i);
      if (!tableM) return [];
      const t = store[tableM[1]];
      if (!t) return [];

      let rows = [...t.rows];

      // WHERE col = ?
      const whereM = sql.match(/WHERE\s+(\w+)\s*=\s*\?/i);
      if (whereM && params.length > 0) {
        const idx = t.columns.indexOf(whereM[1]);
        if (idx >= 0) rows = rows.filter((r) => r[idx] === params[0]);
      }

      // ORDER BY col DESC/ASC
      const orderM = sql.match(/ORDER BY\s+(\w+)\s+(DESC|ASC)/i);
      if (orderM) {
        const idx = t.columns.indexOf(orderM[1]);
        if (idx >= 0) {
          const desc = orderM[2].toUpperCase() === "DESC";
          rows.sort((a, b) => {
            const va = a[idx] ?? "";
            const vb = b[idx] ?? "";
            return desc ? (vb > va ? 1 : -1) : (va > vb ? 1 : -1);
          });
        }
      }

      // LIMIT n
      const limitM = sql.match(/LIMIT\s+(\d+)/i);
      if (limitM) rows = rows.slice(0, parseInt(limitM[1]));

      return [{ columns: [...t.columns], values: rows }];
    }

    prepare(sql: string) {
      const self = this;
      return {
        run(params: any[]) { self.run(sql, params); },
        free() {},
      };
    }
    close() {}
  }

  return {
    __esModule: true,
    default: jest.fn().mockResolvedValue({ Database: MockDatabase }),
  };
});

// ── Mock Prisma ──────────────────────────────────────────────────────────
jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    dailyRecommendationRun: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    dailyRecommendationStock: { findMany: jest.fn().mockResolvedValue([]) },
    corporateAction: { findMany: jest.fn().mockResolvedValue([]) },
    chartinkScreener: { findMany: jest.fn().mockResolvedValue([]) },
    workerStatus: { findMany: jest.fn().mockResolvedValue([]) },
    serverLog: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    cronJob: { findMany: jest.fn().mockResolvedValue([]) },
    workerTask: { findMany: jest.fn().mockResolvedValue([]) },
  },
  dbOpsCounter: { reads: 42, writes: 8, _day: "2026-08-25" },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockPrisma = require("@/lib/prisma").default;

// ── Imports (after mocks so they use the mocked modules) ──────────────────
import { getSqliteFallback, syncFromPrisma } from "../sqlite";

// ── Helpers ──────────────────────────────────────────────────────────────
function resetState() {
  const g2 = globalThis as any;
  g2.__sqliteBackup = {
    db: null,
    ready: false,
    syncing: false,
    prismaAvailable: true,
    lastSyncAt: null,
    lastProbeAt: null,
    syncHistory: [],
    probeTimer: null,
  };
}

describe("SQLite backup fallback", () => {
  beforeAll(() => resetState());

  describe("initialization", () => {
    it("creates and initializes SQLite", async () => {
      const { initSqliteBackup } = await import("../sqlite");
      await initSqliteBackup();
      const fb = getSqliteFallback();
      expect(fb).not.toBeNull();
      expect(fb!.isReady()).toBe(true);
    });

    it("returns null recs when empty", () => {
      const fb = getSqliteFallback();
      expect(fb!.getLatestRecommendations()).toBeNull();
    });

    it("returns empty arrays when no data", () => {
      const fb = getSqliteFallback();
      expect(fb!.getChartinkScreeners()).toEqual([]);
      expect(fb!.getCorporateActions()).toEqual([]);
      expect(fb!.getServerLogs()).toEqual([]);
      expect(fb!.getAuditLogs()).toEqual([]);
      expect(fb!.getCronJobs()).toEqual([]);
      expect(fb!.getCronRuns()).toEqual([]);
      expect(fb!.getWorkerStatuses()).toEqual([]);
      expect(fb!.getWorkerTasks()).toEqual([]);
    });
  });

  describe("syncFromPrisma with mock data", () => {
    const mockRun = {
      id: "run-abc",
      runDate: new Date("2026-08-25"),
      status: "completed",
      totalScreeners: 10,
      uniqueStocks: 5,
      aiProcessed: true,
      executionTimeMs: 12000,
      triggeredBy: "system",
      metadata: { key: "val" },
      createdAt: new Date("2026-08-25"),
    };

    const mockStock = {
      id: "stk-1",
      runId: "run-abc",
      symbol: "RELIANCE",
      price: 2500.5,
      change: 25.3,
      changePercent: 1.02,
      volume: BigInt(9876543),
      aiRecommendation: "BUY",
      confidence: 85,
      targetPrice: 2700,
      stopLoss: 2400,
      timeHorizon: "short",
      reasoning: "Strong momentum",
      riskFactors: { low: "risk" },
      screenerAttribution: ["s1"],
      screenerCount: 3,
      createdAt: new Date("2026-08-25"),
    };

    const mockCorpAction = {
      id: 1, symbol: "TCS", companyName: "Tata", series: "EQ", subject: "Dividend",
      actionType: "DIVIDEND", exDate: new Date("2026-08-20"), recordDate: new Date("2026-08-21"),
      faceValue: "5", ratio: null, dividendPerShare: 25, dividendYield: 1.2, source: "nse",
    };

    const mockScreener = {
      id: "scr-1", name: "Momentum 20", url: "https://chartink.com/m20",
      categoryId: "swing", categoryName: "Swing", scanClause: "volume > 100000",
      enabled: true, resultCount: 25, lastRunAt: new Date("2026-08-24"), nextRunAt: new Date("2026-08-27"),
    };

    const mockWorker = {
      workerId: "cron-daemon-host-123",
      workerName: "cron-daemon",
      status: "idle",
      currentTaskId: null,
      tasksCompleted: 15,
      tasksFailed: 1,
      lastHeartbeat: new Date("2026-08-25T10:00:00Z"),
      cpuUsage: 23.5,
      memoryUsage: 128_000_000,
      createdAt: new Date("2026-08-25"),
    };

    const mockLog = {
      id: "log-1",
      level: "info",
      message: "SQLite backup initialized",
      source: "system",
      taskId: null,
      metadata: { pid: 1234 },
      requestId: null,
      createdAt: new Date("2026-08-25"),
    };

    const mockAudit = {
      id: "audit-1",
      userId: 1,
      userEmail: "admin@test.com",
      action: "LOGIN",
      resource: "auth",
      resourceId: null,
      method: "POST",
      path: "/api/auth/login",
      responseStatus: 200,
      responseTime: 150,
      ipAddress: "127.0.0.1",
      metadata: null,
      errorMessage: null,
      createdAt: new Date("2026-08-25"),
    };

    const mockCronJob = {
      id: "cron-1",
      name: "Daily Recommendations (System)",
      description: "Generate daily stock recommendations",
      taskType: "recommendations",
      cronExpression: "0 4 * * 1-5",
      isActive: true,
      lastRun: new Date("2026-08-25"),
      nextRun: new Date("2026-08-26"),
      runCount: 30,
      successCount: 28,
      failureCount: 2,
      createdAt: new Date("2026-08-01"),
    };

    const mockWorkerTask = {
      id: "task-1",
      name: "recommendation_run",
      taskType: "recommendations",
      status: "completed",
      priority: 5,
      startedAt: new Date("2026-08-25T10:00:00Z"),
      completedAt: new Date("2026-08-25T10:05:00Z"),
      error: null,
      triggeredBy: "cron",
      createdAt: new Date("2026-08-25"),
    };

    beforeAll(async () => {
      mockPrisma.dailyRecommendationRun.findMany.mockResolvedValue([mockRun]);
      mockPrisma.dailyRecommendationRun.findFirst.mockResolvedValue(mockRun);
      mockPrisma.dailyRecommendationStock.findMany.mockResolvedValue([mockStock]);
      mockPrisma.corporateAction.findMany.mockResolvedValue([mockCorpAction]);
      mockPrisma.chartinkScreener.findMany.mockResolvedValue([mockScreener]);
      mockPrisma.workerStatus.findMany.mockResolvedValue([mockWorker]);
      mockPrisma.serverLog.findMany.mockResolvedValue([mockLog]);
      mockPrisma.auditLog.findMany.mockResolvedValue([mockAudit]);
      mockPrisma.cronJob.findMany.mockResolvedValue([mockCronJob]);
      mockPrisma.workerTask.findMany.mockResolvedValue([mockWorkerTask]);

      await syncFromPrisma();
    });

    it("syncs and retrieves recommendation run", () => {
      const fb = getSqliteFallback()!;
      const recs = fb.getLatestRecommendations();
      expect(recs).not.toBeNull();
      expect(recs!.success).toBe(true);
      expect(recs!.source).toBe("sqlite_backup");
      expect((recs!.run as any).id).toBe("run-abc");
      expect((recs!.run as any).status).toBe("completed");
    });

    it("syncs and retrieves recommendation stocks", () => {
      const fb = getSqliteFallback()!;
      const recs = fb.getLatestRecommendations()!;
      expect(recs.stocks).toHaveLength(1);
      expect((recs.stocks as any[])[0].symbol).toBe("RELIANCE");
      expect((recs.stocks as any[])[0].aiRecommendation).toBe("BUY");
      expect((recs.stocks as any[])[0].confidence).toBe(85);
    });

    it("syncs and retrieves corporate actions", () => {
      const fb = getSqliteFallback()!;
      const actions = fb.getCorporateActions();
      expect(actions).toHaveLength(1);
      expect(actions[0].symbol).toBe("TCS");
      expect(actions[0].action_type).toBe("DIVIDEND");
    });

    it("syncs and retrieves chartink screeners", () => {
      const fb = getSqliteFallback()!;
      const screeners = fb.getChartinkScreeners();
      expect(screeners).toHaveLength(1);
      expect(screeners[0].id).toBe("scr-1");
      expect(screeners[0].name).toBe("Momentum 20");
      expect(screeners[0].enabled).toBe(true);
    });

    it("syncs and retrieves worker statuses", () => {
      const fb = getSqliteFallback()!;
      const workers = fb.getWorkerStatuses();
      expect(workers).toHaveLength(1);
      expect(workers[0].worker_id).toBe("cron-daemon-host-123");
      expect(workers[0].worker_name).toBe("cron-daemon");
      expect(workers[0].status).toBe("idle");
    });

    it("syncs and retrieves server logs", () => {
      const fb = getSqliteFallback()!;
      const logs = fb.getServerLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe("info");
      expect(logs[0].message).toBe("SQLite backup initialized");
      expect(logs[0].source).toBe("system");
    });

    it("syncs and retrieves audit logs", () => {
      const fb = getSqliteFallback()!;
      const logs = fb.getAuditLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe("LOGIN");
      expect(logs[0].user_email).toBe("admin@test.com");
      expect(logs[0].response_status).toBe(200);
    });

    it("syncs and retrieves cron jobs", () => {
      const fb = getSqliteFallback()!;
      const jobs = fb.getCronJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].name).toBe("Daily Recommendations (System)");
      expect(jobs[0].task_type).toBe("recommendations");
      expect(jobs[0].is_active).toBe(true);
    });

    it("syncs and retrieves worker tasks", () => {
      const fb = getSqliteFallback()!;
      const tasks = fb.getWorkerTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].task_type).toBe("recommendations");
      expect(tasks[0].status).toBe("completed");
      expect(tasks[0].triggered_by).toBe("cron");
    });

    it("respects corporate actions limit", () => {
      const fb = getSqliteFallback()!;
      expect(fb.getCorporateActions(1)).toHaveLength(1);
    });

    it("returns health status with all table counts", () => {
      const fb = getSqliteFallback()!;
      const health = fb.getHealthStatus();

      expect(health.prisma).toBeDefined();
      expect(health.prisma.reads).toBe(42);
      expect(health.prisma.writes).toBe(8);
      expect(health.prisma.writeBudget).toBeGreaterThan(0);

      expect(health.sqlite.ready).toBe(true);
      expect(health.sqlite.tables).toBeDefined();
      expect(health.sqlite.tables.daily_recommendation_run).toBeGreaterThanOrEqual(1);
      expect(health.sqlite.tables.worker_status).toBeGreaterThanOrEqual(1);
      expect(health.sqlite.tables.server_log).toBeGreaterThanOrEqual(1);
      expect(health.sqlite.tables.audit_log).toBeGreaterThanOrEqual(1);
      expect(health.sqlite.tables.cron_job).toBeGreaterThanOrEqual(1);
      expect(health.sqlite.tables.worker_task).toBeGreaterThanOrEqual(1);

      expect(health.sqlite.recentSyncs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Prisma failure handling", () => {
    it("does not crash on Prisma errors", async () => {
      mockPrisma.dailyRecommendationRun.findMany.mockRejectedValue(new Error("DB down"));
      mockPrisma.dailyRecommendationRun.findFirst.mockRejectedValue(new Error("DB down"));
      mockPrisma.dailyRecommendationStock.findMany.mockRejectedValue(new Error("DB down"));
      mockPrisma.corporateAction.findMany.mockRejectedValue(new Error("DB down"));
      mockPrisma.chartinkScreener.findMany.mockRejectedValue(new Error("DB down"));
      mockPrisma.workerStatus.findMany.mockRejectedValue(new Error("DB down"));
      mockPrisma.serverLog.findMany.mockRejectedValue(new Error("DB down"));
      mockPrisma.auditLog.findMany.mockRejectedValue(new Error("DB down"));
      mockPrisma.cronJob.findMany.mockRejectedValue(new Error("DB down"));
      mockPrisma.workerTask.findMany.mockRejectedValue(new Error("DB down"));

      await expect(syncFromPrisma()).resolves.toBeUndefined();
      expect(getSqliteFallback()!.isReady()).toBe(true);
    });

    it("records partial failure as sync entry with 0 rows", () => {
      const fb = getSqliteFallback()!;
      const health = fb.getHealthStatus();
      // After full-failure sync, recentSyncs[0] should be the last sync attempt
      const lastSync = health.sqlite.recentSyncs[0];
      expect(lastSync).toBeDefined();
      expect(lastSync.rowsSynced).toBe(0);
      // 0 rows because all tables failed to sync
    });
  });

  describe("health status", () => {
    it("returns correct prisma ops from mock", () => {
      const fb = getSqliteFallback()!;
      const health = fb.getHealthStatus();
      expect(health.prisma.reads).toBe(42);
      expect(health.prisma.writes).toBe(8);
      expect(health.prisma.writeBudgetExceeded).toBe(false);
    });
  });
});
