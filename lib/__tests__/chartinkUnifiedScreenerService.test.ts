/**
 * Tests for chartinkUnifiedScreenerService — the Chartink-primary runner.
 *
 * Covers:
 *  - resolveTvFallback (curated map → name match → category default → null)
 *  - runChartinkUnifiedScreeners source chain:
 *      chartink_db (fresh captured rows win) → chartink_live (scanClause) →
 *      tradingview (single shared universe scan for catalog-only templates)
 *  - source/templateIds attribution + de-dup merge
 *  - runChartinkScreenerById single-template run
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

jest.mock("@/lib/services/chartinkTemplates", () => {
  const templates = [
    {
      id: "fundamental.profit-jump-by-200",
      name: "Profit Jump by 200%",
      url: "https://chartink.com/scanner/profit-jump-by-200",
      categoryId: "fundamental",
      scanClause: "profit-jump-by-200",
      columnClause: "price > 10",
    },
    {
      id: "top-loved.short-term-breakouts",
      name: "Short term breakouts",
      url: "https://chartink.com/scanner/short-term-breakouts",
      categoryId: "top-loved",
    },
    {
      id: "top-loved.strong-stocks",
      name: "Strong stocks",
      url: "https://chartink.com/scanner/strong-stocks",
      categoryId: "top-loved",
    },
    {
      id: "bearish.custom-bearish-scan",
      name: "Custom bearish scan",
      url: "https://chartink.com/scanner/custom-bearish-scan",
      categoryId: "bearish",
    },
  ];
  return {
    __esModule: true,
    getChartinkCategories: () => [
      { id: "fundamental", name: "Fundamental Scans", count: 1, fetchableCount: 1 },
      { id: "top-loved", name: "Top Loved", count: 2, fetchableCount: 0 },
      { id: "bearish", name: "Bearish Scan", count: 1, fetchableCount: 0 },
    ],
    getChartinkTemplates: (categoryId?: string) =>
      categoryId ? templates.filter((t) => t.categoryId === categoryId) : [...templates],
    getChartinkTemplate: (id: string) => templates.find((t) => t.id === id) || undefined,
    registerChartinkTemplate: jest.fn(),
  };
});

jest.mock("@/lib/services/chartinkScanService", () => {
  const fetchChartinkScan = jest.fn();
  return { __esModule: true, fetchChartinkScan };
});

jest.mock("@/lib/services/chartinkScreenerService", () => ({
  __esModule: true,
  getChartinkScreeners: jest.fn(async () => []),
  getChartinkScreenerResults: jest.fn(async () => []),
}));

jest.mock("@/lib/services/tradingview-service", () => ({
  __esModule: true,
  advancedScan: jest.fn(async () => []),
}));

// ─── Imports (after mocks — real screener-templates for fallback resolver) ─

import {
  runChartinkUnifiedScreeners,
  runChartinkScreenerById,
  resolveTvFallback,
} from "@/lib/services/chartinkUnifiedScreenerService";
import { fetchChartinkScan } from "@/lib/services/chartinkScanService";
import {
  getChartinkScreeners,
  getChartinkScreenerResults,
} from "@/lib/services/chartinkScreenerService";
import { advancedScan } from "@/lib/services/tradingview-service";
import { staticCache } from "@/lib/cache";

// ─── Typed mock helpers ─────────────────────────────────────────────────

const mockedFetchScan = fetchChartinkScan as jest.Mock;
const mockedAdvancedScan = advancedScan as jest.Mock;
const mockedDbOverview = getChartinkScreeners as jest.Mock;
const mockedDbRows = getChartinkScreenerResults as jest.Mock;
const mockedCache = staticCache as jest.Mocked<typeof staticCache>;

// ─── Fixtures ───────────────────────────────────────────────────────────

const dbRow = (symbol: string, close = 100) => ({
  symbol,
  name: `${symbol} Ltd.`,
  close,
  changePercent: 2.5,
  volume: 100000,
  raw: {},
});

const scanStock = (symbol: string, close = 100) => ({
  symbol,
  name: `${symbol} Ltd.`,
  close,
  changePercent: 1.5,
  volume: 50000,
  raw: {},
});

// ─── Tests ──────────────────────────────────────────────────────────────

describe("resolveTvFallback", () => {
  test("curated map: top-loved.short-term-breakouts → TV 'Short Term Breakouts'", () => {
    const tv = resolveTvFallback({
      id: "top-loved.short-term-breakouts",
      name: "Short term breakouts",
      url: "x",
      categoryId: "top-loved",
    });
    expect(tv?.name).toBe("Short Term Breakouts");
  });

  test("curated map: strong-stocks → TV 'Bullish Momentum Stocks'", () => {
    const tv = resolveTvFallback({
      id: "top-loved.strong-stocks",
      name: "Strong stocks",
      url: "x",
      categoryId: "top-loved",
    });
    expect(tv?.name).toBe("Bullish Momentum Stocks");
  });

  test("name token match: 'Profit Jump by 200%' → TV 'Profit Jump 200%'", () => {
    const tv = resolveTvFallback({
      id: "fundamental.profit-jump-by-200",
      name: "Profit Jump by 200%",
      url: "x",
      categoryId: "fundamental",
    });
    expect(tv?.name).toBe("Profit Jump 200%");
  });

  test("category default: unknown bearish template → a bearish TV template", () => {
    const tv = resolveTvFallback({
      id: "bearish.custom-bearish-scan",
      name: "Custom bearish scan",
      url: "x",
      categoryId: "bearish",
    });
    expect(tv).not.toBeNull();
    expect(tv?.category).toBe("bearish");
  });

  test("unknown category without a match → null", () => {
    const tv = resolveTvFallback({
      id: "mystery.foo",
      name: "Qqqq Xyzzy Abc Def",
      url: "x",
      categoryId: "does-not-exist",
    });
    expect(tv).toBeNull();
  });
});

describe("runChartinkUnifiedScreeners", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCache.get.mockReturnValue(null);
    mockedDbOverview.mockResolvedValue([]);
    mockedDbRows.mockResolvedValue([]);
    mockedFetchScan.mockResolvedValue({ stocks: [], recordsTotal: 0 });
    mockedAdvancedScan.mockResolvedValue([]);
  });

  test("uses fresh captured DB rows (chartink_db) without network calls", async () => {
    // ADB2.. have fresh captured rows; ADB1 does too
    mockedDbOverview.mockResolvedValue([
      { id: "fundamental.profit-jump-by-200", resultCount: 3, stale: false },
      { id: "top-loved.short-term-breakouts", resultCount: 0, stale: true },
      { id: "top-loved.strong-stocks", resultCount: 0, stale: true },
      { id: "bearish.custom-bearish-scan", resultCount: 0, stale: true },
    ]);
    mockedDbRows.mockImplementation(async (id: string) =>
      id === "fundamental.profit-jump-by-200" ? [dbRow("FUNDA"), dbRow("FUNDB"), dbRow("FUNDC")] : [],
    );

    const results = await runChartinkUnifiedScreeners({
      templateIds: ["fundamental.profit-jump-by-200"],
    });

    expect(results.map((r) => r.symbol)).toEqual(["FUNDA", "FUNDB", "FUNDC"]);
    expect(results.every((r) => r.source === "chartink_db")).toBe(true);
    // Fresh DB rows short-circuit the chain — no live fetch, no TV scan
    expect(mockedFetchScan).not.toHaveBeenCalled();
    expect(mockedAdvancedScan).not.toHaveBeenCalled();
  });

  test("prefers chartink_db over chartink_live when both available", async () => {
    mockedDbOverview.mockResolvedValue([
      { id: "fundamental.profit-jump-by-200", resultCount: 1, stale: false },
    ]);
    mockedDbRows.mockResolvedValue([dbRow("DBONLY")]);
    mockedFetchScan.mockResolvedValue({ stocks: [scanStock("LIVEONLY"), scanStock("BOTH")], recordsTotal: 2 });

    const results = await runChartinkUnifiedScreeners();
    expect(results.map((r) => r.symbol)).toContain("DBONLY");
    // Live fetch should NOT have been called because DB rows were fresh
    expect(mockedFetchScan).not.toHaveBeenCalled();
  });

  test("fallback to live Chartink fetch (chartink_live) for clause templates without DB rows", async () => {
    mockedDbOverview.mockResolvedValue([
      { id: "fundamental.profit-jump-by-200", resultCount: 0, stale: true },
    ]);
    mockedFetchScan.mockResolvedValue({
      stocks: [scanStock("LIVE1"), scanStock("LIVE2")],
      recordsTotal: 2,
    });

    const results = await runChartinkUnifiedScreeners();

    expect(mockedFetchScan).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.symbol)).toEqual(["LIVE1", "LIVE2"]);
    expect(results.every((r) => r.source === "chartink_live")).toBe(true);
    expect(results.every((r) => r.templateIds.includes("fundamental.profit-jump-by-200"))).toBe(true);
  });

  test("catalog-only templates use ONE shared TV universe scan (tradingview source)", async () => {
    mockedDbOverview.mockResolvedValue([]);
    // TV universe: rows carry the fields the resolved filter groups need
    // (Short Term Breakouts → change>0, relative_volume_10d_calc>1, Perf.5D>3;
    //  Bullish Momentum → change>2, relative_volume_10d_calc>1.2)
    mockedAdvancedScan.mockResolvedValue([
      { symbol: "NSE:TVSHORT", name: "TVSHORT Ltd.", close: 120, change: 4, volume: 80000, market_cap_basic: 1e9, relative_volume_10d_calc: 2, "Perf.5D": 5 },
      { symbol: "NSE:TVSTRONG", name: "TVSTRONG Ltd.", close: 90, change: 6, volume: 50000, market_cap_basic: 5e8, relative_volume_10d_calc: 1.5 },
      { symbol: "NSE:TVBEAR", name: "TVBEAR Ltd.", close: 60, change: -3, volume: 30000, market_cap_basic: 2e8 },
    ]);

    const results = await runChartinkUnifiedScreeners();

    // All 3 catalog-only templates resolved to TV fallbacks
    expect(mockedAdvancedScan).toHaveBeenCalledTimes(1); // ONE shared scan
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.source === "tradingview")).toBe(true);
    // Screeners attribution: each result should carry its template's name
    expect(results.some((r) => r.screenerNames.includes("Short term breakouts"))).toBe(true);
  });

  test("merges a stock flagged by multiple templates with dedup + templateIds", async () => {
    mockedDbOverview.mockResolvedValue([]);
    mockedAdvancedScan.mockResolvedValue([
      { symbol: "NSE:OVERLAP", name: "OVERLAP Ltd.", close: 100, change: 5, volume: 70000, market_cap_basic: 1e9, relative_volume_10d_calc: 3, "Perf.5D": 5 },
    ]);

    const results = await runChartinkUnifiedScreeners();
    const overlap = results.find((r) => r.symbol === "OVERLAP");
    expect(overlap).toBeDefined();
    // top-loved.short-term-breakouts + strong-stocks both fall back to TV;
    // if they produced overlapping stock sets, dedup keeps one row with 2 sources
    expect(overlap!.screenerCount).toBeGreaterThanOrEqual(1);
    expect(overlap!.templateIds.length).toBeGreaterThanOrEqual(1);
  });

  test("caches results (no forceRefresh → cache hit)", async () => {
    const cached = [{ symbol: "CACHED", source: "chartink_db", templateIds: ["x"] }];
    mockedCache.get.mockReturnValue(cached);

    const results = await runChartinkUnifiedScreeners();
    expect(results).toEqual(cached);
    expect(mockedDbOverview).not.toHaveBeenCalled();
  });

  test("cache key is scope-aware (swing run never shares the full-run cache)", async () => {
    // A templateId-scoped run writes to its own key...
    mockedCache.get.mockReturnValue(null);
    mockedDbOverview.mockResolvedValue([]);
    await runChartinkUnifiedScreeners({ templateIds: ["fundamental.profit-jump-by-200", "top-loved.short-term-breakouts"] });
    expect((mockedCache.set as jest.Mock).mock.calls.at(-1)![0]).toBe(
      "chartink-unified:t:fundamental.profit-jump-by-200,top-loved.short-term-breakouts",
    );

    // ...and a later scoped run reads the SAME scoped key...
    const scopedOnly = [{ symbol: "SWING_ONLY", source: "chartink_db", templateIds: ["fundamental.profit-jump-by-200"] }];
    mockedCache.get.mockReturnValue(scopedOnly);
    const hit = await runChartinkUnifiedScreeners({ templateIds: ["fundamental.profit-jump-by-200", "top-loved.short-term-breakouts"] });
    expect(hit).toEqual(scopedOnly);

    // ...while the full (unscoped) run misses on that scoped key and runs the pipeline.
    mockedCache.get.mockReturnValue(null);
    mockedDbOverview.mockResolvedValue([]);
    await runChartinkUnifiedScreeners();
    expect(mockedDbOverview).toHaveBeenCalled();
  });

  test("forceRefresh bypasses cache and runs the pipeline", async () => {
    mockedCache.get.mockReturnValue([{ symbol: "OLD", source: "chartink_db", templateIds: ["x"] }]);
    mockedDbOverview.mockResolvedValue([]);

    const results = await runChartinkUnifiedScreeners({ forceRefresh: true });
    expect(mockedDbOverview).toHaveBeenCalled();
    expect(results.some((r) => r.symbol === "OLD")).toBe(false);
  });

  test("respects templateIds filter", async () => {
    mockedDbOverview.mockResolvedValue([
      { id: "fundamental.profit-jump-by-200", resultCount: 1, stale: false },
    ]);
    mockedDbRows.mockImplementation(async (id: string) =>
      id === "fundamental.profit-jump-by-200" ? [dbRow("ONLYME")] : [],
    );

    const results = await runChartinkUnifiedScreeners({
      templateIds: ["fundamental.profit-jump-by-200"],
    });
    expect(results.map((r) => r.symbol)).toEqual(["ONLYME"]);
  });
});

describe("runChartinkScreenerById", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCache.get.mockReturnValue(null);
    mockedDbOverview.mockResolvedValue([]);
    mockedDbRows.mockResolvedValue([]);
    mockedFetchScan.mockResolvedValue({ stocks: [], recordsTotal: 0 });
    mockedAdvancedScan.mockResolvedValue([]);
  });

  test("throws for unknown template", async () => {
    await expect(runChartinkScreenerById("missing.template")).rejects.toThrow(
      "Unknown Chartink template: missing.template",
    );
  });

  test("returns fresh DB rows first", async () => {
    mockedDbOverview.mockResolvedValue([
      { id: "fundamental.profit-jump-by-200", resultCount: 2, stale: false },
    ]);
    mockedDbRows.mockResolvedValue([dbRow("ONE"), dbRow("TWO")]);

    const out = await runChartinkScreenerById("fundamental.profit-jump-by-200");
    expect(out.source).toBe("chartink_db");
    expect(out.stocks.map((s) => s.nse_script_code)).toEqual(["ONE", "TWO"]);
    expect(mockedFetchScan).not.toHaveBeenCalled();
  });

  test("runs live Chartink fetch when no DB rows", async () => {
    mockedDbOverview.mockResolvedValue([]);
    mockedFetchScan.mockResolvedValue({ stocks: [scanStock("LIVE1")], recordsTotal: 1 });

    const out = await runChartinkScreenerById("fundamental.profit-jump-by-200");
    expect(out.source).toBe("chartink_live");
    expect(out.stocks[0].nse_script_code).toBe("LIVE1");
  });

  test("falls back to TV after a live fetch failure", async () => {
    mockedDbOverview.mockResolvedValue([]);
    mockedFetchScan.mockRejectedValue(new Error("Chartink HTTP 500"));
    mockedAdvancedScan.mockResolvedValue([
      { symbol: "NSE:TVFALL", name: "TVFALL Ltd.", close: 99, change: 3, volume: 40000, market_cap_basic: 1e8, return_on_equity_fq: 25 },
    ]);

    const out = await runChartinkScreenerById("fundamental.profit-jump-by-200");
    expect(out.source).toBe("tradingview");
    expect(out.stocks[0].nse_script_code).toBe("TVFALL");
  });

  test("TV fallback for catalog-only template (no scanClause)", async () => {
    mockedDbOverview.mockResolvedValue([]);
    mockedAdvancedScan.mockResolvedValue([
      { symbol: "NSE:SHORT", name: "SHORT Ltd.", close: 110, change: 7, volume: 90000, market_cap_basic: 2e9 },
    ]);

    const out = await runChartinkScreenerById("top-loved.short-term-breakouts");
    expect(out.source).toBe("tradingview");
    // No live fetch attempted (no clause)
    expect(mockedFetchScan).not.toHaveBeenCalled();
  });
});