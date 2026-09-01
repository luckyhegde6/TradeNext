// lib/__tests__/dbOpTiering.test.ts
//
// Focused tests for the v3.21.x cache → SQLite → Prisma tiering ORIGIN that was
// not covered by sqlite.test.ts:
//   1. Daily price snapshot tier helpers (cache → SQLite, zero Prisma ops):
//      getSqliteDailyPriceSnapshot / cacheDailyPriceSnapshot
//   2. SQLite backup export + admin restore (export/restoreSqliteBackup):
//      oversize rejection, invalid-header rejection, missing-table rejection,
//      successful swap.
//
// This file uses its OWN sql.js mock so it does not perturb the 25-test
// sqlite.test.ts suite. jest.resetModules() + a fresh globalThis state are used
// so each describe starts from a clean "not initialized" SQLite layer.

/* eslint-disable @typescript-eslint/no-require-imports */

// ── Mock sql.js ──────────────────────────────────────────────────────────
// A minimal in-memory DB that mirrors the parts sql.js exposes that the SQLite
// layer uses: run(), exec(), prepare().run(), close(), export(). Also models a
// valid exported SQLite file for the restore path.
function makeSqlJsMock() {
  // In-memory store: tableName -> { columns: string[], rows: any[][] }
  const store: Record<string, { columns: string[]; rows: any[][] }> = {};

  const MAGIC = Array.from({ length: 16 }, (_, i) =>
    [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00][i],
  );

  class MockDatabase {
    // When constructed from uploaded bytes (restore), we want exec() to report
    // the core tables so a valid restore is accepted.
    static restored: Uint8Array | null = null;

    run(sql: string, _params: any[] = []) {
      const stmts = sql.split(";").map((s) => s.trim()).filter(Boolean);
      for (const stmt of stmts) {
        const upper = stmt.toUpperCase();
        // Use includes() not startsWith(): SCHEMA_SQL prefixes some CREATE
        // TABLE statements with `--` comment lines that land in the same split
        // chunk (e.g. daily_price_snapshot). Real sql.js tolerates comments.
        if (upper.includes("CREATE TABLE IF NOT EXISTS")) {
          const m = stmt.match(/CREATE TABLE IF NOT EXISTS (\w+)/i);
          if (m && !store[m[1]]) { store[m[1]] = { columns: [], rows: [] }; }
        } else if (upper.startsWith("DELETE")) {
          const m = stmt.match(/DELETE FROM (\w+)/i);
          if (m && store[m[1]]) store[m[1]].rows = [];
        } else if (upper.startsWith("INSERT")) {
          // Plain INSERT INTO ... ON CONFLICT(x) DO UPDATE (upsert) OR
          // INSERT OR REPLACE INTO ... — both treat column 1 as the PK.
          const m = stmt.match(/INSERT (?:OR REPLACE )?INTO (\w+)/i);
          if (m && store[m[1]] && _params.length > 0) {
            const t = store[m[1]];
            if (t.columns.length === 0) {
              const colM = stmt.match(/\(([^)]+)\)/);
              if (colM) t.columns = colM[1].split(",").map((c: string) => c.trim());
            }
            t.rows = t.rows.filter((r) => r[0] !== _params[0]); // upsert on PK (col 1)
            t.rows.push([..._params]);
          }
        }
      }
    }

    exec(sql: string, params: any[] = []) {
      const upper = sql.trim().toUpperCase();
      if (!upper.startsWith("SELECT")) return [];

      // Restore path: a fresh DB "read from bytes" must report core tables.
      if (upper.includes("FROM SQLITE_MASTER")) {
        if (MockDatabase.restored) {
          return [{
            columns: ["name"],
            values: [["_backup_meta"], ["daily_recommendation_run"], ["daily_price_snapshot"]].map((r) => r),
          }];
        }
        return [{ columns: ["name"], values: [] }];
      }

      const selectM = sql.match(/SELECT\s+(.+?)\s+FROM/i);
      const requestedCols = selectM
        ? selectM[1].split(",").map((c: string) => c.trim().replace(/"/g, ""))
        : null;

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
      const whereM = sql.match(/WHERE\s+(\w+)\s*=\s*\?/i);
      if (whereM && params.length > 0) {
        const idx = t.columns.indexOf(whereM[1]);
        if (idx >= 0) rows = rows.filter((r) => r[idx] === params[0]);
      }
      const limitM = sql.match(/LIMIT\s+(\d+)/i);
      if (limitM) rows = rows.slice(0, parseInt(limitM[1]));

      if (requestedCols && !requestedCols.includes("*")) {
        const colIndices = requestedCols.map((c) => t.columns.indexOf(c)).filter((i) => i >= 0);
        const projectedCols = requestedCols.filter((c) => t.columns.includes(c));
        return [{ columns: projectedCols, values: rows.map((r) => colIndices.map((i) => r[i])) }];
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

    export(): Uint8Array {
      return new Uint8Array(MAGIC);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { __esModule: true, default: jest.fn().mockImplementation(async () => ({ Database: MockDatabase as any })) };
}

jest.mock("sql.js", () => makeSqlJsMock());

// ── Mock Prisma ──────────────────────────────────────────────────────────
// The daily_price_snapshot sync block uses prisma.$queryRaw, which the mock
// does NOT provide — syncFromPrisma degrades gracefully (per-table try/catch).
jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    dailyRecommendationRun: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    dailyRecommendationStock: { findMany: jest.fn().mockResolvedValue([]) },
    corporateAction: { findMany: jest.fn().mockResolvedValue([]) },
    chartinkScreener: { findMany: jest.fn().mockResolvedValue([]) },
    workerStatus: { findMany: jest.fn().mockResolvedValue([]) },
    serverLog: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    cronJob: { findMany: jest.fn().mockResolvedValue([]) },
    workerTask: { findMany: jest.fn().mockResolvedValue([]) },
  },
  dbOpsCounter: { reads: 0, writes: 0, _day: "2026-09-01" },
  getIstDayKey: () => "2026-09-01",
  dbErrorCounts: { _day: "2026-09-01", counts: { plan_limit: 0, timeout: 0, accelerate_proxy: 0, connection: 0, write_budget: 0, other: 0 } },
}));

// ── Imports (after mocks) ────────────────────────────────────────────────
import {
  getSqliteFallback,
  cacheDailyPriceSnapshot,
  getSqliteDailyPriceSnapshot,
  exportSqliteBackup,
  restoreSqliteBackup,
  resetSqliteStateForTests,
  ensureSqliteBackup,
  initSqliteBackup,
} from "../sqlite";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sqlJsMock = require("sql.js").default;

describe("DB op tiering: daily-price snapshot + SQLite backup/restore", () => {
  beforeAll(async () => {
    resetSqliteStateForTests();
    await ensureSqliteBackup();
    expect(getSqliteFallback()).not.toBeNull();
  });

  afterAll(() => resetSqliteStateForTests());

  describe("daily price snapshot tier (cache → SQLite, zero Prisma ops)", () => {
    it("returns null when no snapshot is cached", () => {
      expect(getSqliteDailyPriceSnapshot("RELIANCE")).toBeNull();
    });

    it("round-trips a snapshot via cacheDailyPriceSnapshot / getSqliteDailyPriceSnapshot", () => {
      cacheDailyPriceSnapshot({
        symbol: "RELIANCE",
        tradeDate: "2026-09-01",
        open: 2900,
        high: 2950,
        low: 2880,
        close: 2935,
        volume: 1200000,
      });
      const got = getSqliteDailyPriceSnapshot("reliance"); // case-insensitive
      expect(got).not.toBeNull();
      expect(got!.symbol).toBe("RELIANCE");
      expect(got!.tradeDate).toBe("2026-09-01");
      expect(got!.close).toBe(2935);
      expect(got!.volume).toBe(1200000);
    });

    it("upserts (updates, does not duplicate) on repeated cache for the same symbol", () => {
      cacheDailyPriceSnapshot({
        symbol: "RELIANCE",
        tradeDate: "2026-09-01",
        open: 2900, high: 2950, low: 2880, close: 2940, volume: 1200000,
      });
      // Updated in place (same PK) — not a second row.
      const got = getSqliteDailyPriceSnapshot("RELIANCE");
      expect(got!.close).toBe(2940);
      // A second symbol coexists without clobbering the first.
      cacheDailyPriceSnapshot({
        symbol: "TCS", tradeDate: "2026-09-01", open: 3600, high: 3650, low: 3580, close: 3620, volume: 500000,
      });
      expect(getSqliteDailyPriceSnapshot("RELIANCE")!.close).toBe(2940);
      expect(getSqliteDailyPriceSnapshot("TCS")!.close).toBe(3620);
    });
  });

  describe("SQLite backup export", () => {
    it("exports the in-memory DB as bytes starting with the SQLite header", () => {
      const bytes = exportSqliteBackup();
      expect(bytes).not.toBeNull();
      const b = bytes as Uint8Array;
      expect(b.byteLength).toBeGreaterThanOrEqual(16);
      expect(Array.from(b.slice(0, 16))).toEqual([
        0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66,
        0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00,
      ]);
    });

    it("returns null when the DB is not initialized", () => {
      resetSqliteStateForTests();
      expect(exportSqliteBackup()).toBeNull();
      // restore for subsequent tests
      return initSqliteBackup();
    });
  });

  describe("SQLite backup restore validation", () => {
    function headerBytes(): Uint8Array {
      const b = new Uint8Array(16);
      [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00].forEach((v, i) => (b[i] = v));
      return b;
    }

    it("rejects non-SQLite bytes (missing magic header)", async () => {
      await expect(restoreSqliteBackup(new Uint8Array([1, 2, 3, 4, 5]))).rejects.toThrow(/SQLite header/);
    });

    it("rejects oversized uploads (> 50 MB)", async () => {
      const big = new Uint8Array(51 * 1024 * 1024);
      await expect(restoreSqliteBackup(big)).rejects.toThrow(/too large/);
    });

    it("applies a valid backup (header + core tables present) by swapping the active DB", async () => {
      // Simulate a valid uploaded file: correct header + core tables discovered.
      const sqlJs = await sqlJsMock();
      sqlJs.Database.restored = headerBytes();

      const result = await restoreSqliteBackup(headerBytes());
      expect(result.missing).toEqual([]);
      expect(result.db).toBeGreaterThanOrEqual(1);

      // The active fallback is a fresh DB with the restored snapshot table.
      const fb = getSqliteFallback();
      expect(fb).not.toBeNull();
      expect(fb!.isReady()).toBe(true);
    });

    it("rejects a header-valid file that lacks required tables", async () => {
      const sqlJs = await sqlJsMock();
      sqlJs.Database.restored = null; // empty DB → missing tables
      await expect(restoreSqliteBackup(headerBytes())).rejects.toThrow(/_backup_meta/);
    });
  });
});