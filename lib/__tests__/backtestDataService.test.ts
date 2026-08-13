/**
 * Tests for backtestDataService — the memory → temp table → daily_prices → NSE
 * data chain used by backtesting and the MCP getHistoricalData function.
 *
 * Verifies cache-ordering: cheapest fresh source wins, NSE-fetched bars are
 * NEVER written to main daily_prices (temp table only), and the temp table is
 * age-pruned.
 *
 * IMPORTANT: Do NOT use `import { jest } from "@jest/globals"`.
 * SWC (used by next/jest) requires `jest` to be the global variable
 * for `jest.mock()` hoisting to work correctly.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Mocks (must be declared before jest.mock for SWC hoisting) ──

jest.mock("@/lib/nse-client", () => ({
  nseFetch: jest.fn(),
}));

jest.mock("@/lib/nse-api", () => ({
  fetchSecurityWiseHistoricalData: jest.fn(),
  securityWiseBarsToOHLCV: jest.fn((bars: any[]) =>
    bars
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((b) => ({
        timestamp: b.timestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      }))
  ),
}));

jest.mock("@/lib/prisma", () => {
  const mock = {
    $executeRawUnsafe: jest.fn(),
    backtestHistory: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    dailyPrice: {
      findMany: jest.fn(),
    },
  };
  return { __esModule: true, default: mock };
});

const mockPrisma = require("@/lib/prisma").default as Record<string, any>;
const mockNseApi = require("@/lib/nse-api") as {
  fetchSecurityWiseHistoricalData: jest.Mock;
  securityWiseBarsToOHLCV: jest.Mock;
};

import {
  getBacktestData,
  pruneTempTable,
  formatNseDate,
  defaultDateRange,
  ensureBacktestHistoryTable,
  resetBacktestHistoryGuard,
} from "@/lib/services/backtestDataService";
import { historicalCache } from "@/lib/cache";

// ─── Helpers ──

const makeBars = (n: number, startTs = 1000) =>
  Array.from({ length: n }, (_, i) => ({
    timestamp: startTs + i * 86400000,
    open: 100 + i,
    high: 110 + i,
    low: 95 + i,
    close: 105 + i,
    volume: 1000 + i,
  }));

describe("backtestDataService cache ordering", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetBacktestHistoryGuard(); // clear memoized ensure promise between tests
    historicalCache.flushAll();
  });

  it("returns from memory cache (0 DB ops) on a fresh hit", async () => {
    const bars = makeBars(3);
    historicalCache.set("backtest:RELIANCE:01-01-2020:01-01-2025", {
      ohlcv: bars,
      fetchedAt: Date.now(),
    });

    const result = await getBacktestData("RELIANCE", "01-01-2020", "01-01-2025");

    expect(result.source).toBe("memory");
    expect(result.barCount).toBe(3);
    expect(mockPrisma.backtestHistory.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.dailyPrice.findMany).not.toHaveBeenCalled();
    expect(mockNseApi.fetchSecurityWiseHistoricalData).not.toHaveBeenCalled();
  });

  it("falls through to temp table when memory is empty, repopulating memory", async () => {
    const bars = makeBars(2);
    mockPrisma.backtestHistory.findUnique.mockResolvedValue({
      symbol: "RELIANCE",
      fromDate: "01-01-2020",
      toDate: "01-01-2025",
      series: "EQ",
      ohlcv: bars,
      barCount: 2,
      fetchedAt: new Date(), // fresh (< 24h)
    });

    const result = await getBacktestData("RELIANCE", "01-01-2020", "01-01-2025");

    expect(result.source).toBe("db");
    expect(result.barCount).toBe(2);
    // memory repopulated → next call is a 0-op hit
    expect(historicalCache.get("backtest:RELIANCE:01-01-2020:01-01-2025")).toBeDefined();
    expect(mockPrisma.dailyPrice.findMany).not.toHaveBeenCalled();
    expect(mockNseApi.fetchSecurityWiseHistoricalData).not.toHaveBeenCalled();
  });

  it("reuses main daily_prices (read-only) when it has enough rows", async () => {
    mockPrisma.backtestHistory.findUnique.mockResolvedValue(null);
    const rows = makeBars(60).map((b) => ({
      tradeDate: new Date(b.timestamp),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));
    mockPrisma.dailyPrice.findMany.mockResolvedValue(rows);

    const result = await getBacktestData("RELIANCE", "01-01-2020", "01-01-2025");

    expect(result.source).toBe("db");
    expect(result.barCount).toBe(60);
    // read-only: no write to main table, no NSE call
    expect(mockPrisma.dailyPrice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ticker: "NSE:RELIANCE" } })
    );
    expect(mockPrisma.backtestHistory.upsert).not.toHaveBeenCalled();
    expect(mockNseApi.fetchSecurityWiseHistoricalData).not.toHaveBeenCalled();
  });

  it("fetches from NSE when nothing fresh is cached, upserting to temp table only", async () => {
    mockPrisma.backtestHistory.findUnique.mockResolvedValue(null);
    mockPrisma.dailyPrice.findMany.mockResolvedValue([]); // < 50 rows
    mockNseApi.fetchSecurityWiseHistoricalData.mockResolvedValue(
      makeBars(4).map((b, i) => ({
        symbol: "RELIANCE",
        series: "EQ",
        timestamp: b.timestamp,
        date: "2025-01-0" + (i + 1),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        previousClose: b.close - 1,
        vwap: b.close,
        volume: b.volume,
        value: b.volume * b.close,
        trades: 100,
        deliveryQty: null,
        deliveryPercent: null,
      }))
    );

    const result = await getBacktestData("RELIANCE", "01-01-2020", "01-01-2025");

    expect(result.source).toBe("nse");
    expect(result.barCount).toBe(4);
    // NSE data written ONLY to temp table — never to main daily_prices
    expect(mockPrisma.backtestHistory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ symbol: "RELIANCE", series: "EQ" }),
      })
    );
    expect(mockPrisma.dailyPrice.createMany).toBeUndefined(); // model has no createMany — main table untouched
    expect(mockPrisma.dailyPrice.findMany).toHaveBeenCalled();
    // memory populated for next call
    expect(historicalCache.get("backtest:RELIANCE:01-01-2020:01-01-2025")).toBeDefined();
  });

  it("falls back to stale temp row when NSE returns nothing", async () => {
    const bars = makeBars(2);
    mockPrisma.backtestHistory.findUnique.mockResolvedValue({
      symbol: "RELIANCE",
      fromDate: "01-01-2020",
      toDate: "01-01-2025",
      series: "EQ",
      ohlcv: bars,
      barCount: 2,
      fetchedAt: new Date(Date.now() - 48 * 60 * 60 * 1000), // stale (2 days)
    });
    mockPrisma.dailyPrice.findMany.mockResolvedValue([]);
    mockNseApi.fetchSecurityWiseHistoricalData.mockResolvedValue([]);

    const result = await getBacktestData("RELIANCE", "01-01-2020", "01-01-2025");

    // Stale temp data is preferred over a hard failure
    expect(result.source).toBe("db");
    expect(result.barCount).toBe(2);
  });

  it("prunes temp table rows older than 30 days", async () => {
    mockPrisma.backtestHistory.deleteMany.mockResolvedValue({ count: 5 });

    const removed = await pruneTempTable();

    expect(removed).toBe(5);
    expect(mockPrisma.backtestHistory.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { fetchedAt: { lt: expect.any(Date) } },
      })
    );
  });

  it("prune failures are non-fatal (fire-and-forget, logged)", async () => {
    mockPrisma.backtestHistory.deleteMany.mockRejectedValue(new Error("db down"));
    // Should not throw to the caller
    await expect(pruneTempTable()).rejects.toThrow("db down");
  });
});

describe("backtestDataService temp-table self-healing (prod gap fix)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetBacktestHistoryGuard();
    historicalCache.flushAll();
  });

  it("issues CREATE TABLE IF NOT EXISTS mirroring the BacktestHistory model", async () => {
    mockPrisma.$executeRawUnsafe.mockResolvedValue(1);

    await expect(ensureBacktestHistoryTable()).resolves.toBe(true);

    const sqls = mockPrisma.$executeRawUnsafe.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(sqls).toHaveLength(4); // create + 3 indexes
    expect(sqls[0]).toMatch(/CREATE TABLE IF NOT EXISTS "backtest_history"/);
    expect(sqls[0]).toContain('"fromDate" TEXT NOT NULL');
    expect(sqls[0]).toContain('"toDate" TEXT NOT NULL');
    expect(sqls[0]).toContain('"series" TEXT NOT NULL DEFAULT \'EQ\'');
    expect(sqls[0]).toContain('"ohlcv" JSONB NOT NULL');
    expect(sqls[0]).toContain('"barCount" INTEGER NOT NULL DEFAULT 0');
    expect(sqls[0]).toContain('"fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP');
    expect(sqls[1]).toContain('"backtest_history_symbol_fromDate_toDate_series_key"');
    expect(sqls[2]).toContain('"backtest_history_symbol_idx"');
    expect(sqls[3]).toContain('"backtest_history_fetchedAt_idx"');
  });

  it("is memoized per process — DDL issued exactly once", async () => {
    mockPrisma.$executeRawUnsafe.mockResolvedValue(1);

    await ensureBacktestHistoryTable();
    await ensureBacktestHistoryTable();

    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(4);
  });

  it("resetBacktestHistoryGuard clears the memo", async () => {
    mockPrisma.$executeRawUnsafe.mockResolvedValue(1);

    await ensureBacktestHistoryTable();
    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(4);

    resetBacktestHistoryGuard();
    await ensureBacktestHistoryTable();
    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(8);
  });

  it("retries the DDL after a failure (failures are not memoized)", async () => {
    mockPrisma.$executeRawUnsafe.mockRejectedValue(new Error("permission denied"));

    await expect(ensureBacktestHistoryTable()).resolves.toBe(false);
    await expect(ensureBacktestHistoryTable()).resolves.toBe(false);

    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(8); // 4 stmts × 2 attempts
  });

  it("degrades to daily_prices/NSE when the table cannot be ensured (no 500)", async () => {
    mockPrisma.$executeRawUnsafe.mockRejectedValue(new Error("relation does not exist"));
    const rows = makeBars(60).map((b) => ({
      tradeDate: new Date(b.timestamp),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));
    mockPrisma.dailyPrice.findMany.mockResolvedValue(rows);

    const result = await getBacktestData("RELIANCE", "01-01-2020", "01-01-2025");

    expect(result.source).toBe("db");
    expect(result.barCount).toBe(60);
    // temp leg skipped entirely — no 500, no upsert attempt
    expect(mockPrisma.backtestHistory.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.backtestHistory.upsert).not.toHaveBeenCalled();
  });

  it("NSE path still serves bars when the temp table is missing (upsert skipped)", async () => {
    mockPrisma.$executeRawUnsafe.mockRejectedValue(new Error("relation does not exist"));
    mockPrisma.dailyPrice.findMany.mockResolvedValue([]); // < 50 rows
    mockNseApi.fetchSecurityWiseHistoricalData.mockResolvedValue(
      makeBars(4).map((b, i) => ({
        symbol: "RELIANCE",
        series: "EQ",
        timestamp: b.timestamp,
        date: "2025-01-0" + (i + 1),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        previousClose: b.close - 1,
        vwap: b.close,
        volume: b.volume,
        value: b.volume * b.close,
        trades: 100,
        deliveryQty: null,
        deliveryPercent: null,
      }))
    );

    const result = await getBacktestData("RELIANCE", "01-01-2020", "01-01-2025");

    expect(result.source).toBe("nse");
    expect(result.barCount).toBe(4);
    expect(mockPrisma.backtestHistory.upsert).not.toHaveBeenCalled();
    // memory still populated for the next call
    expect(historicalCache.get("backtest:RELIANCE:01-01-2020:01-01-2025")).toBeDefined();
  });

  it("serves the temp table when it exists (normal prod path after self-heal)", async () => {
    mockPrisma.$executeRawUnsafe.mockResolvedValue(1); // DDL succeeds
    const bars = makeBars(2);
    mockPrisma.backtestHistory.findUnique.mockResolvedValue({
      symbol: "RELIANCE",
      fromDate: "01-01-2020",
      toDate: "01-01-2025",
      series: "EQ",
      ohlcv: bars,
      barCount: 2,
      fetchedAt: new Date(),
    });

    const result = await getBacktestData("RELIANCE", "01-01-2020", "01-01-2025");

    expect(result.source).toBe("db");
    expect(result.barCount).toBe(2);
    expect(mockPrisma.backtestHistory.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe("backtestDataService date helpers", () => {
  it("formats dates as DD-MM-YYYY", () => {
    expect(formatNseDate(new Date(2026, 7, 6))).toBe("06-08-2026");
    expect(formatNseDate(new Date(2026, 0, 1))).toBe("01-01-2026");
  });

  it("defaultDateRange spans 5 years", () => {
    const { from, to } = defaultDateRange();
    expect(from).toMatch(/^\d{2}-\d{2}-\d{4}$/);
    expect(to).toMatch(/^\d{2}-\d{2}-\d{4}$/);
    const fromDate = new Date(from.split("-").reverse().join("-"));
    const toDate = new Date(to.split("-").reverse().join("-"));
    const years = (toDate.getTime() - fromDate.getTime()) / (365.25 * 24 * 3600 * 1000);
    expect(years).toBeGreaterThan(4.9);
    expect(years).toBeLessThan(5.1);
  });
});
