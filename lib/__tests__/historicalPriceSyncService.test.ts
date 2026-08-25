/**
 * Tests for lib/services/historicalPriceSyncService.ts (v3.10.0):
 *   - formatNseDate / buildDateRange: window derivation + validation.
 *   - dedupeSymbols / resolveSyncScope: scope resolution (explicit + default
 *     NIFTY 50 ∪ trackers ∪ live screener captures, deduped, capped).
 *   - buildUpsertSql: multi-row idempotent upsert SQL shape.
 *   - syncHistoricalPrices: dry-run (no writes), apply (writes), error
 *     tolerance, empty-scope short-circuit, maxDurationMs guard.
 *
 * IMPORTANT: Do NOT use `import { jest } from "@jest/globals"`.
 * SWC (used by next/jest) requires `jest` to be the global variable for
 * `jest.mock()` hoisting to work correctly.
 */

// ─── Mocks (MUST be before imports — SWC hoists jest.mock) ────────────────

jest.mock("@/lib/logger", () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { __esModule: true, default: mock, info: mock.info, warn: mock.warn, error: mock.error, debug: mock.debug };
});

jest.mock("@/lib/nse-api", () => ({
  fetchSecurityWiseHistoricalData: jest.fn(),
}));

jest.mock("@/lib/index-service", () => ({
  getIndexStocks: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    recommendationTracker: { findMany: jest.fn() },
    chartinkScreenerResult: { findMany: jest.fn() },
  },
}));

import {
  formatNseDate,
  buildDateRange,
  dedupeSymbols,
  resolveSyncScope,
  buildUpsertSql,
  syncHistoricalPrices,
} from "@/lib/services/historicalPriceSyncService";
import type { SecurityWiseHistoricalBar } from "@/lib/nse-api";
import { fetchSecurityWiseHistoricalData } from "@/lib/nse-api";
import { getIndexStocks } from "@/lib/index-service";
import prisma from "@/lib/prisma";

const fetchMock = fetchSecurityWiseHistoricalData as jest.MockedFunction<typeof fetchSecurityWiseHistoricalData>;
const indexMock = getIndexStocks as jest.MockedFunction<typeof getIndexStocks>;
const trackerFindMany = prisma.recommendationTracker.findMany as jest.Mock;
const capturedFindMany = prisma.chartinkScreenerResult.findMany as jest.Mock;

const bar = (symbol: string, date: string, close = 100): SecurityWiseHistoricalBar => ({
  symbol,
  series: "EQ",
  timestamp: new Date(date).getTime(),
  date,
  open: close,
  high: close + 2,
  low: close - 2,
  close,
  previousClose: close - 1,
  vwap: close + 0.5,
  volume: 12345,
  value: 1234500,
  trades: 321,
  deliveryQty: 5000,
  deliveryPercent: 40.5,
});

beforeEach(() => {
  jest.resetAllMocks(); // reset implementations too — mockResolvedValue leaks across tests otherwise
});

// ─── formatNseDate / buildDateRange ────────────────────────────────────────

describe("formatNseDate", () => {
  it("formats as DD-MM-YYYY with zero padding", () => {
    expect(formatNseDate(new Date(2026, 7, 4))).toBe("04-08-2026"); // Aug = month index 7
    expect(formatNseDate(new Date(2026, 0, 1))).toBe("01-01-2026");
  });
});

describe("buildDateRange", () => {
  it("defaults to 180 days back from today", () => {
    const { from, to } = buildDateRange({});
    expect(to).toBe(formatNseDate(new Date()));
    const fromMs = new Date(from.split("-").reverse().join("-")).getTime();
    const todayMs = new Date(to.split("-").reverse().join("-")).getTime();
    expect(Math.round((todayMs - fromMs) / 86400000)).toBeCloseTo(180, 0);
  });

  it("honors explicit from/to and days override", () => {
    expect(buildDateRange({ days: 90 })).toEqual({
      from: formatNseDate(new Date(Date.now() - 90 * 86400000)),
      to: formatNseDate(new Date()),
    });
    expect(buildDateRange({ from: "01-04-2026", to: "14-08-2026" })).toEqual({
      from: "01-04-2026",
      to: "14-08-2026",
    });
  });

  it("throws on malformed or inverted windows", () => {
    expect(() => buildDateRange({ from: "2026/04/01", to: "14-08-2026" })).toThrow(/DD-MM-YYYY/);
    expect(() => buildDateRange({ from: "14-08-2026", to: "01-04-2026" })).toThrow(/from must be <= to/);
  });
});

// ─── dedupeSymbols / resolveSyncScope ─────────────────────────────────────

describe("dedupeSymbols", () => {
  it("trims, uppercases, dedupes and drops empties", () => {
    expect(dedupeSymbols(["  reliance ", "TCS", "reliance", "", "   ", "NIFTY 50"])).toEqual([
      "RELIANCE",
      "TCS",
      "NIFTY 50",
    ]);
  });
});

describe("resolveSyncScope", () => {
  it("returns explicit symbols deduped and capped", async () => {
    const scope = await resolveSyncScope(["tcs", "TCS", "RELIANCE"], 2);
    expect(scope).toEqual(["TCS", "RELIANCE"]);
    expect(trackerFindMany).not.toHaveBeenCalled();
  });

  it("returns NIFTY 50 constituents only (v3.19.0 scope reduction)", async () => {
    indexMock.mockResolvedValue([{ symbol: "NIFTY50A" }, { symbol: "nifty50b" }]);
    trackerFindMany.mockResolvedValue([{ symbol: "TRACKED" }]); // no longer queried
    capturedFindMany.mockResolvedValue([{ symbol: "CAPTURED" }]); // no longer queried

    const scope = await resolveSyncScope(undefined, 10);
    // v3.19.0: scope reduced to NIFTY 50 only — no trackers/screener captures
    expect(scope).toEqual(["NIFTY50A", "NIFTY50B"]);
    // Tracker and screener DB queries are no longer made
    expect(trackerFindMany).not.toHaveBeenCalled();
    expect(capturedFindMany).not.toHaveBeenCalled();
  });

  it("caps the scope and degrades gracefully when NIFTY 50 fetch fails", async () => {
    indexMock.mockRejectedValue(new Error("NSE down"));
    trackerFindMany.mockRejectedValue(new Error("db down"));
    capturedFindMany.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => ({ symbol: `SYM${i}` })),
    );

    const scope = await resolveSyncScope(undefined, 10);
    // NIFTY 50 failed → empty scope (trackers/screener no longer in default scope)
    expect(scope).toHaveLength(0);
  });
});

// ─── buildUpsertSql ───────────────────────────────────────────────────────

describe("buildUpsertSql", () => {
  it("builds an 8-param-per-row idempotent upsert", () => {
    const { sql, values } = buildUpsertSql([
      bar("RELIANCE", "2026-08-04", 100),
      bar("reliance", "2026-08-05", 101),
    ]);
    expect(sql).toContain("INSERT INTO daily_prices (ticker, \"tradeDate\", open, high, low, close, volume, vwap)");
    expect(sql).toContain("ON CONFLICT (ticker, \"tradeDate\") DO UPDATE SET");
    expect(sql.match(/\$1(?![0-9])/g)).toHaveLength(1); // 8 params per row → 16 total placeholders
    expect(sql.match(/\$16(?![0-9])/g)).toHaveLength(1);
    expect(values).toHaveLength(16);
    expect(values[0]).toBe("RELIANCE"); // uppercased
    expect(values[1]).toBeInstanceOf(Date);
    expect(values[6]).toBe(BigInt(12345));
    expect(values[8]).toBe("RELIANCE"); // second row (offset 8) also uppercased
  });

  it("maps zero volume to null and keeps a numeric vwap", () => {
    const b = bar("TCS", "2026-08-04");
    b.volume = 0; // falsy → null
    const { values } = buildUpsertSql([b]);
    expect(values[6]).toBeNull();
    expect(values[7]).toBe(b.vwap);
  });
});

// ─── syncHistoricalPrices ─────────────────────────────────────────────────

describe("syncHistoricalPrices", () => {
  it("short-circuits on an empty scope", async () => {
    const result = await syncHistoricalPrices({ symbols: [], dryRun: true, fetchDelayMs: 0 });
    expect(result.scope).toEqual([]);
    expect(result.barsFetched).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("dry-run fetches and counts but never writes", async () => {
    fetchMock.mockResolvedValue([bar("TCS", "2026-08-04"), bar("TCS", "2026-08-05")]);
    const db = { $executeRawUnsafe: jest.fn() };

    const result = await syncHistoricalPrices({
      symbols: ["TCS"],
      dryRun: true,
      fetchDelayMs: 0,
      db: db as never,
    });

    expect(result.fetchedSymbols).toBe(1);
    expect(result.barsFetched).toBe(2);
    expect(result.barsWritten).toBe(0);
    expect(result.dryRun).toBe(true);
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("TCS", expect.any(String), expect.any(String), "EQ");
  });

  it("applies writes via idempotent multi-row upserts, chunking > 200 bars", async () => {
    const manyBars = Array.from({ length: 250 }, (_, i) =>
      bar("TCS", `2026-0${(i % 9) + 1}-${String((i % 27) + 1).padStart(2, "0")}`),
    );
    fetchMock.mockResolvedValue(manyBars);
    const db = { $executeRawUnsafe: jest.fn().mockResolvedValue({}) };

    const result = await syncHistoricalPrices({
      symbols: ["TCS"],
      dryRun: false,
      fetchDelayMs: 0,
      db: db as never,
    });

    expect(result.barsWritten).toBe(250);
    // 250 bars → 2 chunks (200 + 50). $executeRawUnsafe receives (sql, ...values)
    // so the value count is call args minus the sql string.
    expect(db.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    const first = db.$executeRawUnsafe.mock.calls[0];
    expect(first[0]).toContain("ON CONFLICT");
    expect(first.length - 1).toBe(200 * 8);
  });

  it("tolerates per-symbol failures without aborting the backfill", async () => {
    fetchMock.mockImplementation(async (symbol: string) => {
      if (symbol === "DEAD") throw new Error("NSE 429");
      return [bar(symbol, "2026-08-04")];
    });
    const db = { $executeRawUnsafe: jest.fn().mockResolvedValue({}) };

    const result = await syncHistoricalPrices({
      symbols: ["DEAD", "ALIVE"],
      dryRun: false,
      fetchDelayMs: 0,
      db: db as never,
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].symbol).toBe("DEAD");
    expect(result.errors[0].error).toContain("429");
    expect(result.fetchedSymbols).toBe(1);
    expect(result.barsWritten).toBe(1);
  });

  it("honors maxDurationMs by stopping before processing more symbols", async () => {
    fetchMock.mockResolvedValue([bar("TCS", "2026-08-04")]);
    const db = { $executeRawUnsafe: jest.fn() };

    // maxDurationMs=50 with a 200ms inter-symbol sleep: the first symbol is
    // processed (elapsed ~0 < 50), the 200ms sleep crosses the cap, so the
    // second symbol must be skipped. Deterministic (real timers).
    const result = await syncHistoricalPrices({
      symbols: ["TCS", "RELIANCE", "INFY"],
      maxDurationMs: 50,
      dryRun: true,
      fetchDelayMs: 200,
      db: db as never,
    });

    expect(result.scope).toHaveLength(3);
    expect(result.fetchedSymbols).toBe(1);
    expect(result.barsFetched).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
