/**
 * Tests for recommendationPerformanceService (v3.5.0).
 *
 * Covers:
 *   - getPerformanceColumns(): dynamic column metadata
 *   - getPerformanceList(): next-day promotion, filtering, cached responses,
 *     returnPercent JS sorting, BigInt-safety
 *   - archiveRecommendations(): 360-day boundary, snapshot completeness,
 *     idempotency (already-archived trackers skipped), SetNull survival
 *
 * IMPORTANT: Do NOT use `import { jest } from "@jest/globals"`.
 * SWC (used by next/jest) requires `jest` to be the global variable
 * for `jest.mock()` hoisting to work correctly.
 */

// ─── Mocks (MUST be before any imports — SWC hoists jest.mock) ─────────

jest.mock("@/lib/logger", () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { __esModule: true, default: mock, info: mock.info, warn: mock.warn, error: mock.error, debug: mock.debug };
});

jest.mock("@/lib/cache", () => ({
  __esModule: true,
  recommendationsCache: {
    get: jest.fn(() => null),
    set: jest.fn(),
    del: jest.fn(),
    flushAll: jest.fn(),
    keys: jest.fn(() => []),
  },
}));

jest.mock("@/lib/audit", () => ({
  __esModule: true,
  createAuditLog: jest.fn(async () => {}),
}));

jest.mock("@/lib/prisma", () => {
  const mock = {
    recommendationTracker: {
      findMany: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
    recommendationArchive: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    recommendationStatusHistory: {
      findMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };
  return { __esModule: true, default: mock };
});

// ─── Imports ──────────────────────────────────────────────────────────────

import {
  getPerformanceColumns,
  getPerformanceList,
  archiveRecommendations,
  ARCHIVE_AFTER_DAYS,
} from "@/lib/services/recommendationPerformanceService";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const prisma = require("@/lib/prisma").default as {
  recommendationTracker: {
    findMany: jest.Mock;
    count: jest.Mock;
    delete: jest.Mock;
  };
  recommendationArchive: {
    findMany: jest.Mock;
    create: jest.Mock;
  };
  recommendationStatusHistory: {
    findMany: jest.Mock;
  };
  $queryRaw: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { recommendationsCache } = require("@/lib/cache") as {
  recommendationsCache: { get: jest.Mock; set: jest.Mock; del: jest.Mock; flushAll: jest.Mock; keys: jest.Mock };
};

function makeTracker(overrides: Record<string, unknown> = {}) {
  return {
    id: "tracker-1",
    symbol: "RELIANCE",
    status: "tracking",
    timeHorizon: "swing",
    entryPrice: 2500,
    currentPrice: 2600,
    targetPrice: 2750,
    stopLoss: 2375,
    aiRecommendation: "BUY",
    confidence: 72,
    reasoning: "Strong breakout",
    lastCheckedAt: new Date("2026-08-06T10:30:00.000Z"),
    createdAt: new Date("2026-08-01T10:00:00.000Z"),
    ...overrides,
  };
}

describe("recommendationPerformanceService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    recommendationsCache.get.mockReset();
    recommendationsCache.get.mockReturnValue(null);
    recommendationsCache.set.mockReset();
    prisma.recommendationTracker.findMany.mockReset();
    prisma.recommendationTracker.count.mockReset();
    prisma.recommendationTracker.delete.mockReset();
    prisma.recommendationArchive.findMany.mockReset();
    prisma.recommendationArchive.findMany.mockResolvedValue([]);
    prisma.recommendationArchive.create.mockReset();
    prisma.recommendationStatusHistory.findMany.mockReset();
    prisma.recommendationStatusHistory.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockReset();
    recommendationsCache.keys.mockReset();
    recommendationsCache.keys.mockReturnValue([]);
  });

  describe("getPerformanceColumns", () => {
    it("returns the full column set with defaults", () => {
      const cols = getPerformanceColumns();
      expect(cols.length).toBeGreaterThanOrEqual(10);
      expect(cols.some((c) => c.key === "returnPercent" && c.sortable)).toBe(true);
      expect(cols.some((c) => c.key === "symbol" && c.defaultValue)).toBe(true);
      expect(cols.find((c) => c.key === "status")?.filterable).toBe(true);
    });
  });

  describe("getPerformanceList", () => {
    it("excludes trackers created today (next-day promotion)", async () => {
      prisma.recommendationTracker.findMany.mockResolvedValue([makeTracker()]);
      prisma.recommendationTracker.count.mockResolvedValue(1);

      const res = await getPerformanceList({ limit: 10, offset: 0 });

      expect(prisma.recommendationTracker.findMany).toHaveBeenCalledTimes(1);
      const where = prisma.recommendationTracker.findMany.mock.calls[0][0].where;
      expect(where.createdAt.lt).toBeInstanceOf(Date);
      expect(res.items).toHaveLength(1);
      expect(res.total).toBe(1);
      expect(res.columns.length).toBeGreaterThan(0);
    });

    it("computes returnPercent from current vs entry price", async () => {
      prisma.recommendationTracker.findMany.mockResolvedValue([makeTracker()]);
      prisma.recommendationTracker.count.mockResolvedValue(1);

      const res = await getPerformanceList({});
      expect(res.items[0].returnPercent).toBeCloseTo(4.0, 1); // (2600-2500)/2500*100
    });

    it("bridges null currentPrice from the latest daily_prices close (single batched query)", async () => {
      prisma.recommendationTracker.findMany.mockResolvedValue([
        makeTracker({
          id: "t-bridge",
          symbol: "RELIANCE",
          entryPrice: 2500,
          currentPrice: null, // fresh tracker — perf-check cron hasn't run yet
        }),
      ]);
      prisma.recommendationTracker.count.mockResolvedValue(1);
      // One DISTINCT ON batch query returns the latest close
      prisma.$queryRaw.mockResolvedValue([{ ticker: "RELIANCE", close: 2625 }]);

      const res = await getPerformanceList({});

      expect(res.items[0].currentPrice).toBe(2625);
      expect(res.items[0].returnPercent).toBeCloseTo(5.0, 1); // (2625-2500)/2500*100
      // One batched bridge query shared across all null-price symbols — no N+1
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it("does not run the bridge when every tracker already has a currentPrice", async () => {
      prisma.recommendationTracker.findMany.mockResolvedValue([makeTracker()]);
      prisma.recommendationTracker.count.mockResolvedValue(1);

      await getPerformanceList({});

      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it("gracefully falls back to null currentPrice when the bridge query fails", async () => {
      prisma.recommendationTracker.findMany.mockResolvedValue([
        makeTracker({ id: "t-fail", symbol: "RELIANCE", currentPrice: null }),
      ]);
      prisma.recommendationTracker.count.mockResolvedValue(1);
      prisma.$queryRaw.mockRejectedValue(new Error("db down"));

      const res = await getPerformanceList({});

      expect(res.items[0].currentPrice).toBeNull();
      expect(res.items[0].returnPercent).toBeNull();
      expect(res.items).toHaveLength(1); // row survives — no crash
    });

    it("applies status / category / recommendation filters to the query", async () => {
      prisma.recommendationTracker.findMany.mockResolvedValue([]);
      prisma.recommendationTracker.count.mockResolvedValue(0);

      await getPerformanceList({ status: "target_achieved", category: "btst", recommendation: "BUY" });

      const where = prisma.recommendationTracker.findMany.mock.calls[0][0].where;
      expect(where.status).toBe("target_achieved");
      expect(where.timeHorizon).toBe("btst");
      expect(where.aiRecommendation).toBe("BUY");
    });

    it("sorts by returnPercent in JS (computed field, not stored)", async () => {
      prisma.recommendationTracker.findMany.mockResolvedValue([
        makeTracker({ id: "t1", symbol: "AAA", entryPrice: 100, currentPrice: 110 }), // +10%
        makeTracker({ id: "t2", symbol: "BBB", entryPrice: 100, currentPrice: 95 }), // -5%
        makeTracker({ id: "t3", symbol: "CCC", entryPrice: 100, currentPrice: 130 }), // +30%
      ]);
      prisma.recommendationTracker.count.mockResolvedValue(3);

      const res = await getPerformanceList({ sort: "returnPercent", order: "desc" });
      expect(res.items.map((i) => i.symbol)).toEqual(["CCC", "AAA", "BBB"]);
    });

    it("orders by createdAt when sorting on the computed daysTracked field (regression: passed raw daysTracked to Prisma → 500)", async () => {
      prisma.recommendationTracker.findMany.mockResolvedValue([makeTracker()]);
      prisma.recommendationTracker.count.mockResolvedValue(1);

      await getPerformanceList({ sort: "daysTracked", order: "desc" });

      // Never pass the computed field to Prisma — order by the stored createdAt
      const callArgs = prisma.recommendationTracker.findMany.mock.calls[0][0];
      expect(callArgs.orderBy).toEqual({ createdAt: "desc" });
      expect(Object.keys(callArgs.orderBy)).not.toContain("daysTracked");
    });

    it("caches the response and serves subsequent calls from cache", async () => {
      prisma.recommendationTracker.findMany.mockResolvedValue([makeTracker()]);
      prisma.recommendationTracker.count.mockResolvedValue(1);

      await getPerformanceList({ limit: 25, offset: 0 });
      expect(recommendationsCache.set).toHaveBeenCalledTimes(1);

      // Second call with same params hits the cache — no extra DB query
      recommendationsCache.get.mockReturnValueOnce({
        items: [makeTracker()],
        total: 1,
        columns: [],
      });
      await getPerformanceList({ limit: 25, offset: 0 });
      expect(prisma.recommendationTracker.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe("archiveRecommendations", () => {
    const oldTracker = makeTracker({
      id: "old-1",
      createdAt: new Date(Date.now() - (ARCHIVE_AFTER_DAYS + 10) * 24 * 60 * 60 * 1000),
      status: "tracking",
      currentPrice: 2800,
      entryPrice: 2500,
      symbol: "RELIANCE",
      timeHorizon: "swing",
      aiRecommendation: "BUY",
      confidence: 70,
      reasoning: "old",
    });

    it("archives trackers older than 360 days and hard-deletes them", async () => {
      prisma.recommendationTracker.findMany.mockResolvedValue([oldTracker]);
      prisma.recommendationArchive.findMany.mockResolvedValue([]); // nothing archived yet
      prisma.recommendationStatusHistory.findMany.mockResolvedValue([
        {
          previousStatus: "active",
          newStatus: "tracking",
          triggerSource: "backfill",
          metadata: {},
          createdAt: new Date("2026-08-01T10:00:00.000Z"),
        },
      ]);
      prisma.recommendationArchive.create.mockResolvedValue({ id: "arch-1" });
      prisma.recommendationTracker.delete.mockResolvedValue({ id: "old-1" });

      const result = await archiveRecommendations();

      expect(result.archived).toBe(1);
      expect(prisma.recommendationArchive.create).toHaveBeenCalledTimes(1);
      const snapshot = prisma.recommendationArchive.create.mock.calls[0][0].data;
      expect(snapshot.symbol).toBe("RELIANCE");
      expect(snapshot.trackerId).toBe("old-1");
      expect(snapshot.finalStatus).toBe("tracking");
      expect(snapshot.archivedReason).toBe("age_360d");
      // Status history frozen as JSON with ISO dates
      expect(snapshot.statusHistory).toHaveLength(1);
      expect(typeof snapshot.statusHistory[0].createdAt).toBe("string");
      // returnPercent snapshot: (2800-2500)/2500*100 = 12
      expect(snapshot.returnPercent).toBe(12);
      expect(prisma.recommendationTracker.delete).toHaveBeenCalledWith({ where: { id: "old-1" } });
    });

    it("is idempotent — skips trackers already snapshotted", async () => {
      prisma.recommendationTracker.findMany.mockResolvedValue([oldTracker]);
      // trackerId already exists in archives → skip
      prisma.recommendationArchive.findMany.mockResolvedValue([{ trackerId: "old-1" }]);

      const result = await archiveRecommendations();

      expect(result.archived).toBe(0);
      expect(prisma.recommendationArchive.create).not.toHaveBeenCalled();
      expect(prisma.recommendationTracker.delete).not.toHaveBeenCalled();
    });

    it("does nothing when no trackers are eligible", async () => {
      prisma.recommendationTracker.findMany.mockResolvedValue([]);

      const result = await archiveRecommendations();

      expect(result.archived).toBe(0);
      expect(prisma.recommendationArchive.create).not.toHaveBeenCalled();
    });

    it("keeps trackers younger than 360 days untouched", async () => {
      const youngTracker = makeTracker({
        id: "young-1",
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      });
      // Emulate the age filter: only return the tracker if it is older than the cutoff
      prisma.recommendationTracker.findMany.mockImplementation(({ where }: any) => {
        const cutoff = where?.createdAt?.lte;
        return Promise.resolve(
          cutoff && youngTracker.createdAt.getTime() <= new Date(cutoff).getTime()
            ? [youngTracker]
            : []
        );
      });

      const result = await archiveRecommendations();

      expect(result.archived).toBe(0);
      expect(prisma.recommendationTracker.delete).not.toHaveBeenCalled();
      // Verify the sweep actually queried with an age cutoff
      const callWhere = prisma.recommendationTracker.findMany.mock.calls[0][0].where;
      expect(callWhere.createdAt.lte).toBeInstanceOf(Date);
    });
  });
});
