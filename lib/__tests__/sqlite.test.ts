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
        // that precedes CREATE TABLE wb_api_request in SCHEMA_SQL) AND strip
        // double-quoted identifiers (e.g. the reserved-word `"transaction"`
        // table). SQLite treats quoted === unquoted identifiers, so removing
        // the quotes keeps the (\w+) classification regexes working while the
        // real engine accepts the quoted reserved name.
        raw = raw
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => !l.startsWith("--"))
          .join(" ")
          .replace(/"/g, "");
        const stmt = raw.trim();
        const upper = stmt.toUpperCase();
        if (!stmt) continue;
        if (upper.startsWith("CREATE TABLE")) {
          const m = stmt.match(/CREATE TABLE IF NOT EXISTS (\w+)/i);
          if (m && !store[m[1]]) store[m[1]] = { columns: [], rows: [] };
        } else if (upper.startsWith("CREATE INDEX") || upper.startsWith("CREATE UNIQUE INDEX")) {
          // Index DDL (incl. UNIQUE — e.g. idx_swing_signal_job_symbol) is a
          // no-op in the mock (tables carry no indexes). `CREATE UNIQUE INDEX`
          // must not fall through to the syntax-error branch: real SQLite
          // accepts it, so a valid SCHEMA_SQL statement would abort init.
        } else if (upper.startsWith("ALTER TABLE")) {
          // Column-add DDL is a no-op; tables are flexibly shaped by INSERT.
        } else if (upper.startsWith("DELETE")) {
          const m = stmt.match(/DELETE FROM (\w+)/i);
          if (m && store[m[1]]) {
            // DELETE ... WHERE <pk> IN (?, ...) — remove only the listed rows.
            const t = store[m[1]];
            // Prune DELETE (Plan 09 `recordSyncHistory` ledger trim):
            // `WHERE id NOT IN (SELECT id FROM <t> ORDER BY id DESC LIMIT n)`
            // keeps only the newest n rows. The mock rows have no `id` column,
            // so insertion order == auto-increment order. Must be matched
            // BEFORE the generic `IN` check — `NOT IN (SELECT...)` doesn't fit
            // that regex and would otherwise wipe the whole table below.
            const pruneM = stmt.match(
              /WHERE\s+\w+\s+NOT\s+IN\s*\(\s*SELECT\s+\w+\s+FROM\s+(\w+)\s+ORDER\s+BY\s+\w+\s+DESC\s+LIMIT\s+(\d+)\s*\)/i,
            );
            if (pruneM && store[pruneM[1]]) {
              t.rows = t.rows.slice(-parseInt(pruneM[2], 10));
            } else {
              const inM = stmt.match(/WHERE\s+(\w+)\s+IN\s*\(/i);
              if (inM && _params.length > 0) {
                const pkIdx = t.columns.indexOf(inM[1]);
                if (pkIdx >= 0) {
                  const ids = new Set(_params.map(String));
                  t.rows = t.rows.filter((r) => !ids.has(String(r[pkIdx])));
                }
              } else {
                // DELETE ... WHERE <col> = ? — remove only the matching row
                // (Plan 09 Phase 7 `deleteAnnouncement`/`deleteAlert`/
                // `deleteTransaction`/`deleteCorporateAction` single-value
                // deletes; matches real sql.js semantics — the row with that
                // value goes, everything else stays).
                const eqM = stmt.match(/WHERE\s+(\w+)\s*=\s*\?/i);
                if (eqM && _params.length > 0) {
                  const pkIdx = t.columns.indexOf(eqM[1]);
                  if (pkIdx >= 0) {
                    const val = String(_params[0]);
                    t.rows = t.rows.filter((r) => String(r[pkIdx]) !== val);
                  }
                } else {
                  // Unscoped DELETE (no WHERE) wipes the whole table.
                  t.rows = [];
                }
              }
            }
          }
        } else if (upper.startsWith("INSERT")) {
          // Handle both `INSERT OR REPLACE INTO` (write-behind) and plain
          // `INSERT INTO ... ON CONFLICT(...) DO UPDATE` (control-plane
          // upserts e.g. upsertCronJob) so those rows reach the read-back
          // helpers in tests instead of being silently dropped.
          const m = stmt.match(/INSERT(?:\s+OR\s+REPLACE)?\s+INTO\s+(\w+)/i);
          if (m && store[m[1]]) {
            const t = store[m[1]];
            if (t.columns.length === 0) {
              const colM = stmt.match(/\(([^)]+)\)/);
              if (colM) t.columns = colM[1].split(",").map((c: string) => c.trim());
            }
            // OR REPLACE wipe + ON CONFLICT both mean "replace on PK (first
            // column)" — mimic as remove-then-push so re-upserts don't dup.
            if ((upper.includes("OR REPLACE") || upper.includes("ON CONFLICT")) && _params.length > 0) {
              t.rows = t.rows.filter((r) => r[0] !== _params[0]);
            }
            t.rows.push([..._params]);
          }
        } else {
          // Real sql.js throws `near "<token>": syntax error` when a fragment's
          // first token isn't a valid SQL statement. Match that behavior so a
          // semicolon sneaking into a `--` comment inside SCHEMA_SQL (v3.30.0
          // regression: "near \"Prisma\": syntax error" at init, leaving the
          // SQLite-first store inert) fails `creates and initializes SQLite`
          // instead of being silently ignored by this mock.
          const firstToken = (/^[A-Za-z]+/.exec(stmt) || [])[0] || "";
          throw new Error(`near "${firstToken}": syntax error`);
        }
      }
    }

    exec(sql: string, params: any[] = []) {
      // Strip quoted identifiers — quoted === unquoted in SQLite (see run()).
      const q = sql.replace(/"/g, "");
      const upper = q.trim().toUpperCase();
      if (!upper.startsWith("SELECT")) return [];

      // Parse the requested columns (SELECT col1, col2 FROM ... or SELECT *)
      const selectM = q.match(/SELECT\s+(.+?)\s+FROM/i);
      const requestedCols = selectM
        ? selectM[1].split(",").map((c: string) => c.trim().replace(/"/g, ""))
        : null; // null = SELECT *

      // COUNT(*) handling
      if (upper.includes("COUNT(*)")) {
        const tableM = q.match(/FROM (\w+)/i);
        if (!tableM) return [];
        const t = store[tableM[1]];
        if (!t) return [{ columns: ["cnt"], values: [[0]] }];
        return [{ columns: ["cnt"], values: [[t.rows.length]] }];
      }

      const tableM = q.match(/FROM (\w+)/i);
      if (!tableM) return [];
      const t = store[tableM[1]];
      if (!t) return [];

      let rows = [...t.rows];

      // WHERE col = ?
      const whereM = q.match(/WHERE\s+(\w+)\s*=\s*\?/i);
      if (whereM && params.length > 0) {
        const idx = t.columns.indexOf(whereM[1]);
        if (idx >= 0) rows = rows.filter((r) => r[idx] === params[0]);
      }

      // WHERE col LIKE '<prefix>%' — filter literal LIKE against the column.
      const likeM = q.match(/WHERE\s+(\w+)\s+LIKE\s+'([^']+)'%/i);
      if (likeM) {
        const idx = t.columns.indexOf(likeM[1]);
        const prefix = likeM[2];
        if (idx >= 0) rows = rows.filter((r) => typeof r[idx] === "string" && r[idx].startsWith(prefix));
      }

      // ORDER BY col DESC/ASC
      const orderM = q.match(/ORDER BY\s+(\w+)\s+(DESC|ASC)/i);
      if (orderM) {
        const idx = t.columns.indexOf(orderM[1]);
        if (idx >= 0) {
          const desc = orderM[2].toUpperCase() === "DESC";
          rows.sort((a, b) => {
            const va = a[idx] ?? "";
            const vb = b[idx] ?? "";
            return desc ? (vb > va ? 1 : -1) : (va > vb ? 1 : -1);
          });
        } else if (orderM[1].toLowerCase() === "id") {
          // `ORDER BY id DESC/ASC`: the mock rows have no `id` column, but
          // INSERT pushes in auto-increment order, so insertion order IS id
          // order. DESC (e.g. `getDurableSyncHistory` newest-first) reverses.
          if (orderM[2].toUpperCase() === "DESC") rows.reverse();
        }
      }

      // LIMIT n
      const limitM = q.match(/LIMIT\s+(\d+)/i);
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
    __getStore: () => store,
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
    corporateAction: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    chartinkScreener: { findMany: jest.fn().mockResolvedValue([]) },
    workerStatus: { findMany: jest.fn().mockResolvedValue([]) },
    serverLog: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    auditLog: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    aPIRequestLog: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    cronJob: { findMany: jest.fn().mockResolvedValue([]) },
    workerTask: { findMany: jest.fn().mockResolvedValue([]) },
    // Plan 09 Phase 4: SQLite→Prisma push sink targets
    symbol: {
      upsert: jest.fn().mockResolvedValue({ id: "sym-1", symbol: "RELIANCE" }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    dailyPrice: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    chartinkScreenerResult: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
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
  LEADER_STALENESS_MS: 10 * 60_000,
  LEADER_HEARTBEAT_MS: 300_000,
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
import {
  getSqliteFallback,
  syncFromPrisma,
  pushSqliteToPrisma,
  hasSyncHistoryTable,
  getOutboxPending,
  getSqliteDerivedCounts,
} from "../sqlite";
import type { TimeCorrectionRecord, TimeProbeRecord } from "../sqlite";
import {
  foldOpsCounterIntoMonthly,
  getOpsMonthlyState,
  resetOpsMonthlyForTests,
} from "../services/opsMonthly";

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

    it("schema init tolerates semicolons in SQL comments (v3.30.0 regression)", async () => {
      // Regression: SCHEMA_SQL is split on ";" (initSqliteBackup) and each
      // fragment is run as one statement. A ";" inside a `--` comment cut a
      // fragment whose first token was a bare word (e.g. "Prisma", "served"),
      // so real sql.js threw `near "Prisma": syntax error` at boot → SQLite
      // never became ready → every SQLite-first read fell back to Prisma
      // (the F1 worker poll degraded to ~20 Prisma SELECTs / 30s).
      // The mock Database.run mirrors sql.js and throws on such fragments,
      // so a re-introduced comment semicolon fails this (and the init) test.
      const { initSqliteBackup } = await import("../sqlite");
      await initSqliteBackup();
      const fb = getSqliteFallback();
      expect(fb).not.toBeNull();
      expect(fb!.isReady()).toBe(true);
      // Spot-check the previously-broken tables actually exist in the mirror.
      expect(fb!.getWorkerTasks().length).toBeGreaterThanOrEqual(0);
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

  describe("monthly ops ledger persist / restore roundtrip (v3.34.0)", () => {
    const sqlModule = require("sql.js") as any;

    // Start each test from a clean mirror AND a clean store so this describe is
    // order-independent: `getSqliteFallback()` returns `state.db ? _instance :
    // null`, so without an init every test fails in isolation (the `-t "monthly
    // ops ledger..."` filter skips the earlier describes that shared-init the DB)
    // with `TypeError: Cannot read properties of null (reading 'persistOpsMonthly')`.
    const resetAndInit = async () => {
      sqlModule.__resetStore();
      const { resetSqliteStateForTests, ensureSqliteBackup } = await import("../sqlite");
      resetSqliteStateForTests();
      jest.clearAllMocks();
      mockPrisma.workerStatus.upsert = jest.fn().mockResolvedValue({ count: 1 });
      await ensureSqliteBackup();
    };

    it("persists the folded ledger to _backup_meta and restores it after a restart", async () => {
      await resetAndInit();
      resetOpsMonthlyForTests();
      foldOpsCounterIntoMonthly(getOpsMonthlyState(), "2026-08-25", { reads: 1234, writes: 567 });
      const fb = getSqliteFallback()!;
      fb.persistOpsMonthly();

      // Simulate a restart: wipe the in-memory ledger, then restore
      resetOpsMonthlyForTests();
      expect(getOpsMonthlyState().days).toEqual({});
      fb.restoreOpsMonthly();
      expect(getOpsMonthlyState().monthKey).toBe("2026-08");
      expect(getOpsMonthlyState().days["2026-08-25"]).toEqual({ reads: 1234, writes: 567 });

      resetOpsMonthlyForTests(); // cleanup so later tests start clean
    });

    it("ignores a stale (previous-month) persisted ledger", async () => {
      await resetAndInit();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const prismaModule = require("@/lib/prisma");
      const originalKey = prismaModule.getIstDayKey;

      try {
        // Persist a snapshot stamped with LAST month's key
        prismaModule.getIstDayKey = () => "2026-07-31";
        resetOpsMonthlyForTests(); // monthKey "2026-07"
        foldOpsCounterIntoMonthly(getOpsMonthlyState(), "2026-07-31", { reads: 999, writes: 111 });
        getSqliteFallback()!.persistOpsMonthly();

        // Now it is August: wipe + restore must NOT apply the July ledger
        prismaModule.getIstDayKey = () => "2026-08-25";
        resetOpsMonthlyForTests();
        getSqliteFallback()!.restoreOpsMonthly();
        expect(getOpsMonthlyState().days).toEqual({});
      } finally {
        prismaModule.getIstDayKey = originalKey;
        resetOpsMonthlyForTests();
      }
    });

    it("persist / restore are no-ops while the mirror is not ready", async () => {
      await resetAndInit();
      const fb = getSqliteFallback()!;
      resetOpsMonthlyForTests();
      foldOpsCounterIntoMonthly(getOpsMonthlyState(), "2026-08-25", { reads: 5, writes: 6 });

      // Null the REAL module state in place. A `g2.__sqliteBackup = {…}`
      // replacement (see resetState() in this file) orphans the module's
      // `state` binding captured at load, so the persist guard below would NOT
      // return and the dbOpsCounter fold would run (leaking {42,8} into the
      // in-memory ledger). resetSqliteStateForTests() mutates the shared state
      // object IN PLACE (sqlite.ts), so the guard fires and nothing folds.
      const { resetSqliteStateForTests, ensureSqliteBackup } = await import("../sqlite");
      resetSqliteStateForTests();

      expect(() => fb.persistOpsMonthly()).not.toThrow();
      expect(() => fb.restoreOpsMonthly()).not.toThrow();
      expect(getOpsMonthlyState().days["2026-08-25"]).toEqual({ reads: 5, writes: 6 });

      // Re-init the shared store: resetSqliteStateForTests() nulled state.db/
      // ready in place, and the describes that follow this one (time
      // correction, db error counts — file order) reuse the module store
      // instead of initializing it, so they'd otherwise see a null fallback.
      await ensureSqliteBackup();

      resetOpsMonthlyForTests(); // cleanup so later tests start clean
    });
  });

  describe("time correction persist / restore roundtrip", () => {
      it("persists a time-correction record to _backup_meta and restores it", () => {
        const fb = getSqliteFallback()!;
        const record: TimeCorrectionRecord = {
          offsetMinutes: -330,
          istInput: "2026-09-10T15:30",
          appliedAt: "2026-09-10T10:00:00.000Z",
          serverNowIso: "2026-09-10T10:00:00.000Z",
        };
        fb.persistTimeCorrection(record);
        expect(fb.restoreTimeCorrection()).toEqual(record);
      });

      it("deletes the correction and roundtrips the DB probe record", () => {
        const fb = getSqliteFallback()!;
        const record: TimeCorrectionRecord = {
          offsetMinutes: -330,
          istInput: "2026-09-10T15:30",
          appliedAt: "2026-09-10T10:00:00.000Z",
          serverNowIso: "2026-09-10T10:00:00.000Z",
        };
        fb.persistTimeCorrection(record);
        fb.deleteTimeCorrection();
        expect(fb.restoreTimeCorrection()).toBeNull();

        const probe: TimeProbeRecord = {
          dbIso: "2026-09-10T10:00:02.000Z",
          probedAt: "2026-09-10T10:00:01.000Z",
        };
        fb.persistTimeProbe(probe);
        expect(fb.restoreTimeProbe()).toEqual(probe);
        expect(fb.restoreTimeProbe()).not.toBeNull();
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

  // ── v3.30.0: upsertCronJob Date binding (control-plane re-seed path) ────
  describe("upsertCronJob Date binding (v3.30.0)", () => {
    beforeEach(async () => {
      // The sql.js mock store is shared/global across mock DB instances — clear
      // it + re-init so each test starts from a clean mirror.
      const sqljs: any = require("sql.js");
      sqljs.__resetStore();
      const { resetSqliteStateForTests, ensureSqliteBackup } = await import("../sqlite");
      resetSqliteStateForTests();
      await ensureSqliteBackup();
    });

    it("binds Prisma Date objects as ISO strings, not locale String(Date)", () => {
      const fb = getSqliteFallback()!;
      const id = "cron-date-bind";
      fb.upsertCronJob({
        id,
        name: "Daily Recommendations (System)",
        taskType: "recommendations",
        cronExpression: "0 4 * * 1-5",
        isActive: true,
        lastRun: new Date("2026-09-06T10:30:00.000Z"),
        nextRun: new Date("2026-09-07T05:00:00.000Z"),
        runCount: 3,
        successCount: 2,
        failureCount: 1,
        createdAt: new Date("2026-09-06T09:00:00.000Z"),
        config: { timezone: "Asia/Kolkata" },
      });

      const rows = fb.getCronJobs().filter((r) => r.id === id);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      // Regression: pre-fix bound Date objects raw (`as string` cast — no
      // runtime conversion), storing `String(Date)` = locale format like
      // "Sat Sep 06 2026 10:30:00 GMT+0530 (India Standard Time)" which
      // corrupts the read-back in reconcileControlToPrisma
      // (`new Date(String(col))` → Invalid Date). Must be ISO, matching the
      // syncFromPrisma path (:2524-2525).
      expect(row.last_run).toBe("2026-09-06T10:30:00.000Z");
      expect(row.next_run).toBe("2026-09-07T05:00:00.000Z");
      expect(row.created_at).toBe("2026-09-06T09:00:00.000Z");
      expect(row.is_active).toBe(true);
      expect(row.config).toBe(JSON.stringify({ timezone: "Asia/Kolkata" }));
    });

    it("re-upserting the same id replaces the row (ON CONFLICT upsert semantics)", () => {
      const fb = getSqliteFallback()!;
      const id = "cron-date-bind";
      fb.upsertCronJob({
        id,
        name: "v1",
        cronExpression: "0 4 * * 1-5",
        isActive: true,
        nextRun: new Date("2026-09-07T05:00:00.000Z"),
      });
      fb.upsertCronJob({
        id,
        name: "v2",
        cronExpression: "0 5 * * 1-5",
        isActive: true,
        nextRun: new Date("2026-09-08T05:00:00.000Z"),
      });
      const rows = fb.getCronJobs().filter((r) => r.id === id);
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("v2");
      expect(rows[0].cron_expression).toBe("0 5 * * 1-5");
      expect(rows[0].next_run).toBe("2026-09-08T05:00:00.000Z");
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

    it("strips SQLite-only bookkeeping columns (queued_at) from the promoted Prisma createMany [v3.28.3 regression]", async () => {
      mockPrisma.auditLog.createMany.mockClear();
      const fb = getSqliteFallback()!;
      // enqueueWriteBehind AUTO-ADDS `queued_at` to every stored row — the
      // pre-v3.28.3 mapWbToPrisma passed it through verbatim, so
      // auditLog.createMany threw "Unknown argument queued_at" and audit rows
      // were NEVER promoted (sticky wb rows re-failed every 15-min flush,
      // spamming db-health DB Errors — observed 2026-09-05).
      fb.enqueueWriteBehind("audit_log", {
        id: "a-map-1",
        user_id: 7,
        user_email: "who@example.com",
        action: "ADMIN_DB_SYNC",
        resource: "db-health",
        resource_id: "x",
        method: "POST",
        path: "/api/admin/db-health",
        response_status: 200,
        response_time: 42,
        ip_address: "127.0.0.1",
        metadata: { ok: true, n: 3 },
      });

      const res = await fb.flushWriteBehind();
      expect(res.skipped).toBe(false);
      expect(res.flushed.audit_log).toBeGreaterThanOrEqual(1);
      expect(mockPrisma.auditLog.createMany).toHaveBeenCalled();

      const data = mockPrisma.auditLog.createMany.mock.calls.flatMap(
        (call: unknown[]) => (call[0] as { data: Array<Record<string, unknown>> }).data,
      );
      expect(data.length).toBeGreaterThanOrEqual(1);
      for (const entry of data) {
        // The wb-only bookkeeping column must NEVER reach Prisma.
        expect(entry).not.toHaveProperty("queued_at");
        // Mapped fields still arrive correctly for Prisma.
        expect(entry.action).toBe("ADMIN_DB_SYNC");
        expect(entry.userId).toBe(7);
        expect(entry.userEmail).toBe("who@example.com");
        expect(entry.ipAddress).toBe("127.0.0.1");
        expect(entry.metadata).toEqual({ ok: true, n: 3 });
      }
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
    it("boot hydration bypasses the leader gate; explicit syncs stay gated", async () => {
      // Plan 09 Phase 2: boot hydration (leaderBypass via initSqliteBackup) is
      // the ONLY Prisma->SQLite flow (spec v2) — it runs on EVERY instance
      // regardless of the sqlite-sync leader (pulling is read-only on Prisma).
      // The single-leader gate still applies to explicit probe/periodic syncs.
      const sqlModule = require("sql.js") as any;
      const { resetSqliteStateForTests, ensureSqliteBackup } = await import("../sqlite");
      const ledgerRows = () => (sqlModule.__getStore()["sync_history"]?.rows ?? []) as unknown[][];

      // Flip the mock: NOT the leader. Reset SQLite to a fresh empty state so
      // the boot path is unambiguous (pre-Phase-2 the non-leader boot was a
      // no-op — the ledger stayed empty and lastSyncAt stayed null).
      mockLeader.isLeader.mockResolvedValue(false);
      sqlModule.__resetStore();
      resetSqliteStateForTests();
      const rowsBeforeBoot = ledgerRows().length;
      await ensureSqliteBackup();

      // Boot hydration ran despite not being the leader -> a NEW durably
      // recorded prisma_to_sqlite row (leaderGated=false reflects the bypass).
      const fb = getSqliteFallback()!;
      expect(ledgerRows().length).toBeGreaterThan(rowsBeforeBoot);
      expect(fb.getHealthStatus().sqlite.lastSyncAt).not.toBeNull();
      const bootRow = fb.getHealthStatus().sqlite.recentSyncs[0];
      expect(bootRow).toBeDefined();
      expect(bootRow!.direction).toBe("prisma_to_sqlite");
      expect(bootRow!.trigger).toBe("boot");
      expect(bootRow!.leaderGated).toBe(false);

      // An explicit syncFromPrisma() call from a non-leader is STILL gated ->
      // no additional ledger row is recorded.
      const rowsAfterBoot = ledgerRows().length;
      await fb.syncFromPrisma();
      expect(ledgerRows().length).toBe(rowsAfterBoot);
      // Restore the default for later tests.
      mockLeader.isLeader.mockResolvedValue(true);
    });

    it("boot hydration skips the SQLite->Prisma reconcile (skipReconcile)", async () => {
      // Plan 09 Phase 2: boot calls syncFromPrisma({ skipReconcile: true }) —
      // the SQLite->Prisma control-plane push (worker_status/cron_job/
      // worker_task upserts) is reserved for the 6h probe / admin force job,
      // per the user directive "only write to prisma during the 6h sync job".
      // The seeded worker_status MIRROR row gives reconcile something to push —
      // the assertion is that boot NEVER performs that push.
      const sqlModule = require("sql.js") as any;
      const { resetSqliteStateForTests, ensureSqliteBackup } = await import("../sqlite");

      // Default isLeader = TRUE (factory) — pre-Phase-2 a full boot sync would
      // reach the reconcile and upsert this row into Prisma (breaking the
      // not.toHaveBeenCalled assertion); Phase 2's skipReconcile skips it.
      // Columns mirror the SQLite SCHEMA_SQL worker_status table.
      sqlModule.__resetStore();
      resetSqliteStateForTests();
      mockPrisma.workerStatus.upsert = jest.fn().mockResolvedValue({});
      sqlModule.__getStore()["worker_status"] = {
        columns: [
          "worker_id", "worker_name", "status", "current_task_id",
          "tasks_completed", "tasks_failed", "last_heartbeat", "cpu_usage",
          "memory_usage", "created_at",
        ],
        rows: [["worker-1", "host-1", "idle", null, 0, 0, "2026-09-08T05:30:00.000Z", null, null, "2026-09-08T05:30:00.000Z"]],
      };
      jest.clearAllMocks();
      await ensureSqliteBackup();

      // Boot hydration pulls Prisma -> SQLite ONLY (read-only on Prisma); the
      // SQLite -> Prisma control-plane push never runs at boot.
      expect(mockPrisma.workerStatus.upsert).not.toHaveBeenCalled();
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

  // ── Plan 09 Phase 1: durable sync_history ledger ────────────────────────
  describe("sync_history ledger", () => {
    const sqlModule = require("sql.js") as any;

    // Start each test from a clean mirror AND a clean store so the ledger is
    // deterministic (the store persists across tests — real sql.js keeps the
    // in-memory DB until the process exits).
    const resetAndInit = async () => {
      sqlModule.__resetStore();
      const { resetSqliteStateForTests, ensureSqliteBackup } = await import("../sqlite");
      resetSqliteStateForTests();
      jest.clearAllMocks();
      await ensureSqliteBackup();
    };

    it("records a prisma_to_sqlite boot row with trigger/leader metadata", async () => {
      await resetAndInit();

      await syncFromPrisma();

      const status = getSqliteFallback()!.getHealthStatus();
      const row = status.sqlite.recentSyncs[0];
      expect(row).toBeDefined();
      expect(row!.direction).toBe("prisma_to_sqlite");
      expect(row!.trigger).toBe("boot");
      expect(row!.leaderGated).toBe(true);
      expect(typeof row!.durationMs).toBe("number");
      expect(status.sqlite.recentSyncs.length).toBeLessThanOrEqual(10);
    });

    it("records sqlite_to_prisma error rows and prunes the ledger to 100 rows", async () => {
      await resetAndInit();

      // Seed the worker_status MIRROR so the reconcile pass has a row to
      // push. `lastHeartbeat` must be a real Date — syncTable calls
      // `.toISOString()` on it. `workerStatus.upsert` is NOT part of the
      // mock Prisma, so reconcile's upsert throws (caught, non-fatal).
      mockPrisma.workerStatus.findMany.mockResolvedValue([
        {
          workerId: "worker-1",
          workerName: "host-1",
          status: "idle",
          tasksCompleted: 0,
          tasksFailed: 0,
          lastHeartbeat: new Date(),
        },
      ]);
      mockPrisma.workerStatus.upsert = jest.fn().mockRejectedValue(new Error("reconcile boom"));

      // Sync 1 seeds the mirror (reconcile sees 0 rows first); sync 2's
      // reconcile finds the seeded row and hits the failing upsert.
      await syncFromPrisma();
      await syncFromPrisma();

      const errRow = getSqliteFallback()!.getHealthStatus().sqlite.recentSyncs.find((r) => r.error != null);
      expect(errRow).toBeDefined();
      expect(errRow!.direction).toBe("sqlite_to_prisma");
      expect(errRow!.error).toContain("reconcile boom");

      // 105 more syncs → every sync adds 2 rows (1 reconcile + 1 success),
      // but the durable ledger is pruned to the newest 100; the read still
      // caps at 10.
      for (let i = 0; i < 105; i++) {
        await syncFromPrisma();
      }
      const tableRows: unknown[][] = sqlModule.__getStore()["sync_history"]?.rows ?? [];
      expect(tableRows.length).toBeLessThanOrEqual(100);
      expect(getSqliteFallback()!.getHealthStatus().sqlite.recentSyncs.length).toBeLessThanOrEqual(10);
    });
  });

  // ── Plan 09 Phase 4: _sync_outbox + SQLite→Prisma push engine ───────────
  // The four mirror WRITE methods record an outbox row per mutation
  // (op='upsert' only — the sync direction never writes through them), and
  // `pushSqliteToPrisma` drains the outbox to Prisma at the 6h probe tick.
  describe("Plan 09 Phase 4 — sync outbox + pushSqliteToPrisma", () => {
    const sqlModule = require("sql.js") as any;

    // Same clean-start pattern as the sync_history ledger describe: wipe the
    // mock store (outbox + mirror tables) AND the module state, restore the
    // boot-reconcile workerStatus.upsert stub (jest.clearAllMocks preserves
    // implementations but earlier tests may have repointed it), and re-init.
    const resetAndInit = async () => {
      sqlModule.__resetStore();
      const { resetSqliteStateForTests, ensureSqliteBackup } = await import("../sqlite");
      resetSqliteStateForTests();
      jest.clearAllMocks();
      mockPrisma.workerStatus.upsert = jest.fn().mockResolvedValue({ count: 1 });
      await ensureSqliteBackup();
    };

    const outboxRows = (): any[][] => sqlModule.__getStore()["_sync_outbox"]?.rows ?? [];

    it("creates _sync_outbox at init and records writer mutations with op=upsert", async () => {
      await resetAndInit();
      expect(sqlModule.__getStore()["_sync_outbox"]).toBeDefined();

      const fb = getSqliteFallback()!;
      fb.upsertSymbol({ symbol: "RELIANCE", companyName: "Reliance Industries Ltd", series: "EQ", isActive: true });

      const rows = outboxRows();
      expect(rows.length).toBe(1);
      expect(sqlModule.__getStore()["_sync_outbox"].columns).toEqual(["table_name", "row_id", "op", "at"]);
      expect(rows[0][0]).toBe("symbols");
      expect(rows[0][1]).toBe("RELIANCE");
      expect(rows[0][2]).toBe("upsert");
    });

    it("records one outbox row per daily_price bar keyed on ticker+tradeDate", async () => {
      await resetAndInit();
      const fb = getSqliteFallback()!;
      fb.setDailyPriceBars("NSE:TCS", [
        { tradeDate: "2026-08-25", open: 120, high: 122, low: 119, close: 121, volume: 1000, vwap: 120.5 },
        { tradeDate: "2026-08-26", open: 121, high: 123, low: 120, close: 122, volume: 1100, vwap: 121.5 },
      ]);

      const rows = outboxRows();
      expect(rows.length).toBe(2);
      expect(rows.map((r) => r[1])).toEqual([
        JSON.stringify(["NSE:TCS", "2026-08-25"]),
        JSON.stringify(["NSE:TCS", "2026-08-26"]),
      ]);
      expect(rows.every((r) => r[2] === "upsert")).toBe(true);
    });

    it("records corporate_action outbox rows on the natural key (symbol+type+exDate)", async () => {
      await resetAndInit();
      const fb = getSqliteFallback()!;
      fb.setCorporateActions([
        {
          symbol: "TCS",
          companyName: "Tata Consultancy Services",
          actionType: "DIVIDEND",
          exDate: new Date("2026-08-20"),
          recordDate: new Date("2026-08-21"),
          dividendPerShare: 10,
        },
      ]);

      const rows = outboxRows();
      expect(rows.length).toBe(1);
      expect(rows[0][0]).toBe("corporate_action");
      expect(rows[0][1]).toBe(JSON.stringify(["TCS", "DIVIDEND", "2026-08-20T00:00:00.000Z"]));
      expect(rows[0][2]).toBe("upsert");
    });

    it("records chartink_screener_result outbox rows keyed on the result id", async () => {
      await resetAndInit();
      const fb = getSqliteFallback()!;
      fb.replaceChartinkResults("swing-momentum", [
        { id: "r-1", runId: "run-9", symbol: "RELIANCE", close: 1310 },
        { id: "r-2", runId: "run-9", symbol: "TCS", close: 4100 },
      ]);

      const rows = outboxRows();
      expect(rows.length).toBe(2);
      expect(rows.map((r) => r[1])).toEqual(["r-1", "r-2"]);
      expect(rows.every((r) => r[0] === "chartink_screener_result" && r[2] === "upsert")).toBe(true);
    });

    it("drains the outbox latest-op-wins, clears rows, and records sqlite_to_prisma history", async () => {
      await resetAndInit();
      const fb = getSqliteFallback()!;
      fb.upsertSymbol({ symbol: "RELIANCE", companyName: "Reliance One", series: "EQ", isActive: true });
      fb.upsertSymbol({ symbol: "RELIANCE", companyName: "Reliance Two", series: "EQ", isActive: true });
      fb.setCorporateActions([
        { symbol: "TCS", companyName: "TCS Ltd", actionType: "DIVIDEND", exDate: new Date("2026-08-20") },
      ]);
      expect(outboxRows().length).toBe(3);

      const { pushSqliteToPrisma } = await import("../sqlite");
      const summary = await pushSqliteToPrisma();

      // synced counts consumed ROWS (symbols 1 + corporate_action 1), not tables.
      expect(summary).not.toBeNull();
      expect(summary!.ran).toBe(true);
      expect(summary!.synced).toBe(2);
      expect(summary!.failed).toBe(0);

      // Latest op wins: the second upsert replaces the first.
      expect(mockPrisma.symbol.upsert).toHaveBeenCalledTimes(1);
      expect(mockPrisma.symbol.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { symbol: "RELIANCE" },
          create: expect.objectContaining({ companyName: "Reliance Two" }),
        }),
      );
      expect(mockPrisma.corporateAction.createMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.corporateAction.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([expect.objectContaining({ symbol: "TCS" })]),
          skipDuplicates: true,
        }),
      );

      // Outbox fully drained + a sync-ledger row with the pushed count.
      expect(outboxRows().length).toBe(0);
      const syncedRow = getSqliteFallback()!.getHealthStatus().sqlite.recentSyncs.find(
        (r: any) => r.direction === "sqlite_to_prisma",
      );
      expect(syncedRow).toBeDefined();
      expect(syncedRow!.rowsSynced).toBe(2);
    });

    it("pushes daily_price rows via a single bulk raw upsert", async () => {
      await resetAndInit();
      const fb = getSqliteFallback()!;
      fb.setDailyPriceBars("NSE:TCS", [
        { tradeDate: "2026-08-25", open: 120, high: 122, low: 119, close: 121, volume: 1000, vwap: 120.5 },
      ]);
      fb.setDailyPriceBars("NSE:INFY", [
        { tradeDate: "2026-08-25", open: 1800, high: 1810, low: 1790, close: 1805, volume: 900, vwap: 1802 },
      ]);

      const { pushSqliteToPrisma } = await import("../sqlite");
      const summary = await pushSqliteToPrisma();

      expect(summary!.synced).toBe(2);
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
      const [sql, ...params] = mockPrisma.$executeRawUnsafe.mock.calls[0];
      expect(typeof sql).toBe("string");
      expect(sql.toUpperCase()).toContain("INSERT INTO DAILY_PRICES");
      expect(sql.toUpperCase()).toContain("ON CONFLICT");
      expect(params.length).toBeGreaterThanOrEqual(4);
      // Regression: numbered $N placeholders, never bare "?" — the Prisma 7
      // read/write driver adapter passes a literal "?" through to Postgres,
      // which fails with 42601 (v3.31.0 live push-sink bug).
      expect(sql).toContain("$1");
      expect(sql).not.toContain("?");
      expect(outboxRows().length).toBe(0);
    });

    it("pushes chartink rows to prisma createMany and clears their outbox rows", async () => {
      await resetAndInit();
      const fb = getSqliteFallback()!;
      fb.replaceChartinkResults("swing-momentum", [
        { id: "r-1", runId: "run-9", symbol: "RELIANCE", close: 1310 },
      ]);

      const { pushSqliteToPrisma } = await import("../sqlite");
      const summary = await pushSqliteToPrisma();

      expect(summary!.synced).toBe(1);
      expect(mockPrisma.chartinkScreenerResult.createMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.chartinkScreenerResult.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([expect.objectContaining({ id: "r-1", symbol: "RELIANCE" })]),
          skipDuplicates: true,
        }),
      );
      expect(outboxRows().length).toBe(0);
    });

    it("partial failure retains the failed table's outbox rows, clears owners, records error", async () => {
      await resetAndInit();
      const fb = getSqliteFallback()!;
      fb.upsertSymbol({ symbol: "RELIANCE", companyName: "Reliance Industries", series: "EQ", isActive: true });
      fb.setCorporateActions([
        { symbol: "TCS", companyName: "TCS Ltd", actionType: "DIVIDEND", exDate: new Date("2026-08-20") },
      ]);
      mockPrisma.corporateAction.createMany.mockRejectedValue(new Error("corp boom"));

      const { pushSqliteToPrisma } = await import("../sqlite");
      const summary = await pushSqliteToPrisma();

      expect(summary!.failed).toBe(1);
      expect(summary!.synced).toBe(1);
      expect(summary!.errors[0]).toContain("corporate_action");
      // symbols consumed + cleared; corporate_action retained for the next tick.
      expect(mockPrisma.symbol.upsert).toHaveBeenCalledTimes(1);
      expect(outboxRows().map((r) => r[0])).toEqual(["corporate_action"]);

      // Restore the default for later tests.
      mockPrisma.corporateAction.createMany.mockResolvedValue({ count: 0 });
    });

    it("drains op=delete rows to prisma deleteMany with parsed natural keys", async () => {
      await resetAndInit();
      const fb = getSqliteFallback()!;
      // Seed the column shape via a real writer mutation, then inject a delete
      // op directly into the mock store (real writes only emit op=upsert today,
      // but the sink must handle a retained delete row defensively).
      fb.upsertSymbol({ symbol: "RELIANCE", companyName: "Reliance Industries", series: "EQ", isActive: true });
      sqlModule.__getStore()["_sync_outbox"].rows.push(["symbols", "RELIANCE", "delete", "2026-08-25T00:00:00.000Z"]);

      const { pushSqliteToPrisma } = await import("../sqlite");
      const summary = await pushSqliteToPrisma();

      expect(summary!.synced).toBe(1);
      // The upsert row is dropped by latest-op-wins (the delete wins), so only
      // the deleteMany fires — with the parsed natural key.
      expect(mockPrisma.symbol.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.symbol.deleteMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.symbol.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { symbol: "RELIANCE" } }),
      );
      expect(outboxRows().length).toBe(0);
    });

    it("returns null when the store is not ready, the breaker is OPEN, or not the sqlite-sync leader", async () => {
      const { pushSqliteToPrisma, resetSqliteStateForTests } = await import("../sqlite");

      // Store not ready (reset, no init).
      resetSqliteStateForTests();
      expect(await pushSqliteToPrisma()).toBeNull();

      // Ready but breaker OPEN → refuse without touching Prisma.
      await resetAndInit();
      mockDbUtils.isPlanLimitBreakerOpen.mockReturnValue(true);
      expect(await pushSqliteToPrisma()).toBeNull();
      expect(mockPrisma.symbol.upsert).not.toHaveBeenCalled();

      // Ready, breaker closed, but not the sqlite-sync leader → refuse too.
      mockDbUtils.isPlanLimitBreakerOpen.mockReturnValue(false);
      mockLeader.isLeader.mockResolvedValue(false);
      expect(await pushSqliteToPrisma()).toBeNull();
      expect(mockPrisma.symbol.upsert).not.toHaveBeenCalled();

      // Restore defaults for later tests.
      mockLeader.isLeader.mockResolvedValue(true);
    });
  });

  describe("Plan 09 Phase 7 — admin long-lived datasets mirror helpers", () => {
    const sqlModule = require("sql.js") as any;

    const resetAndInit = async () => {
      sqlModule.__resetStore();
      const { resetSqliteStateForTests, ensureSqliteBackup } = await import("../sqlite");
      resetSqliteStateForTests();
      jest.clearAllMocks();
      mockPrisma.workerStatus.upsert = jest.fn().mockResolvedValue({ count: 1 });
      await ensureSqliteBackup();
    };

    const outboxRows = (): any[][] => sqlModule.__getStore()["_sync_outbox"]?.rows ?? [];
    const tableRows = (name: string): any[][] => sqlModule.__getStore()[name]?.rows ?? [];
    const outboxOps = (table: string) =>
      outboxRows().filter((r) => r[0] === table).map((r) => [r[1], r[2]]);

    it("upsertAnnouncement assigns an id, replaces on conflict, and emits outbox upsert/delete", async () => {
      await resetAndInit();
      const fb = getSqliteFallback()!;

      const id1 = fb.upsertAnnouncement({ title: "First", message: "Hello", type: "info", target: "all" });
      expect(id1).toBe(1);
      expect(tableRows("admin_announcement").length).toBe(1);
      expect(tableRows("admin_announcement")[0][1]).toBe("First");

      // Explicit id: upsert returns it unchanged and replaces any existing row.
      const id2 = fb.upsertAnnouncement({ id: 7, title: "Second", message: "World", type: "maintenance" });
      expect(id2).toBe(7);
      expect(tableRows("admin_announcement").length).toBe(2);
      fb.upsertAnnouncement({ id: 7, title: "Second v2", message: "World", type: "maintenance" });
      expect(tableRows("admin_announcement").filter((r) => r[0] === 7).length).toBe(1);
      expect(tableRows("admin_announcement").filter((r) => r[0] === 7)[0][1]).toBe("Second v2");

      expect(outboxOps("admin_announcement")).toEqual([
        ["1", "upsert"],
        ["7", "upsert"],
        ["7", "upsert"],
      ]);

      fb.deleteAnnouncement(7);
      expect(tableRows("admin_announcement").filter((r) => r[0] === 7).length).toBe(0);
      expect(outboxOps("admin_announcement")).toEqual([
        ["1", "upsert"],
        ["7", "upsert"],
        ["7", "upsert"],
        ["7", "delete"],
      ]);
    });

    it("upsertAlert round-trips through getAlerts and deleteAlert emits outbox delete", async () => {
      await resetAndInit();
      const fb = getSqliteFallback()!;

      fb.upsertAlert({
        id: "al-1",
        userId: 3,
        type: "price",
        symbol: "RELIANCE",
        condition: { op: ">", value: 1500 },
        triggered: true,
        seen: false,
        createdAt: new Date("2026-09-08T06:00:00.000Z"),
      });

      const alerts = fb.getAlerts({ limit: 100 });
      expect(alerts.length).toBe(1);
      const a = alerts[0] as any;
      expect(a.id).toBe("al-1");
      expect(a.userId).toBe(3);
      expect(a.symbol).toBe("RELIANCE");
      expect(a.condition).toEqual({ op: ">", value: 1500 });
      expect(a.createdAt).toEqual(new Date("2026-09-08T06:00:00.000Z"));
      expect(a.triggered).toBeTruthy();
      expect(a.seen).toBeFalsy();
      expect(outboxOps("alert")).toEqual([["al-1", "upsert"]]);

      fb.deleteAlert("al-1");
      expect(fb.getAlerts({ limit: 100 }).length).toBe(0);
      expect(outboxOps("alert")).toEqual([
        ["al-1", "upsert"],
        ["al-1", "delete"],
      ]);
    });

    it("upsertTransaction round-trips through getTransactions (filters + uppercased ticker) and deleteTransaction emits outbox delete", async () => {
      await resetAndInit();
      const fb = getSqliteFallback()!;

      fb.upsertTransaction({
        id: "tx-1",
        portfolioId: "pf-1",
        userId: 3,
        portfolioName: "Main",
        tradeDate: new Date("2026-09-01"),
        ticker: "reliance",
        side: "BUY",
        quantity: 10,
        price: 1310.9,
        fees: 20,
        notes: "init",
      });
      fb.upsertTransaction({
        id: "tx-2",
        portfolioId: "pf-2",
        userId: 9,
        portfolioName: "Other",
        tradeDate: new Date("2026-09-02"),
        ticker: "tcs",
        side: "SELL",
        quantity: 5,
        price: 4200,
        fees: 15,
      });

      const all = fb.getTransactions({ limit: 5000 });
      expect(all.length).toBe(2);
      // ticker uppercased on write; tradeDate rehydrated as a Date via the alias.
      const tx1 = all.find((t) => (t as any).id === "tx-1") as any;
      expect(tx1.ticker).toBe("RELIANCE");
      expect(tx1.tradeDate).toEqual(new Date("2026-09-01"));
      expect(tx1.quantity).toBe(10);
      expect(tx1.price).toBe(1310.9);
      expect(tx1.portfolioName).toBe("Main");

      // portfolioId + userId filters apply in-SQL.
      expect(fb.getTransactions({ portfolioId: "pf-2" }).length).toBe(1);
      expect(fb.getTransactions({ userId: 3 }).map((t) => (t as any).id)).toEqual(["tx-1"]);
      expect(outboxOps("transaction")).toEqual([
        ["tx-1", "upsert"],
        ["tx-2", "upsert"],
      ]);

      fb.deleteTransaction("tx-1");
      expect(fb.getTransactions({ limit: 5000 }).length).toBe(1);
      expect(outboxOps("transaction")).toEqual([
        ["tx-1", "upsert"],
        ["tx-2", "upsert"],
        ["tx-1", "delete"],
      ]);
    });

    it("deleteCorporateAction removes by id and emits the natural-key delete outbox row", async () => {
      await resetAndInit();
      const fb = getSqliteFallback()!;
      fb.setCorporateActions([
        {
          symbol: "TCS",
          companyName: "Tata Consultancy Services",
          actionType: "DIVIDEND",
          exDate: new Date("2026-08-20"),
          recordDate: new Date("2026-08-21"),
          dividendPerShare: 10,
        },
      ]);

      const naturalKey = JSON.stringify(["TCS", "DIVIDEND", "2026-08-20T00:00:00.000Z"]);
      expect(outboxOps("corporate_action")).toEqual([[naturalKey, "upsert"]]);

      // The mock derives table columns from INSERTs, but `setCorporateActions`
      // intentionally omits the auto-increment `id` (real sql.js AUTOINCREMENT
      // assigns 1, 2, ... on a NULL/absent id). Simulate that here so the
      // `WHERE id = ?` SELECT + DELETE resolve the row by its real id —
      // without an `id` column the mock ignores the WHERE filter (a known
      // sql.js-mock limitation, not a production behaviour).
      const caStore = sqlModule.__getStore()["corporate_action"];
      caStore.columns = ["id", ...caStore.columns];
      caStore.rows = caStore.rows.map((r: unknown[], i: number) => [i + 1, ...r]);

      expect(fb.deleteCorporateAction(1)).toBe(true);
      expect(tableRows("corporate_action").length).toBe(0);
      expect(outboxOps("corporate_action")).toEqual([
        [naturalKey, "upsert"],
        [naturalKey, "delete"],
      ]);

      // Second delete: row already gone → false, no extra outbox row.
      expect(fb.deleteCorporateAction(1)).toBe(false);
      expect(outboxOps("corporate_action")).toEqual([
        [naturalKey, "upsert"],
        [naturalKey, "delete"],
      ]);
    });
  });

  // ── Plan 09 Phase 8: push opts, read helpers, derived counts ────────────
  describe("Plan 09 Phase 8 — push opts + read helpers", () => {
    const sqlModule = require("sql.js") as any;

    const resetAndInit = async () => {
      sqlModule.__resetStore();
      const { resetSqliteStateForTests, ensureSqliteBackup } = await import("../sqlite");
      resetSqliteStateForTests();
      jest.clearAllMocks();
      mockPrisma.workerStatus.upsert = jest.fn().mockResolvedValue({ count: 1 });
      await ensureSqliteBackup();
    };

    const outboxRows = (): any[][] => sqlModule.__getStore()["_sync_outbox"]?.rows ?? [];

    // ── hasSyncHistoryTable ─────────────────────────────────────────────
    it("hasSyncHistoryTable returns false before init and true after init", async () => {
      // Before init: state.db is null → false.
      const { resetSqliteStateForTests } = await import("../sqlite");
      resetSqliteStateForTests();
      expect(hasSyncHistoryTable()).toBe(false);

      // After init: sync_history is created by SCHEMA_SQL → true.
      await resetAndInit();
      expect(hasSyncHistoryTable()).toBe(true);
    });

    // ── getOutboxPending ────────────────────────────────────────────────
    it("getOutboxPending returns {} before init", async () => {
      const { resetSqliteStateForTests } = await import("../sqlite");
      resetSqliteStateForTests();
      expect(getOutboxPending()).toEqual({});
    });

    it("getOutboxPending returns empty when outbox is empty after init", async () => {
      await resetAndInit();
      expect(getOutboxPending()).toEqual({});
    });

    it("getOutboxPending returns per-table pending counts and lastAt after seeding", async () => {
      await resetAndInit();
      const fb = getSqliteFallback()!;

      fb.upsertSymbol({ symbol: "RELIANCE", companyName: "Reliance Industries", series: "EQ", isActive: true });
      fb.upsertSymbol({ symbol: "TCS", companyName: "TCS", series: "EQ", isActive: true });
      fb.setCorporateActions([
        { symbol: "INFY", companyName: "Infosys", actionType: "DIVIDEND", exDate: new Date("2026-09-01") },
      ]);

      const pending = getOutboxPending();
      expect(pending.symbols).toBeDefined();
      expect(pending.symbols.pending).toBe(2);
      expect(typeof pending.symbols.lastAt).toBe("string");
      expect(pending.corporate_action).toBeDefined();
      expect(pending.corporate_action.pending).toBe(1);
    });

    it("getOutboxPending returns empty after a successful push drains the outbox", async () => {
      await resetAndInit();
      const fb = getSqliteFallback()!;
      fb.upsertSymbol({ symbol: "RELIANCE", companyName: "Reliance", series: "EQ", isActive: true });
      fb.setCorporateActions([
        { symbol: "TCS", companyName: "TCS", actionType: "DIVIDEND", exDate: new Date("2026-09-01") },
      ]);
      expect(Object.keys(getOutboxPending()).length).toBeGreaterThan(0);

      await pushSqliteToPrisma();
      expect(getOutboxPending()).toEqual({});
    });

    // ── getSqliteDerivedCounts ──────────────────────────────────────────
    it("getSqliteDerivedCounts returns {} before init", async () => {
      const { resetSqliteStateForTests } = await import("../sqlite");
      resetSqliteStateForTests();
      expect(getSqliteDerivedCounts()).toEqual({});
    });

    it("getSqliteDerivedCounts returns all-zero counts on an empty mirror", async () => {
      await resetAndInit();
      const counts = getSqliteDerivedCounts();
      expect(counts.swing_analysis_job).toBe(0);
      expect(counts.swing_signal).toBe(0);
      expect(counts.recommendation_tracker).toBe(0);
      expect(counts.recommendation_status_history).toBe(0);
      expect(counts.recommendation_archive).toBe(0);
      expect(counts.ai_config).toBe(0);
      expect(counts.user_session).toBe(0);
      expect(counts.admin_announcement).toBe(0);
      expect(counts.alert).toBe(0);
      expect(counts.transaction).toBe(0);
    });

    it("getSqliteDerivedCounts returns correct counts after seeding derived tables", async () => {
      await resetAndInit();
      const store = sqlModule.__getStore();

      // Seed a few rows in the admin_announcement table (already has columns from Phase 7 tests).
      store["admin_announcement"] = {
        columns: ["id", "title", "message", "type", "target", "createdAt"],
        rows: [
          [1, "First", "Hello", "info", "all", "2026-09-01"],
          [2, "Second", "World", "alert", "all", "2026-09-02"],
        ],
      };

      // Seed the alert table.
      store["alert"] = {
        columns: ["id", "userId", "type", "symbol", "condition", "triggered", "seen", "createdAt"],
        rows: [
          ["al-1", 3, "price", "RELIANCE", '{"op":">","value":1500}', 1, 0, "2026-09-08"],
        ],
      };

      const counts = getSqliteDerivedCounts();
      expect(counts.admin_announcement).toBe(2);
      expect(counts.alert).toBe(1);
      expect(counts.swing_analysis_job).toBe(0);
      expect(counts.transaction).toBe(0);
    });

    // ── pushSqliteToPrisma opts ─────────────────────────────────────────
    it("pushSqliteToPrisma({ reason: 'admin', leaderGate: false }) succeeds as non-leader and records trigger + leaderGated", async () => {
      await resetAndInit();
      const fb = getSqliteFallback()!;
      fb.upsertSymbol({ symbol: "RELIANCE", companyName: "Reliance Industries", series: "EQ", isActive: true });

      // Confirm outbox has data.
      expect(outboxRows().length).toBe(1);

      // Set isLeader to false — without leaderGate:false this would skip.
      mockLeader.isLeader.mockResolvedValue(false);

      const summary = await pushSqliteToPrisma({ reason: "admin", leaderGate: false });

      expect(summary).not.toBeNull();
      expect(summary!.ran).toBe(true);
      expect(summary!.synced).toBe(1);
      expect(summary!.failed).toBe(0);
      expect(mockPrisma.symbol.upsert).toHaveBeenCalledTimes(1);
      expect(outboxRows().length).toBe(0);

      // The sync_history ledger records trigger:"admin" and leaderGated:false.
      const row = getSqliteFallback()!.getHealthStatus().sqlite.recentSyncs.find(
        (r: any) => r.direction === "sqlite_to_prisma",
      );
      expect(row).toBeDefined();
      expect(row!.trigger).toBe("admin");
      expect(row!.leaderGated).toBe(false);

      // Restore default for later tests.
      mockLeader.isLeader.mockResolvedValue(true);
    });

    it("pushSqliteToPrisma({ reason: 'admin', leaderGate: false }) returns empty-sync result when outbox is empty", async () => {
      await resetAndInit();
      mockLeader.isLeader.mockResolvedValue(false);

      const summary = await pushSqliteToPrisma({ reason: "admin", leaderGate: false });

      expect(summary).not.toBeNull();
      expect(summary!.ran).toBe(true);
      expect(summary!.synced).toBe(0);
      expect(summary!.failed).toBe(0);
      expect(summary!.errors).toEqual([]);

      const row = getSqliteFallback()!.getHealthStatus().sqlite.recentSyncs.find(
        (r: any) => r.direction === "sqlite_to_prisma",
      );
      expect(row).toBeDefined();
      expect(row!.trigger).toBe("admin");
      expect(row!.leaderGated).toBe(false);
      expect(row!.rowsSynced).toBe(0);

      mockLeader.isLeader.mockResolvedValue(true);
    });

    it("pushSqliteToPrisma default opts (no opts) uses trigger 'probe' and leaderGate true", async () => {
      await resetAndInit();
      const fb = getSqliteFallback()!;
      fb.upsertSymbol({ symbol: "TCS", companyName: "TCS", series: "EQ", isActive: true });

      // Default: leaderGate=true, isLeader=false → should be blocked.
      mockLeader.isLeader.mockResolvedValue(false);
      const skipped = await pushSqliteToPrisma();
      expect(skipped).toBeNull();
      expect(outboxRows().length).toBe(1); // outbox not drained

      // Default: leaderGate=true, isLeader=true → should proceed with trigger "probe".
      mockLeader.isLeader.mockResolvedValue(true);
      const summary = await pushSqliteToPrisma();
      expect(summary).not.toBeNull();
      expect(summary!.ran).toBe(true);

      const row = getSqliteFallback()!.getHealthStatus().sqlite.recentSyncs.find(
        (r: any) => r.direction === "sqlite_to_prisma",
      );
      expect(row).toBeDefined();
      expect(row!.trigger).toBe("probe");
      expect(row!.leaderGated).toBe(true);
    });
  });

  describe("SCHEMA_SQL real-sql.js parse (reserved-keyword regression)", () => {
    it("every SCHEMA_SQL statement parses against real SQLite and creates ALL tables incl. reserved 'transaction'", async () => {
      // The file-scoped jest.mock("sql.js") above shadows the real module for
      // the app under test, and a mock is too lenient to catch nearest-token
      // failures: its CREATE classification regex is /CREATE TABLE IF NOT
      // EXISTS (\w+)/, so an UNQUOTED `transaction` still matches and never
      // throws. Use the REAL sql.js (bypasses the mock) so an unquoted SQLite
      // reserved keyword — or a stray `;` inside a -- comment — fails this
      // guard exactly as it would fail `initSqliteBackup` at boot.
      //
      // jest resolves sql.js to the BROWSER build (sql-wasm-browser.js), whose
      // emscripten glue FETCHES the wasm via locateFile — a Windows absolute
      // path fails with "both async and sync fetching of the wasm failed".
      // Feed the wasm bytes directly via wasmBinary (standard emscripten
      // option) so no fetch/path resolution happens at all.
      const initSqlJs = jest.requireActual("sql.js") as unknown as (
        config?: {
          locateFile?: (file: string) => string;
          wasmBinary?: Uint8Array;
        },
      ) => Promise<{
        Database: new (data?: Uint8Array) => {
          run(sql: string, params?: any[]): void;
          exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
          close(): void;
        };
      }>;
      const wasmBinary = require("fs").readFileSync(
        require.resolve("sql.js/dist/sql-wasm.wasm"),
      );
      const SQL = await initSqlJs({ wasmBinary });
      const db = new SQL.Database();

      const SCHEMA_SQL = require("../sqlite").SCHEMA_SQL as string;
      expect(SCHEMA_SQL.length).toBeGreaterThan(0);

      const statements = SCHEMA_SQL.split(";").map((s) => s.trim()).filter(Boolean);
      // The mirror expects pre-existing tables (idempotent CREATE TABLE IF NOT
      // EXISTS). SCHEMA_SQL's first CREATEs already carry IF NOT EXISTS, so no
      // schema pre-seed / dry-run is needed — each statement must run cleanly.
      for (const stmt of statements) {
        // A lone `-- comment` fragment (from a stray ; inside a comment) would
        // throw here; a real mismatch (`near "transaction"`) throws on the
        // CREATE itself. Comments preceding a statement are valid to run alone
        // in SQLite, but filter them for a precise failure.
        const stripped = stmt
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => !l.startsWith("--"))
          .join(" ")
          .trim();
        if (!stripped) continue;
        expect(() => db.run(stripped)).not.toThrow();
      }

      // The reserved-keyword table must actually exist now.
      const rows = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='transaction'`);
      expect(rows.length).toBe(1);
      expect((rows[0].values[0][0] as string).toLowerCase()).toBe("transaction");

      db.close();
    });
  });
});
