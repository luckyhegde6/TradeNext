/**
 * Tests for chartinkService — Hybrid Chartink/TradingView screener.
 *
 * Covers: deduplication logic, Chartink-first fallback to TradingView,
 * single/all screener runs, cache behavior.
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
  staticCache: {
    get: jest.fn(() => null),
    set: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock("@/lib/services/tradingview-service", () => ({
  __esModule: true,
  advancedScan: jest.fn(async () => []),
}));

// ─── Imports ──────────────────────────────────────────────────────────────

import { runDailyScreeners, runSingleScreener, getScreeners } from "@/lib/services/chartinkService";

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeChartinkResponse(stocks: Record<string, unknown>[]) {
  return { ok: true, json: () => Promise.resolve({ data: stocks }) } as Response;
}

function makeChartinkStock(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    nse_script_code: "RELIANCE",
    name: "Reliance Industries",
    close: 2500,
    change: 50,
    pChange: 2.04,
    volume: 1000000,
    ...overrides,
  };
}

function makeTVRow(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "NSE:RELIANCE",
    name: "Reliance Industries",
    close: 2500,
    change: 50,
    change_percent: 2.04,
    volume: 1000000,
    relative_volume_10d_calc: 1.5,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("chartinkService", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { staticCache } = require("@/lib/cache") as { staticCache: { get: jest.Mock; set: jest.Mock; delete: jest.Mock } };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { advancedScan } = require("@/lib/services/tradingview-service") as { advancedScan: jest.Mock };

  let savedFetch: typeof global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    staticCache.get.mockReset();
    staticCache.get.mockReturnValue(null);
    staticCache.set.mockReset();
    staticCache.delete.mockReset();
    advancedScan.mockReset();
    advancedScan.mockResolvedValue([]);
    savedFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = savedFetch;
  });

  // ── getScreeners ──────────────────────────────────────────────────────

  describe("getScreeners", () => {
    test("returns 7 screener definitions", () => {
      expect(getScreeners()).toHaveLength(7);
    });

    test("each screener has required fields", () => {
      for (const s of getScreeners()) {
        expect(s.id).toBeTruthy();
        expect(s.name).toBeTruthy();
        expect(s.chartinkTemplate).toBeTruthy();
        expect(Array.isArray(s.tradingviewFilters)).toBe(true);
        expect(s.tradingviewFilters.length).toBeGreaterThan(0);
      }
    });

    test("all chartink templates start with tpl_", () => {
      for (const s of getScreeners()) {
        expect(s.chartinkTemplate).toMatch(/^tpl_/);
      }
    });
  });

  // ── runDailyScreeners ─────────────────────────────────────────────────

  describe("runDailyScreeners", () => {
    test("returns cached results when cache hit", async () => {
      const cachedResults = [
        { symbol: "TCS", name: "TCS", price: 3800, change: 100, changePercent: 2.7, volume: 500000, screenerNames: ["Short Term Breakouts"], screenerCount: 1 },
      ];
      staticCache.get.mockReturnValue(cachedResults);

      const results = await runDailyScreeners();
      expect(results).toEqual(cachedResults);
      expect(staticCache.get).toHaveBeenCalledWith("daily-recommendations:screener-results");
    });

    test("fetches fresh data when forceRefresh is true", async () => {
      staticCache.get.mockReturnValue([{ cached: true }]);

      const results = await runDailyScreeners({ forceRefresh: true });
      expect(Array.isArray(results)).toBe(true);
    });

    test("runs all 7 screeners and merges results via TradingView fallback", async () => {
      global.fetch = jest.fn(async () => { throw new Error("Chartink unavailable"); }) as never;

      advancedScan.mockResolvedValue([
        makeTVRow({ symbol: "NSE:RELIANCE", close: 2500, change: 50, change_percent: 2.04, volume: 1000000 }),
        makeTVRow({ symbol: "NSE:TCS", close: 3800, name: "TCS", change: 100, change_percent: 2.7, volume: 500000 }),
      ]);

      const results = await runDailyScreeners({ forceRefresh: true });
      expect(results.length).toBeGreaterThanOrEqual(1);
      for (const r of results) {
        expect(Array.isArray(r.screenerNames)).toBe(true);
        expect(r.screenerCount).toBeGreaterThanOrEqual(1);
      }
    });

    test("deduplicates stocks found by multiple screeners", async () => {
      global.fetch = jest.fn(async () => { throw new Error("Chartink unavailable"); }) as never;

      let callCount = 0;
      advancedScan.mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          return [makeTVRow({ symbol: "NSE:RELIANCE", close: 2500, change: 50, change_percent: 2.0 })];
        }
        return [];
      });

      const results = await runDailyScreeners({ forceRefresh: true });
      const reliance = results.find((r) => r.symbol === "RELIANCE");
      expect(reliance).toBeDefined();
      expect(reliance!.screenerCount).toBeGreaterThanOrEqual(2);
      expect(reliance!.screenerNames.length).toBeGreaterThanOrEqual(2);
    });

    test("sorts by screenerCount descending (more agreement first)", async () => {
      global.fetch = jest.fn(async () => { throw new Error("Chartink unavailable"); }) as never;

      let callCount = 0;
      advancedScan.mockImplementation(async () => {
        callCount++;
        if (callCount <= 3) {
          return [makeTVRow({ symbol: "NSE:RELIANCE", close: 2500, change: 50, change_percent: 2.0 })];
        }
        if (callCount === 4) {
          return [makeTVRow({ symbol: "NSE:TCS", close: 3800, change: 100, change_percent: 2.7 })];
        }
        return [];
      });

      const results = await runDailyScreeners({ forceRefresh: true });
      expect(results[0].symbol).toBe("RELIANCE");
      expect(results[0].screenerCount).toBeGreaterThanOrEqual(3);
    });

    test("falls back to TradingView when Chartink fails", async () => {
      global.fetch = jest.fn(async () => { throw new Error("Chartink timeout"); }) as never;

      advancedScan.mockResolvedValue([
        makeTVRow({ symbol: "NSE:RELIANCE", name: "Reliance Industries" }),
      ]);

      const results = await runDailyScreeners({ forceRefresh: true });
      expect(advancedScan).toHaveBeenCalled();
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test("falls back to TradingView when Chartink returns empty data", async () => {
      global.fetch = jest.fn(async () => makeChartinkResponse([])) as never;

      advancedScan.mockResolvedValue([
        makeTVRow({ symbol: "NSE:SBIN", name: "SBI", close: 800 }),
      ]);

      const results = await runDailyScreeners({ forceRefresh: true });
      expect(advancedScan).toHaveBeenCalled();
    });

    test("handles partial screener failures gracefully", async () => {
      let fetchCallCount = 0;
      global.fetch = jest.fn(async () => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          return makeChartinkResponse([
            makeChartinkStock({ nse_script_code: "RELIANCE", close: 2500, pChange: 2.0 }),
          ]);
        }
        if (fetchCallCount === 2) {
          throw new Error("Network error");
        }
        if (fetchCallCount === 3) {
          return makeChartinkResponse([
            makeChartinkStock({ nse_script_code: "TCS", close: 3800, pChange: 1.5 }),
          ]);
        }
        return makeChartinkResponse([]);
      }) as never;

      const results = await runDailyScreeners({ forceRefresh: true });
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    test("updates price to latest non-zero value from multiple screeners", async () => {
      let fetchCallCount = 0;
      global.fetch = jest.fn(async () => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          return makeChartinkResponse([
            makeChartinkStock({ nse_script_code: "RELIANCE", close: 2480, pChange: 1.5 }),
          ]);
        }
        if (fetchCallCount === 2) {
          return makeChartinkResponse([
            makeChartinkStock({ nse_script_code: "RELIANCE", close: 2500, pChange: 2.0 }),
          ]);
        }
        return makeChartinkResponse([]);
      }) as never;

      const results = await runDailyScreeners({ forceRefresh: true });
      const reliance = results.find((r) => r.symbol === "RELIANCE");
      expect(reliance!.price).toBe(2500);
    });

    test("normalizes symbol to uppercase", async () => {
      let fetchCallCount = 0;
      global.fetch = jest.fn(async () => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          return makeChartinkResponse([
            makeChartinkStock({ nse_script_code: "reliance", close: 2500, pChange: 2.0 }),
          ]);
        }
        return makeChartinkResponse([]);
      }) as never;

      const results = await runDailyScreeners({ forceRefresh: true });
      expect(results[0].symbol).toBe("RELIANCE");
    });

    test("skips stocks with empty nse_script_code", async () => {
      let fetchCallCount = 0;
      global.fetch = jest.fn(async () => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          return makeChartinkResponse([
            makeChartinkStock({ nse_script_code: "", close: 2500 }),
            makeChartinkStock({ nse_script_code: "RELIANCE", close: 2500, pChange: 2.0 }),
          ]);
        }
        return makeChartinkResponse([]);
      }) as never;

      const results = await runDailyScreeners({ forceRefresh: true });
      expect(results.find((r) => r.symbol === "")).toBeUndefined();
      expect(results.find((r) => r.symbol === "RELIANCE")).toBeDefined();
    });

    test("caches results after successful run", async () => {
      global.fetch = jest.fn(async () => makeChartinkResponse([])) as never;

      await runDailyScreeners({ forceRefresh: true });
      expect(staticCache.set).toHaveBeenCalledWith(
        "daily-recommendations:screener-results",
        expect.any(Array),
        300,
      );
    });
  });

  // ── runSingleScreener ─────────────────────────────────────────────────

  describe("runSingleScreener", () => {
    test("throws for unknown screener ID", async () => {
      await expect(runSingleScreener("nonexistent")).rejects.toThrow(
        "Unknown screener: nonexistent",
      );
    });

    test("runs a single screener successfully via Chartink", async () => {
      global.fetch = jest.fn(async () => makeChartinkResponse([
        makeChartinkStock({ nse_script_code: "SBIN", close: 800, pChange: 3.1, volume: 2000000 }),
      ])) as never;

      const results = await runSingleScreener("short_term_breakouts");
      expect(results.length).toBe(1);
      expect(results[0].symbol).toBe("SBIN");
      expect(results[0].screenerNames).toContain("Short Term Breakouts");
    });

    test("returns empty array when screener finds nothing", async () => {
      global.fetch = jest.fn(async () => makeChartinkResponse([])) as never;

      const results = await runSingleScreener("short_term_breakouts");
      expect(results).toEqual([]);
    });

    test("falls back to TradingView for single screener", async () => {
      global.fetch = jest.fn(async () => { throw new Error("Chartink down"); }) as never;

      advancedScan.mockResolvedValue([
        makeTVRow({ symbol: "NSE:INFY", name: "Infosys", close: 1600 }),
      ]);

      const results = await runSingleScreener("rsi_overbought_oversold");
      expect(advancedScan).toHaveBeenCalled();
      expect(results.length).toBe(1);
      expect(results[0].symbol).toBe("INFY");
    });
  });

  // ── TradingView mapping ──────────────────────────────────────────────

  describe("TradingView row mapping", () => {
    test("maps TradingView rows to ChartinkStock shape", async () => {
      global.fetch = jest.fn(async () => { throw new Error("Chartink down"); }) as never;

      advancedScan.mockResolvedValue([
        makeTVRow({ symbol: "NSE:RELIANCE", name: "Reliance Industries", close: 2500, change: 50, change_percent: 2.04, volume: 1000000 }),
      ]);

      const results = await runSingleScreener("short_term_breakouts");
      expect(results.length).toBe(1);
      expect(results[0].symbol).toBe("RELIANCE");
      expect(results[0].price).toBe(2500);
      expect(results[0].volume).toBe(1000000);
    });

    test("handles TradingView symbol without colon prefix", async () => {
      global.fetch = jest.fn(async () => { throw new Error("Chartink down"); }) as never;

      advancedScan.mockResolvedValue([
        makeTVRow({ symbol: "RELIANCE", name: "Reliance" }),
      ]);

      const results = await runSingleScreener("short_term_breakouts");
      expect(results[0].symbol).toBe("RELIANCE");
    });

    test("uses description fallback when name is missing", async () => {
      global.fetch = jest.fn(async () => { throw new Error("Chartink down"); }) as never;

      advancedScan.mockResolvedValue([
        makeTVRow({ symbol: "NSE:TCS", name: undefined, description: "Tata Consultancy" }),
      ]);

      const results = await runSingleScreener("short_term_breakouts");
      expect(results[0].name).toBe("Tata Consultancy");
    });
  });

  // ── Chartink response formats ─────────────────────────────────────────

  describe("Chartink response parsing", () => {
    test("handles DataTables format with recordsTotal", async () => {
      global.fetch = jest.fn(async () => ({
        ok: true,
        json: () => Promise.resolve({ data: [makeChartinkStock({ nse_script_code: "ITC" })], recordsTotal: 1 }),
      } as Response)) as never;

      const results = await runSingleScreener("short_term_breakouts");
      expect(results.length).toBe(1);
    });

    test("falls back to TradingView when Chartink returns non-array data", async () => {
      global.fetch = jest.fn(async () => ({
        ok: true,
        json: () => Promise.resolve({ data: "unexpected" }),
      } as Response)) as never;

      const results = await runSingleScreener("short_term_breakouts");
      expect(results).toEqual([]);
    });

    test("falls back to TradingView on Chartink HTTP error", async () => {
      global.fetch = jest.fn(async () => ({ ok: false, status: 403 } as Response)) as never;

      const results = await runSingleScreener("short_term_breakouts");
      expect(results).toEqual([]);
    });
  });
});
