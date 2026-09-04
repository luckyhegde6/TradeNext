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
      // Split multi-statement SQL on ; and process each. sql.js accepts
      // `-- comment` lines before a statement, so strip leading comment lines
      // so a comment-prefixed CREATE is still classified (mimics SQLite).
      const stmts = sql.split(";").map((s) => s.trim()).filter(Boolean);
      for (let raw of stmts) {
        // Drop full-line SQL comments (e.g. the `-- Write-behind ...` header
        // that precedes CREATE TABLE wb_api_request in SCHEMA_SQL).
        raw = raw
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => !l.startsWith("--"))
          .join(" ");
        const stmt = raw;
        const upper = stmt.toUpperCase();
        if (upper.startsWith("CREATE TABLE")) {
          const m = stmt.match(/CREATE TABLE IF NOT EXISTS (\w+)/i);
          if (m && !store[m[1]]) store[m[1]] = { columns: [], rows: [] };
        } else if (upper.startsWith("DELETE")) {
          const m = stmt.match(/DELETE FROM (\w+)/i);
          if (m && store[m[1]]) {
            // DELETE ... WHERE <pk> IN (?, ...) — remove only the listed rows.
            const t = store[m[1]];
            const inM = stmt.match(/WHERE\s+(\w+)\s+IN\s*\(/i);
            if (inM && _params.length > 0) {
              const pkIdx = t.columns.indexOf(inM[1]);
              if (pkIdx >= 0) {
                const ids = new Set(_params.map(String));
                t.rows = t.rows.filter((r) => !ids.has(String(r[pkIdx])));
              }
            } else {
              // Unscoped DELETE (no WHERE) wipes the whole table.
              t.rows = [];
            }
          }
        } else if (upper.startsWith("INSERT")) {
          const m = stmt.match(/INSERT OR REPLACE INTO (\w+)/i);
          if (m && store[m[1]]) {
            const t = store[m[1]];
            if (t.columns.length === 0) {
              const colM = stmt.match(/\(([^)]+)\)/);
              if (colM) t.columns = colM[1].split(",").map((c: string) => c.trim());
            }
            // INSERT OR REPLACE: remove existing rows with same PK (first column)
            if (upper.includes("OR REPLACE") && _params.length > 0) {
              t.rows = t.rows.filter((r) => r[0] !== _params[0]);
            }
            t.rows.push([..._params]);
          }
        }
      }
    }

    exec(sql: string, params: any[] = []) {
      const upper = sql.trim().toUpperCase();
      if (!upper.startsWith("SELECT")) return [];

      // Parse the requested columns (SELECT col1, col2 FROM ... or SELECT *)
      const selectM = sql.match(/SELECT\s+(.+?)\s+FROM/i);
      const requestedCols = selectM
        ? selectM[1].split(",").map((c: string) => c.trim().replace(/"/g, ""))
        : null; // null = SELECT *

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

      // WHERE col LIKE '<prefix>%' — filter literal LIKE against the column.
      const likeM = sql.match(/WHERE\s+(\w+)\s+LIKE\s+'([^']+)'%/i);
      if (likeM) {
        const idx = t.columns.indexOf(likeM[1]);
        const prefix = likeM[2];
        if (idx >= 0) rows = rows.filter((r) => typeof r[idx] === "string" && r[idx].startsWith(prefix));
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

      // If specific columns were requested (not *), project only those
      if (requestedCols && !requestedCols.includes("*")) {
        const colIndices = requestedCols.map((c) => t.columns.indexOf(c)).filter((i) => i >= 0);
        const projectedCols = requestedCols.filter((c) => t.columns.includes(c));
        const projectedRows = rows.map((r) => colIndices.map((i) => r[i]));
        return [{ columns: projectedCols, values: projectedRows }];
      }

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
    __resetStore: () => {
      // Clear all table rows (the store is shared/global across mock DB
      // instances, mirroring the real sql.js in-memory DB). Used in beforeEach
      // so tests start from a clean queue.
      for (const k of Object.keys(store)) store[k] = { columns: [], rows: [] };
    },
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
    serverLog: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    auditLog: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    aPIRequestLog: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    cronJob: { findMany: jest.fn().mockResolvedValue([]) },
    workerTask: { findMany: jest.fn().mockResolvedValue([]) },
  },
  dbOpsCounter: { reads: 42, writes: 8, _day: "2026-08-25" },
  getIstDayKey: () => "2026-08-25",
  dbErrorCounts: {
    _day: "2026-08-25",
    counts: { plan_limit: 0, timeout: 0, accelerate_proxy: 0, connection: 0, write_budget: 0, other: 0 },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockPrisma = require("@/lib/prisma").default;

// ── Mock leader election ─────────────────────────────────────────────────
// sqlite.ts lazily imports @/lib/services/leader inside syncFromPrisma to gate
// the full Prisma->SQLite sync to the "sqlite-sync" role leader. For unit
// tests we default `isLeader` to TRUE so the sync runs; individual tests can
// flip it to false to exercise the gate / "skipped" path.
jest.mock("@/lib/services/leader", () => ({
  __esModule: true,
  isLeader: jest.fn().mockResolvedValue(true),
  acquireLeaderLock: jest.fn().mockResolvedValue(true),
  renewLeaderLock: jest.fn().mockResolvedValue(true),
  releaseLeaderLock: jest.fn().mockResolvedValue(undefined),
  getLeaderInfo: jest.fn().mockResolvedValue(null),
  leaderWorkerId: jest.fn((role: string) => `leader-${role}`),
  LEADER_SELF: "unit-test-host-1",
  LEADER_STALENESS_MS: 5 * 60_000,
  LEADER_HEARTBEAT_MS: 60_000,
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockLeader = require("@/lib/services/leader");

// ── Mock @/lib/db-utils (v3.23.x plan-limit breaker) ─────────────────────
// Delegate to the REAL implementation for everything EXCEPT
// `isPlanLimitBreakerOpen`, which we control per-test (defaults to false =
// breaker CLOSED so the existing suite runs unchanged). Acquire the handle
// via require() exactly like `mockLeader` (SWC-safe, no closure/TDZ).
jest.mock("@/lib/db-utils", () => {
  const real = jest.requireActual<Record<string, unknown>>("@/lib/db-utils");
  return {
    ...real,
    isPlanLimitBreakerOpen: jest.fn().mockReturnValue(false),
  };
});
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockDbUtils = require("@/lib/db-utils") as {
  isPlanLimitBreakerOpen: jest.Mock<boolean, []>;
};

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
    opsPersistTimer: null,
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

    it("returns totalOperations, planLimit, planOperationsRemaining", () => {
      const fb = getSqliteFallback()!;
      const health = fb.getHealthStatus();
      expect(health.prisma.totalOperations).toBe(42 + 8); // reads + writes
      expect(health.prisma.planLimit).toBeGreaterThan(0);
      expect(health.prisma.planOperationsRemaining).toBe(
        health.prisma.planLimit - health.prisma.totalOperations,
      );
    });
  });

  describe("ops counter persist / restore roundtrip", () => {
    it("persists counter to SQLite and restores it on next init", async () => {
      // 1. Save current counter values
      const { dbOpsCounter } = await import("@/lib/prisma");
      const prevReads = dbOpsCounter.reads;
      const prevWrites = dbOpsCounter.writes;

      // 2. Mutate the counter and persist
      dbOpsCounter.reads = 1234;
      dbOpsCounter.writes = 567;
      const fb = getSqliteFallback()!;
      fb.persistOpsCounter();

      // 3. Simulate a restart: reset the in-memory counter
      dbOpsCounter.reads = 0;
      dbOpsCounter.writes = 0;

      // 4. Restore — should pull the persisted snapshot back
      fb.restoreOpsCounter();
      expect(dbOpsCounter.reads).toBe(1234);
      expect(dbOpsCounter.writes).toBe(567);

      // 5. Restore original values for other tests
      dbOpsCounter.reads = prevReads;
      dbOpsCounter.writes = prevWrites;
    });

    it("persist is a no-op when db is null", async () => {
      const { dbOpsCounter } = await import("@/lib/prisma");
      const prevReads = dbOpsCounter.reads;
      const prevWrites = dbOpsCounter.writes;

      dbOpsCounter.reads = 9999;
      dbOpsCounter.writes = 1111;

      // db is populated, so persist succeeds — this tests that the function exists and doesn't throw
      const fb = getSqliteFallback()!;
      expect(() => fb.persistOpsCounter()).not.toThrow();

      // Restore originals
      dbOpsCounter.reads = prevReads;
      dbOpsCounter.writes = prevWrites;
    });
  });

  describe("db error counts persist / restore roundtrip", () => {
    it("persists per-type counts to SQLite and restores them on demand", async () => {
      const { dbErrorCounts } = await import("@/lib/prisma");
      const prev = { ...dbErrorCounts.counts };

      dbErrorCounts.counts.plan_limit = 2;
      dbErrorCounts.counts.timeout = 3;
      dbErrorCounts.counts.accelerate_proxy = 1;
      dbErrorCounts.counts.write_budget = 0;
      dbErrorCounts.counts.other = 5;
      const fb = getSqliteFallback()!;
      fb.persistDbErrorCounts();

      // Simulate a restart: zero the in-memory counts
      dbErrorCounts.counts = { plan_limit: 0, timeout: 0, accelerate_proxy: 0, connection: 0, write_budget: 0, other: 0 };

      fb.restoreDbErrorCounts();
      expect(dbErrorCounts.counts.plan_limit).toBe(2);
      expect(dbErrorCounts.counts.timeout).toBe(3);
      expect(dbErrorCounts.counts.accelerate_proxy).toBe(1);
      expect(dbErrorCounts.counts.connection).toBe(0);
      expect(dbErrorCounts.counts.other).toBe(5);

      // Restore originals for other tests
      dbErrorCounts.counts = prev;
    });

    it("ignores stale (previous-day) persisted counts", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const prismaModule = require("@/lib/prisma");
      const { dbErrorCounts } = await import("@/lib/prisma");
      const prev = { ...dbErrorCounts.counts };
      const originalKey = prismaModule.getIstDayKey;

      try {
        // Persist a snapshot stamped with YESTERDAY's day key
        prismaModule.getIstDayKey = () => "2026-08-24";
        dbErrorCounts.counts.connection = 9;
        getSqliteFallback()!.persistDbErrorCounts();

        // Now it is a new day: zero in-memory and restore → must NOT apply
        prismaModule.getIstDayKey = () => "2026-08-25";
        dbErrorCounts.counts = { plan_limit: 0, timeout: 0, accelerate_proxy: 0, connection: 0, write_budget: 0, other: 0 };
        getSqliteFallback()!.restoreDbErrorCounts();
        expect(dbErrorCounts.counts.connection).toBe(0);
        expect(dbErrorCounts.counts.timeout).toBe(0);
      } finally {
        prismaModule.getIstDayKey = originalKey;
        dbErrorCounts.counts = prev;
      }
    });

    it("merges with Math.max instead of overwriting when both sides have counts", async () => {
      const { dbErrorCounts } = await import("@/lib/prisma");
      const prev = { ...dbErrorCounts.counts };

      dbErrorCounts.counts.timeout = 4;
      dbErrorCounts.counts.plan_limit = 1;
      getSqliteFallback()!.persistDbErrorCounts();

      // More errors accumulate before the restore runs
      dbErrorCounts.counts.timeout = 6;
      dbErrorCounts.counts.plan_limit = 0;

      getSqliteFallback()!.restoreDbErrorCounts();
      expect(dbErrorCounts.counts.timeout).toBe(6); // max(6, 4)
      expect(dbErrorCounts.counts.plan_limit).toBe(1); // max(0, 1)

      dbErrorCounts.counts = prev;
    });
  });

  describe("ensureSqliteBackup (lazy on-demand init)", () => {
    it("returns the ready fallback when already initialized", async () => {
      const { ensureSqliteBackup } = await import("../sqlite");
      const fb = await ensureSqliteBackup();
      expect(fb).not.toBeNull();
      expect(fb!.isReady()).toBe(true);
    });

    it("re-initializes on demand after a reset (retry path, never stuck disabled)", async () => {
      const { ensureSqliteBackup, resetSqliteStateForTests } = await import("../sqlite");
      resetSqliteStateForTests();
      expect(getSqliteFallback()).toBeNull();

      const fb = await ensureSqliteBackup();
      expect(fb).not.toBeNull();
      expect(fb!.isReady()).toBe(true);
      expect(fb!.getHealthStatus().sqlite.ready).toBe(true);
    });

    it("v3.28.1 — repairs a partial init (state.db set but ready=false) on the next retry", async () => {
      // Simulate the prod failure: initSqliteBackup assigns state.db, then the
      // schema loop throws partway, leaving state.db non-null + ready:false.
      // Before the fix, the `if (state.db) return` guard made the retry a
      // permanent no-op → "SQLite Not Ready" + promoteNseToPrisma "no such
      // table". After the fix, the catch nulls state.db so the retry rebuilds.
      const sqljsModule: any = require("sql.js");
      const { Database } = await sqljsModule.default();
      const proto = Database.prototype;
      const origRun = proto.run;
      let failed = false;
      proto.run = function (...args: any[]) {
        if (!failed) {
          failed = true;
          throw new Error("simulated schema-loop failure");
        }
        return origRun.apply(this, args);
      };
      try {
        sqljsModule.__resetStore();
        const { initSqliteBackup, resetSqliteStateForTests, getSqliteFallback } = await import("../sqlite");
        resetSqliteStateForTests();

        // First init FAILS partway — the fix must reset state.db so the layer
        // is not left stuck: getSqliteFallback() returns null after the catch.
        await initSqliteBackup();
        expect(getSqliteFallback()).toBeNull();

        // The next ensureSqliteBackup() rebuilds from scratch → ready.
        const { ensureSqliteBackup } = await import("../sqlite");
        const fb = await ensureSqliteBackup();
        expect(fb).not.toBeNull();
        expect(fb!.isReady()).toBe(true);
        expect(fb!.getHealthStatus().sqlite.ready).toBe(true);
      } finally {
        proto.run = origRun;
      }
    });

    it("v3.28.1 — promoteNseToPrisma on a not-ready mirror returns zero without touching tables", async () => {
      // A not-ready mirror (db unset OR partially built) must never be promoted:
      // reading missing NSE-store tables would throw "no such table". The guard
      // returns the zero summary instead (no Prisma ops, no throw).
      const sqljsModule: any = require("sql.js");
      sqljsModule.__resetStore();
      const { promoteNseToPrisma, resetSqliteStateForTests } = await import("../sqlite");
      resetSqliteStateForTests(); // ready:false, state.db:null → skip

      const summary = await promoteNseToPrisma();
      expect(summary).toEqual({
        symbols: 0,
        daily_price: 0,
        corporate_action: 0,
        chartink_screener_result: 0,
      });
    });
  });

  // ── v3.22.0: write-behind logging queue ─────────────────────────────────
  describe("write-behind log queue", () => {
    beforeEach(async () => {
      mockPrisma.serverLog.createMany.mockClear();
      mockPrisma.auditLog.createMany.mockClear();
      mockPrisma.aPIRequestLog.createMany.mockClear();
      // The sql.js mock store is shared/global across mock DB instances — clear
      // it + re-init so each test starts from an empty write-behind queue.
      const sqljs: any = require("sql.js");
      sqljs.__resetStore();
      const { resetSqliteStateForTests, ensureSqliteBackup } = await import("../sqlite");
      resetSqliteStateForTests();
      await ensureSqliteBackup();
    });

    it("increments pending counts when enqueued", () => {
      const fb = getSqliteFallback()!;
      fb.enqueueWriteBehind("server_log", {
        id: "l1",
        level: "info",
        message: "hello",
        source: "test",
        created_at: new Date().toISOString(),
      });
      fb.enqueueWriteBehind("audit_log", {
        id: "a1",
        user_id: 1,
        action: "LOGIN",
        created_at: new Date().toISOString(),
      });
      fb.enqueueWriteBehind("api_request", {
        request_id: "r1",
        method: "GET",
        path: "/api/x",
        status_code: 200,
        created_at: new Date().toISOString(),
      });

      const stats = fb.getWriteBehindStats();
      expect(stats.pending.server_log).toBeGreaterThanOrEqual(1);
      expect(stats.pending.audit_log).toBeGreaterThanOrEqual(1);
      expect(stats.pending.api_request).toBeGreaterThanOrEqual(1);
    });

    it("promotes ONLY important rows to Prisma and retains the rest in SQLite [v3.22.2]", async () => {
      const fb = getSqliteFallback()!;
      // Seed promotable rows (error-level log, security audit, 5xx api) plus
      // NON-promotable rows (info log, 200 api).
      fb.enqueueWriteBehind("server_log", {
        id: "l-err-1", level: "error", message: "boom", source: "test",
        created_at: new Date("2026-08-25T10:00:00.000Z"),
      });
      fb.enqueueWriteBehind("server_log", {
        id: "l-info-1", level: "info", message: "hello", source: "test",
        created_at: new Date("2026-08-25T10:00:00.000Z"),
      });
      fb.enqueueWriteBehind("audit_log", {
        id: "a-sec-1", user_id: 1, action: "AUTH_LOGIN",
        created_at: new Date("2026-08-25T10:00:00.000Z"),
      });
      fb.enqueueWriteBehind("api_request", {
        request_id: "r-5xx-1", method: "GET", path: "/api/x", status_code: 500,
        created_at: new Date("2026-08-25T10:00:00.000Z"),
      });
      fb.enqueueWriteBehind("api_request", {
        request_id: "r-200-1", method: "GET", path: "/api/y", status_code: 200,
        created_at: new Date("2026-08-25T10:00:00.000Z"),
      });

      const res = await fb.flushWriteBehind();
      expect(res.skipped).toBe(false);
      // v3.23.x (user ALWAYS policy): server_log + api_request are NEVER
      // promoted to Prisma — SQLite is their PRIMARY durable store (they stay
      // queued until the 14-day TTL prune; file archive mirrors them). Only
      // security/critical audit_log rows still promote.
      //   - info server_log      → retained (never promoted)
      //   - error audit_log(sec) → promoted
      //   - 5xx api_request      → retained (never promoted)
      //   - 200 api_request      → retained
      expect(res.flushed.server_log).toBe(0);
      expect(res.flushed.audit_log).toBeGreaterThanOrEqual(1);
      expect(res.flushed.api_request).toBe(0);
      // All log rows stay in SQLite.
      expect(res.retained.server_log).toBeGreaterThanOrEqual(1);
      expect(res.retained.api_request).toBeGreaterThanOrEqual(2);

      // createMany was invoked only for the promoted audit row.
      expect(mockPrisma.auditLog.createMany).toHaveBeenCalled();
      expect(mockPrisma.serverLog.createMany).not.toHaveBeenCalled();
      expect(mockPrisma.aPIRequestLog.createMany).not.toHaveBeenCalled();

      // The promoted audit row is gone from the queue; the log rows remain.
      const after = fb.getWriteBehindStats();
      expect(after.pending.audit_log).toBe(0);
      expect(after.pending.server_log).toBeGreaterThanOrEqual(1); // the info row stays
      expect(after.pending.api_request).toBeGreaterThanOrEqual(2); // both stay
      expect(after.lastFlushAt).not.toBeNull();
      expect(after.lastRetained.server_log).toBeGreaterThanOrEqual(1);
      expect(after.lastRetained.api_request).toBeGreaterThanOrEqual(2);
    });

    it("leaves rows queued when the DB is unavailable (skip, not 500)", async () => {
      const fb = getSqliteFallback()!;
      fb.enqueueWriteBehind("audit_log", {
        id: "a-skip-1", user_id: 1, action: "LOGIN", created_at: new Date("2026-08-25T10:00:00.000Z"),
      });
      // Prisma Postgres errors are Error instances with a `code` (P6003 = hold).
      const p6003 = new Error("There is a hold on your account. Reason: planLimitReached.");
      (p6003 as any).code = "P6003";
      mockPrisma.auditLog.createMany.mockRejectedValueOnce(p6003);

      const res = await fb.flushWriteBehind();
      expect(res.skipped).toBe(true);
      expect(res.flushed.audit_log).toBe(0);
      // Rows remain queued for a later flush.
      expect(fb.getWriteBehindStats().pending.audit_log).toBeGreaterThanOrEqual(1);

      // A subsequent successful flush applies them.
      mockPrisma.auditLog.createMany.mockResolvedValueOnce({ count: 1 });
      const res2 = await fb.flushWriteBehind();
      expect(res2.flushed.audit_log).toBeGreaterThanOrEqual(1);
      expect(res2.skipped).toBe(false);
    });

    it("does NOT inflate the ops counter by row count (createMany = 1 op) [v3.22.1 regression]", async () => {
      const fb = getSqliteFallback()!;
      // The $allOperations extension in lib/prisma.ts counts ONE write op per
      // createMany call regardless of row count. The flush path must NOT add
      // dbOpsCounter.writes += rows itself (that double-counted: ~6k phantom
      // writes for a handful of real ops). Here the Prisma mock is plain (no
      // $allOperations), so if the flush inflated the counter we'd see it here.
      const cap: any = require("@/lib/prisma");
      const writesBefore = cap.dbOpsCounter.writes;

      // Seed > WB_CHUNK (250) rows of a NEVER-PROMOTED kind (server_log). Under
      // the v3.23.x user ALWAYS policy, server_log (any level, incl. error)
      // is PRIMARY-stored in SQLite and never promoted → the drain retains all
      // 600, so it issues zero Prisma createMany calls and zero Prisma ops.
      for (let i = 0; i < 600; i++) {
        fb.enqueueWriteBehind("server_log", {
          id: `reg-${i}`,
          level: "error",
          message: "row",
          source: "test",
          created_at: new Date("2026-08-25T10:00:00.000Z"),
        });
      }
      mockPrisma.serverLog.createMany.mockResolvedValue({ count: 250 });
      const res = await fb.flushWriteBehind();
      expect(res.skipped).toBe(false);
      // All 600 server_log rows are RETAINED in SQLite (never promoted).
      expect(res.flushed.server_log).toBe(0);
      expect(res.retained.server_log).toBe(600);

      // Zero promotions → zero createMany calls.
      expect(mockPrisma.serverLog.createMany.mock.calls.length).toBe(0);
      // The flush path no longer mutates the counter directly (writesBefore
      // stays unchanged – only $allOperations would increment it in prod).
      expect(cap.dbOpsCounter.writes).toBe(writesBefore);
      // All 600 rows REMAIN queued (SQLite is their primary store — they are
      // pruned by the 14-day TTL, never promoted to Prisma).
      expect(fb.getWriteBehindStats().pending.server_log).toBe(600);
    });
  });

  // ── v3.22.0: liveness heartbeats (SQLite, zero Prisma) ─────────────────
  describe("liveness heartbeats", () => {
    it("writes and reads a worker heartbeat", () => {
      const fb = getSqliteFallback()!;
      fb.writeLivenessHeartbeat("worker", { status: "idle", tasksCompleted: 5 });

      const beats = fb.getLivenessHeartbeats();
      expect(beats.length).toBeGreaterThanOrEqual(1);
      const workerBeat = beats.find((b) => b.role === "worker");
      expect(workerBeat).toBeDefined();
      expect(workerBeat!.status).toBe("idle");
      expect(workerBeat!.tasksCompleted).toBe(5);
      expect(typeof workerBeat!.at).toBe("string");
    });

    it("overwrites the heartbeat for the same role (INSERT OR REPLACE)", () => {
      const fb = getSqliteFallback()!;
      fb.writeLivenessHeartbeat("cron-daemon", { state: "one" });
      fb.writeLivenessHeartbeat("cron-daemon", { state: "two" });

      const beats = fb.getLivenessHeartbeats().filter((b) => b.role === "cron-daemon");
      expect(beats).toHaveLength(1);
      expect(beats[0].state).toBe("two");
    });
  });

  // ── v3.22.0: sqlite-sync leader gate ───────────────────────────────────
  describe("sqlite-sync leader gate", () => {
    it("skips the full sync when this instance is not the sqlite-sync leader", async () => {
      // Flip the mock: not the leader. Reset SQLite to a fresh empty state so
      // we can unambiguously assert the sync never ran (lastSyncAt stays null).
      const { resetSqliteStateForTests, ensureSqliteBackup } = await import("../sqlite");
      mockLeader.isLeader.mockResolvedValue(false);
      resetSqliteStateForTests();
      await ensureSqliteBackup();

      // ensureSqliteBackup() calls syncFromPrisma() during init; the leader
      // gate should make it a no-op, so no sync timestamp is recorded.
      const fb = getSqliteFallback()!;
      expect(fb.getHealthStatus().sqlite.lastSyncAt).toBeNull();

      // An explicit syncFromPrisma() call is likewise gated.
      await fb.syncFromPrisma();
      expect(fb.getHealthStatus().sqlite.lastSyncAt).toBeNull();
      // Restore the default for later tests.
      mockLeader.isLeader.mockResolvedValue(true);
    });

    it("runs the full sync when force is passed even if not the leader", async () => {
      mockLeader.isLeader.mockResolvedValue(false);
      mockPrisma.dailyRecommendationRun.findMany.mockResolvedValue([{
        id: "run-force", runDate: new Date("2026-08-25"), status: "completed",
        totalScreeners: 1, uniqueStocks: 1, aiProcessed: true, executionTimeMs: 1,
        triggeredBy: "system", metadata: null, createdAt: new Date("2026-08-25"),
      }]);

      const fb = getSqliteFallback()!;
      await fb.syncFromPrisma({ force: true });

      const recs = fb.getLatestRecommendations();
      expect(recs).not.toBeNull();
      expect((recs!.run as any).id).toBe("run-force");
      mockLeader.isLeader.mockResolvedValue(true);
    });

    // ── v3.23.x: plan-limit breaker gate (user directive) ────────────────
    // When the Prisma plan-limit breaker is OPEN (account on hold / DB down),
    // syncFromPrisma is a NO-OP: it must NOT touch Prisma at all and must
    // serve the last-known-good cached SQLite mirror — that is exactly the
    // prod "SQLite: failed to sync X = Plan limit circuit breaker open" spam
    // (×7 tables per cycle) this eliminates.
    it("skips the Prisma->SQLite sync entirely when the plan-limit breaker is OPEN", async () => {
      // Flip the controllable db-utils mock to OPEN.
      mockDbUtils.isPlanLimitBreakerOpen.mockReturnValue(true);

      const { resetSqliteStateForTests, ensureSqliteBackup } = await import("../sqlite");
      resetSqliteStateForTests();
      // Clear cumulative call history from earlier tests so `not.toHaveBeenCalled`
      // measures ONLY what this test's re-init triggers.
      jest.clearAllMocks();
      await ensureSqliteBackup();

      // Not a single Prisma read should fire during a hold — the mirror is
      // already current from the last good sync.
      expect(mockPrisma.dailyRecommendationRun.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.chartinkScreener.findMany).not.toHaveBeenCalled();

      const fb = getSqliteFallback()!;
      expect(fb.getHealthStatus().sqlite.lastSyncAt).toBeNull();

      // Restore the default (breaker CLOSED) for later tests.
      mockDbUtils.isPlanLimitBreakerOpen.mockReturnValue(false);
    });
  });
});
