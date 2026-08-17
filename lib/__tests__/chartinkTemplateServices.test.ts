/**
 * Tests for chartinkTemplates + chartinkScanService + chartinkBacktestService.
 *
 * Fixtures mirror the REAL responses captured from chartink.com (2026-08-11):
 *  - /screener/process DataTables shape (recordsTotal/recordsFiltered/data/link)
 *  - /backtest/process shape (metaData/aggregatedStockList/groupData/time/baseTime/link)
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

// ─── Imports ──────────────────────────────────────────────────────────────

import {
  getChartinkTemplates,
  getChartinkTemplate,
  registerChartinkTemplate,
} from "@/lib/services/chartinkTemplates";
import {
  fetchChartinkScan,
  runChartinkScanById,
  type ChartinkScanResponse,
} from "@/lib/services/chartinkScanService";
import {
  fetchChartinkBacktest,
  runChartinkBacktestById,
  type ChartinkBacktestResponse,
} from "@/lib/services/chartinkBacktestService";

// ─── Fixtures (captured from chartink.com 2026-08-11) ─────────────────────

const SCAN_LINK = "scanlink:2b8d4c5b0b06fa288b9bf08a3487f52b";

/** /screener/process response for profit-jump-by-200 (trimmed rows). */
const scanResponse: ChartinkScanResponse = {
  draw: 1,
  recordsTotal: 154,
  recordsFiltered: 154,
  data: [
    {
      sr: 1,
      nsecode: "TIJARIA",
      name: "Tijaria Polypipes Ltd.",
      bsecode: "538629",
      "scan-column-default-close": 14.506,
      "scan-column-default-percent-change": 15.913,
      "default-percent-change-conditional-filters-color": 1,
      "scan-column-default-volume": 904350,
    },
    {
      sr: 2,
      nsecode: "SANWARIA",
      name: "Sanwaria Consumer Ltd.",
      bsecode: "538571",
      "scan-column-default-close": 2.75,
      "scan-column-default-percent-change": -4.51,
      "default-percent-change-conditional-filters-color": 2,
      "scan-column-default-volume": 1200450,
    },
    {
      sr: 3,
      nsecode: "KALYANI",
      name: "Kalyani Steels Ltd.",
      bsecode: "513029",
      "scan-column-default-close": 128.5,
      "scan-column-default-percent-change": 2.13,
      "default-percent-change-conditional-filters-color": 1,
      "scan-column-default-volume": 18320,
    },
  ],
  link: SCAN_LINK,
};

/** /backtest/process response — trimmed buckets but real structure. */
const backtestResponse: ChartinkBacktestResponse = {
  metaData: {
    columnAliases: {
      "groupcount( 1 where yearly net profit/reported profit after tax > 1 year ago net profit/reported profit after tax * 2)": "count_a",
    },
    availableLimit: 26,
    maxRows: 160,
    isTrend: true,
    limit: 100,
    groups: ["AUTO", "BANK", "REALTY"],
    tradeTimes: [
      1752733800000, 1752820200000, 1752906600000, 1752993000000,
      1753079400000, 1753165800000, 1753252200000,
    ],
    lastUpdateTime: 1754734026000,
  },
  // 7 buckets: first 4 empty, then stocks appear progressively
  aggregatedStockList: [
    [],
    [],
    [],
    [],
    [["TIJARIA", "S", "REALTY"], ["KALYANI", "L", "AUTO"]],
    [["TIJARIA", "S", "REALTY"], ["KALYANI", "L", "AUTO"]],
    [["TIJARIA", "S", "REALTY"], ["KALYANI", "L", "AUTO"], ["SANWARIA", "S", "BANK"]],
  ],
  groupData: [
    {
      name: "AUTO",
      results: [{ "groupcount( 1 where ... * 2)": [0, 0, 0, 0, 1, 1, 1] }],
    },
    {
      name: "BANK",
      results: [{ "groupcount( 1 where ... * 2)": [0, 0, 0, 0, 0, 0, 1] }],
    },
    {
      name: "REALTY",
      results: [{ "groupcount( 1 where ... * 2)": [0, 0, 0, 0, 1, 1, 1] }],
    },
  ],
  time: 49,
  baseTime: 33,
  link: SCAN_LINK,
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeResponse(body: unknown): Response {
  return { ok: true, json: () => Promise.resolve(body) } as Response;
}

// ─── Template registry tests ──────────────────────────────────────────────

describe("chartinkTemplates", () => {
  test("registers the profit_jump_by_200 template", () => {
    const templates = getChartinkTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(1);
    const t = templates.find((x) => x.id === "fundamental.profit-jump-by-200");
    expect(t).toBeDefined();
  });

  test("template carries the real scan_clause DSL", () => {
    const t = getChartinkTemplate("fundamental.profit-jump-by-200")!;
    expect(t.scanClause).toContain("yearly net profit/reported profit after tax >");
    expect(t.scanClause).toContain("* 2");
    expect(t.debugClause).toContain("groupcount(");
    expect(t.columnClause).toContain("scan-column-default-close");
    expect(t.backtestMaxRows).toBe(160);
    expect(t.url).toBe("https://chartink.com/scanner/profit-jump-by-200");
  });

  test("getChartinkTemplate returns undefined for unknown id", () => {
    expect(getChartinkTemplate("nope")).toBeUndefined();
  });

  test("registerChartinkTemplate adds and overwrites", () => {
const custom = {
      id: "custom_test",
      name: "Custom",
      url: "https://chartink.com/scanner/custom_test",
      categoryId: "custom",
      scanClause: "( {cash} ( close > 100 ) )",
    };
    registerChartinkTemplate(custom);
    expect(getChartinkTemplate("custom_test")?.name).toBe("Custom");

    // Overwrite same id
    registerChartinkTemplate({ ...custom, name: "Custom v2" });
    expect(getChartinkTemplate("custom_test")?.name).toBe("Custom v2");
  });
});

// ─── Scan service tests ───────────────────────────────────────────────────

describe("chartinkScanService", () => {
  let savedFetch: typeof global.fetch;

  beforeEach(() => {
    savedFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = savedFetch;
  });

  test("parses DataTables scan response into normalised stocks", async () => {
    global.fetch = jest.fn(async () => makeResponse(scanResponse)) as never;

    const result = await runChartinkScanById("fundamental.profit-jump-by-200");
    expect(result.templateId).toBe("fundamental.profit-jump-by-200");
    expect(result.recordsTotal).toBe(154);
    expect(result.link).toBe(SCAN_LINK);
    expect(result.stocks).toHaveLength(3);

    const tjaria = result.stocks.find((s) => s.symbol === "TIJARIA")!;
    expect(tjaria.name).toBe("Tijaria Polypipes Ltd.");
    expect(tjaria.close).toBeCloseTo(14.506);
    expect(tjaria.changePercent).toBeCloseTo(15.913);
    expect(tjaria.conditionFlag).toBe(1);
    expect(tjaria.bsecode).toBe("538629");

    const sanwaria = result.stocks.find((s) => s.symbol === "SANWARIA")!;
    expect(sanwaria.conditionFlag).toBe(2);
    expect(sanwaria.changePercent).toBeCloseTo(-4.51);
  });

  test("sends the native scan_clause + debug_clause + column_clause body", async () => {
    const fetchMock = jest.fn(async () => makeResponse(scanResponse));
    global.fetch = fetchMock as never;

    await runChartinkScanById("fundamental.profit-jump-by-200");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://chartink.com/screener/process");

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body["scan_clause"]).toContain("{cash}");
    expect(body["debug_clause"]).toContain("groupcount(");
    expect(body["column_clause"]).toContain("scan-column-default-close");
  });

  test("skips rows without nsecode", async () => {
    const withBad = {
      ...scanResponse,
      data: [
        ...scanResponse.data,
        { sr: 99, name: "No Code", "scan-column-default-close": 10 },
      ],
    };
    global.fetch = jest.fn(async () => makeResponse(withBad)) as never;

    const result = await runChartinkScanById("fundamental.profit-jump-by-200");
    expect(result.stocks).toHaveLength(3);
  });

  test("handles empty data array (recordsTotal preserved)", async () => {
    global.fetch = jest.fn(async () =>
      makeResponse({ draw: 1, recordsTotal: 0, recordsFiltered: 0, data: [], link: SCAN_LINK }),
    ) as never;

    const result = await runChartinkScanById("fundamental.profit-jump-by-200");
    expect(result.stocks).toEqual([]);
    expect(result.recordsTotal).toBe(0);
  });

  test("throws on Chartink HTTP error", async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 403 } as Response)) as never;

    await expect(runChartinkScanById("fundamental.profit-jump-by-200")).rejects.toThrow(
      "Chartink scan HTTP 403",
    );
  });

  test("throws for unknown template id", async () => {
    await expect(runChartinkScanById("missing_template")).rejects.toThrow(
      "Unknown Chartink template: missing_template",
    );
  });

  test("fetchChartinkScan accepts a template object directly", async () => {
    global.fetch = jest.fn(async () => makeResponse(scanResponse)) as never;

    const t = getChartinkTemplate("fundamental.profit-jump-by-200")!;
    const result = await fetchChartinkScan(t);
    expect(result.templateName).toBe("Profit jump by 200%");
    expect(result.stocks.length).toBeGreaterThan(0);
  });

  test("throws for templates without scan_clause (catalog-only guard)", async () => {
    global.fetch = jest.fn(async () => makeResponse(scanResponse)) as never;

    // Use a mock template object with no scanClause — the function must still
    // guard against this even though all real templates now have a clause after
    // the v3.14.0 capture pass.
    const noClause = {
      id: "test.no-clause-template",
      name: "No clause template",
      url: "https://chartink.com/scanner/no-clause",
      categoryId: "fundamental",
    };
    await expect(fetchChartinkScan(noClause)).rejects.toThrow(
      "no scan_clause yet (catalog-only)",
    );
  });
});

// ─── Backtest service tests ───────────────────────────────────────────────

describe("chartinkBacktestService", () => {
  let savedFetch: typeof global.fetch;

  beforeEach(() => {
    savedFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = savedFetch;
  });

  test("parses backtest response: tradeTimes, timeSeries, groupSeries", async () => {
    global.fetch = jest.fn(async () => makeResponse(backtestResponse)) as never;

    const result = await runChartinkBacktestById("fundamental.profit-jump-by-200");
    expect(result.templateId).toBe("fundamental.profit-jump-by-200");
    expect(result.tradeTimes).toHaveLength(7);
    expect(result.timeSeries).toHaveLength(7);

    // Empty buckets stay empty
    expect(result.timeSeries[0]).toEqual([]);
    expect(result.timeSeries[4]).toHaveLength(2);

    // Total distinct stocks + current bucket
    expect(result.totalStocks).toBe(3);
    expect(result.currentStocks).toHaveLength(3);
    expect(result.currentStocks.map((s) => s.symbol)).toEqual(
      expect.arrayContaining(["TIJARIA", "KALYANI", "SANWARIA"]),
    );

    // Sector + capClass preserved
    const kalyani = result.currentStocks.find((s) => s.symbol === "KALYANI")!;
    expect(kalyani.sector).toBe("AUTO");
    expect(kalyani.capClass).toBe("L");

    // Groups + per-sector series align with tradeTimes
    expect(result.groups).toEqual(["AUTO", "BANK", "REALTY"]);
    expect(result.groupSeries).toHaveLength(3);
    const auto = result.groupSeries.find((g) => g.name === "AUTO")!;
    expect(auto.counts).toEqual([0, 0, 0, 0, 1, 1, 1]);
  });

  test("sends scan_clause + max_rows (string) to /backtest/process", async () => {
    const fetchMock = jest.fn(async () => makeResponse(backtestResponse));
    global.fetch = fetchMock as never;

    await runChartinkBacktestById("fundamental.profit-jump-by-200");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://chartink.com/backtest/process");

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body["scan_clause"]).toContain("{cash}");
    expect(body["max_rows"]).toBe("160");
  });

  test("handles empty buckets and missing groupData gracefully", async () => {
    const sparse: ChartinkBacktestResponse = {
      metaData: {
        groups: ["AUTO"],
        tradeTimes: [1, 2, 3],
      },
      aggregatedStockList: [[], [["TCS", "L", "AUTO"]], []],
      groupData: [],
    };
    global.fetch = jest.fn(async () => makeResponse(sparse)) as never;

    const result = await runChartinkBacktestById("fundamental.profit-jump-by-200");
    expect(result.timeSeries).toHaveLength(3);
    expect(result.currentStocks).toEqual([]);
    expect(result.groupSeries).toEqual([]);
    expect(result.totalStocks).toBe(1);
  });

  test("truncates over-long timeSeries to tradeTimes length", async () => {
    const weird: ChartinkBacktestResponse = {
      metaData: { groups: [], tradeTimes: [1, 2] },
      aggregatedStockList: [[["A", "S", "X"]], [], [["B", "S", "X"]]],
      groupData: [],
    };
    global.fetch = jest.fn(async () => makeResponse(weird)) as never;

    const result = await runChartinkBacktestById("fundamental.profit-jump-by-200");
    expect(result.timeSeries).toHaveLength(2);
  });

  test("throws on Chartink HTTP error", async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500 } as Response)) as never;

    await expect(runChartinkBacktestById("fundamental.profit-jump-by-200")).rejects.toThrow(
      "Chartink backtest HTTP 500",
    );
  });

  test("throws for unknown template id", async () => {
    await expect(runChartinkBacktestById("missing_template")).rejects.toThrow(
      "Unknown Chartink template: missing_template",
    );
  });

  test("throws for catalog-only templates without scan_clause", async () => {
    global.fetch = jest.fn(async () => makeResponse(backtestResponse)) as never;

    const catalogOnly = {
      id: "fundamental.mid-cap-stocks",
      name: "Mid cap stocks",
      url: "https://chartink.com/scanner/mid-cap-stocks",
      categoryId: "fundamental",
    };
    await expect(fetchChartinkBacktest(catalogOnly)).rejects.toThrow(
      "no scan_clause yet (catalog-only)",
    );
  });
});