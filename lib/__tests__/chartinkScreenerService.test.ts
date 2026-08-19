/**
 * Tests for chartinkScreenerService (v3.5.5).
 *
 * Covers the full-run lifecycle (clean table → re-insert whole dataset),
 * the 72h TTL (expiresAt) semantics, definition upserts, normalization of
 * captured rows, and the stale/never-run read flags.
 */

// ─── Mocks (MUST be before any imports — SWC hoists jest.mock) ─────────

jest.mock("@/lib/logger", () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { __esModule: true, default: mock, info: mock.info, warn: mock.warn, error: mock.error, debug: mock.debug };
});

jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    chartinkScreener: {
      upsert: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    chartinkScreenerRun: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    chartinkScreenerResult: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────

import prisma from "@/lib/prisma";
import {
  normalizeCapturedRows,
  upsertChartinkScreener,
  startChartinkRun,
  insertChartinkRunResults,
  completeChartinkTemplateRun,
  failChartinkRun,
  completeChartinkRun,
  clearChartinkResults,
  pruneExpiredChartinkResults,
  getChartinkScreeners,
  getChartinkScreenerResults,
  runFullChartinkSync,
  CHARTINK_SCREENER_TTL_HOURS,
  type ChartinkCapturedRow,
} from "@/lib/services/chartinkScreenerService";

/** Typed shape of the mocked prisma delegates this service touches. */
interface MockChartinkDb {
  chartinkScreener: {
    upsert: jest.Mock;
    update: jest.Mock;
    findMany: jest.Mock;
  };
  chartinkScreenerRun: {
    create: jest.Mock;
    update: jest.Mock;
    findMany: jest.Mock;
  };
  chartinkScreenerResult: {
    createMany: jest.Mock;
    deleteMany: jest.Mock;
    findMany: jest.Mock;
  };
}

const mockPrisma = prisma as unknown as MockChartinkDb;

// ─── Fixtures ─────────────────────────────────────────────────────────────

const templateProfitJump = {
  id: "fundamental.profit-jump-by-200",
  name: "Profit jump by 200%",
  url: "https://chartink.com/scanner/profit-jump-by-200",
  categoryId: "fundamental",
  scanClause: "( {cash} ( yearly net profit/reported profit after tax > ... ) )",
};

/** Wire-format rows as captured from /screener/process (aliases). */
const wireRows: Array<Record<string, unknown>> = [
  {
    sr: 1,
    nsecode: "TIJARIA",
    name: "Tijaria Polypipes Ltd.",
    bsecode: "538629",
    "scan-column-default-close": 14.506,
    "scan-column-default-percent-change": 15.913,
    "default-percent-change-conditional-filters-color": 1,
    "scan-column-default-volume": 2482221,
    extra: "kept",
  },
  {
    sr: 2,
    nsecode: "", // OTC/inactive — must be dropped
    name: "No NSE code",
  },
  {
    sr: 3,
    nsecode: "RELCAPITAL",
    name: "Reliance Capital Ltd.",
    bsecode: "541493",
    "scan-column-default-close": 11.19,
    "scan-column-default-percent-change": -4.85,
    "default-percent-change-conditional-filters-color": 2,
  },
];

const capturedRows: ChartinkCapturedRow[] = [
  {
    symbol: "TIJARIA",
    name: "Tijaria Polypipes Ltd.",
    bsecode: "538629",
    close: 14.506,
    changePercent: 15.913,
    volume: 2482221,
    conditionFlag: 1,
    raw: wireRows[0],
  },
  {
    symbol: "RELCAPITAL",
    name: "Reliance Capital Ltd.",
    bsecode: "541493",
    close: 11.19,
    changePercent: -4.85,
    volume: 0,
    conditionFlag: 2,
    raw: wireRows[2],
  },
];

// ─── Tests ────────────────────────────────────────────────────────────────

describe("normalizeCapturedRows", () => {
  test("maps wire aliases to ChartinkCapturedRow", () => {
    const out = normalizeCapturedRows(wireRows);
    expect(out).toHaveLength(2); // empty nsecode row dropped
    expect(out[0]).toMatchObject({
      symbol: "TIJARIA",
      name: "Tijaria Polypipes Ltd.",
      bsecode: "538629",
      close: 14.506,
      changePercent: 15.913,
      volume: 2482221,
      conditionFlag: 1,
    });
    expect(out[0].raw).toEqual(wireRows[0]);
  });

  test("drops rows without an NSE code", () => {
    expect(normalizeCapturedRows(wireRows).map((r) => r.symbol)).toEqual([
      "TIJARIA",
      "RELCAPITAL",
    ]);
  });

  test("handles empty input", () => {
    expect(normalizeCapturedRows([])).toEqual([]);
  });

  test("falls back to pChange/close aliases", () => {
    const out = normalizeCapturedRows([
      { nsecode: "ABC", "pChange": 1.5, close: 100, volume: 50 },
    ]);
    expect(out[0]).toMatchObject({ changePercent: 1.5, close: 100, volume: 50 });
  });
});

describe("upsertChartinkScreener", () => {
  beforeEach(() => jest.clearAllMocks());

  test("upserts a definition row from a registry template", async () => {
    await upsertChartinkScreener(
      templateProfitJump,
      "Fundamental Scans",
    );

    expect(mockPrisma.chartinkScreener.upsert).toHaveBeenCalledWith({
      where: { id: templateProfitJump.id },
      update: {
        name: templateProfitJump.name,
        url: templateProfitJump.url,
        categoryId: "fundamental",
        categoryName: "Fundamental Scans",
        scanClause: templateProfitJump.scanClause,
        debugClause: null,
        columnClause: null,
        backtestMaxRows: null,
      },
      create: {
        id: templateProfitJump.id,
        name: templateProfitJump.name,
        url: templateProfitJump.url,
        categoryId: "fundamental",
        categoryName: "Fundamental Scans",
        scanClause: templateProfitJump.scanClause,
        debugClause: null,
        columnClause: null,
        backtestMaxRows: null,
      },
    });
  });
});

describe("run lifecycle", () => {
  beforeEach(() => jest.clearAllMocks());

  test("startChartinkRun creates a running run row", async () => {
    mockPrisma.chartinkScreenerRun.create.mockResolvedValue({
      id: "run-1",
      status: "running",
      ttlHours: 72,
    } as never);

    const runId = await startChartinkRun();

    expect(runId).toBe("run-1");
    expect(mockPrisma.chartinkScreenerRun.create).toHaveBeenCalledWith({
      data: { status: "running", ttlHours: 72 },
    });
  });

  test("insertChartinkRunResults chunks rows with TTL expiration", async () => {
    const rows = Array.from({ length: 600 }, (_, i) => ({
      symbol: `S${i}`,
      close: 10,
      changePercent: 1,
      volume: 100,
      raw: {},
    }));
    const before = Date.now();

    await insertChartinkRunResults("run-1", "screener-1", rows, 72);

    expect(mockPrisma.chartinkScreenerResult.createMany).toHaveBeenCalledTimes(3); // 600/250 chunks
    const firstCall = mockPrisma.chartinkScreenerResult.createMany.mock.calls[0][0];
    const row0 = firstCall.data[0];
    expect(row0).toMatchObject({
      runId: "run-1",
      screenerId: "screener-1",
      symbol: "S0",
      expiresAt: expect.any(Date),
    });
    // TTL = capturedAt + 72h
    const ttlMs = row0.expiresAt.getTime() - row0.capturedAt.getTime();
    expect(ttlMs).toBe(72 * 60 * 60 * 1000);
    expect(row0.capturedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  test("insertChartinkRunResults skips empty rows", async () => {
    await insertChartinkRunResults("run-1", "screener-1", []);
    expect(mockPrisma.chartinkScreenerResult.createMany).not.toHaveBeenCalled();
  });

  test("completeChartinkTemplateRun sets lastRunAt/nextRunAt + resultCount", async () => {
    mockPrisma.chartinkScreener.update.mockResolvedValue({} as never);

    await completeChartinkTemplateRun("screener-1", 42, 72, { scanlinkId: "scanlink:x" });

    const call = mockPrisma.chartinkScreener.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "screener-1" });
    expect(call.data.resultCount).toBe(42);
    expect(call.data.lastRunAt).toEqual(expect.any(Date));
    // nextRunAt = lastRunAt + 72h
    const ttlMs =
      call.data.nextRunAt.getTime() - call.data.lastRunAt.getTime();
    expect(ttlMs).toBe(72 * 60 * 60 * 1000);
  });

  test("failChartinkRun marks run failed with error", async () => {
    await failChartinkRun("run-1", "boom");
    expect(mockPrisma.chartinkScreenerRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { status: "failed", error: "boom", finishedAt: expect.any(Date) },
    });
  });

  test("completeChartinkRun marks run completed with totals", async () => {
    await completeChartinkRun("run-1", 3, 425);
    expect(mockPrisma.chartinkScreenerRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: {
        status: "completed",
        finishedAt: expect.any(Date),
        screenersRun: 3,
        rowsInserted: 425,
      },
    });
  });
});

describe("clear + prune (TTL maintenance)", () => {
  beforeEach(() => jest.clearAllMocks());

  test("clearChartinkResults deletes every result row (full-run clean)", async () => {
    mockPrisma.chartinkScreenerResult.deleteMany.mockResolvedValue({ count: 900 } as never);
    const count = await clearChartinkResults();
    expect(count).toBe(900);
    expect(mockPrisma.chartinkScreenerResult.deleteMany).toHaveBeenCalledWith({});
  });

  test("pruneExpiredChartinkResults deletes rows past expiresAt", async () => {
    mockPrisma.chartinkScreenerResult.deleteMany.mockResolvedValue({ count: 3 } as never);
    const now = new Date("2026-08-11T12:00:00Z");
    const count = await pruneExpiredChartinkResults(now);
    expect(count).toBe(3);
    expect(mockPrisma.chartinkScreenerResult.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: now } },
    });
  });
});

describe("getChartinkScreeners (read flags)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear the staticCache so each test hits the DB mock, not a cached result
    // from a prior test (Phase 1b added a 5-min NodeCache to getChartinkScreeners).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { staticCache } = require("@/lib/cache") as { staticCache: { del: (k: string) => void } };
    staticCache.del("chartink:screeners:overview");
  });

  const def = (overrides: Partial<Record<string, unknown>>) => ({
    id: "screener-1",
    name: "Profit jump by 200%",
    url: "https://chartink.com/scanner/profit-jump-by-200",
    categoryId: "fundamental",
    categoryName: "Fundamental Scans",
    scanClause: "( {cash} ... )",
    enabled: true,
    lastRunAt: new Date(),
    nextRunAt: new Date(),
    resultCount: 3,
    ...overrides,
  });

  test("screener never run is stale", async () => {
    mockPrisma.chartinkScreener.findMany.mockResolvedValue([
      def({ lastRunAt: null, nextRunAt: null, resultCount: 0 }),
    ] as never);

    const out = await getChartinkScreeners();
    expect(out[0].stale).toBe(true);
    expect(out[0].fetchable).toBe(true);
    expect(out[0].enabled).toBe(true);
  });

  test("screener with future nextRunAt is fresh", async () => {
    const farFuture = new Date(Date.now() + 36 * 60 * 60 * 1000);
    mockPrisma.chartinkScreener.findMany.mockResolvedValue([
      def({ nextRunAt: farFuture }),
    ] as never);

    const out = await getChartinkScreeners();
    expect(out[0].stale).toBe(false);
  });

  test("screener with passed nextRunAt is stale (TTL expired)", async () => {
    const past = new Date(Date.now() - 1000);
    mockPrisma.chartinkScreener.findMany.mockResolvedValue([
      def({ nextRunAt: past }),
    ] as never);

    const out = await getChartinkScreeners();
    expect(out[0].stale).toBe(true);
  });

  test("catalog-only template (no scanClause) is not fetchable", async () => {
    mockPrisma.chartinkScreener.findMany.mockResolvedValue([
      def({ scanClause: null }),
    ] as never);

    const out = await getChartinkScreeners();
    expect(out[0].fetchable).toBe(false);
  });

  test("filters by categoryId when provided", async () => {
    mockPrisma.chartinkScreener.findMany.mockResolvedValue([] as never);
    await getChartinkScreeners({ categoryId: "bearish" });
    expect(mockPrisma.chartinkScreener.findMany).toHaveBeenCalledWith({
      where: { categoryId: "bearish" },
      orderBy: [{ categoryId: "asc" }, { name: "asc" }],
    });
  });
});

describe("getChartinkScreenerResults (TTL reads)", () => {
  beforeEach(() => jest.clearAllMocks());

  test("returns empty when the screener has no runs", async () => {
    mockPrisma.chartinkScreenerRun.findMany.mockResolvedValue([] as never);
    const out = await getChartinkScreenerResults("screener-1");
    expect(out).toEqual([]);
  });

  test("filters expired rows unless includeStale", async () => {
    mockPrisma.chartinkScreenerRun.findMany.mockResolvedValue([
      { id: "run-1", ttlHours: 72, startedAt: new Date() },
    ] as never);
    mockPrisma.chartinkScreenerResult.findMany.mockResolvedValue([
      { symbol: "TIJARIA", name: "x", bsecode: "1", close: 14.5, changePercent: 2, volume: 3, conditionFlag: 1, raw: {}, expiresAt: new Date() },
    ] as never);

    await getChartinkScreenerResults("screener-1");
    expect(mockPrisma.chartinkScreenerResult.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1", screenerId: "screener-1", expiresAt: { gt: expect.any(Date) } },
      orderBy: { symbol: "asc" },
    });

    await getChartinkScreenerResults("screener-1", { includeStale: true });
    expect(mockPrisma.chartinkScreenerResult.findMany).toHaveBeenLastCalledWith({
      where: { runId: "run-1", screenerId: "screener-1" },
      orderBy: { symbol: "asc" },
    });
  });
});

describe("runFullChartinkSync (full-run clean + re-insert)", () => {
  beforeEach(() => jest.clearAllMocks());

  test("cleans the whole table then inserts all captures under one run", async () => {
    mockPrisma.chartinkScreenerRun.create.mockResolvedValue({ id: "run-1" } as never);
    mockPrisma.chartinkScreenerResult.deleteMany.mockResolvedValue({ count: 999 } as never);
    mockPrisma.chartinkScreenerResult.createMany.mockResolvedValue({ count: 2 } as never);
    mockPrisma.chartinkScreener.update.mockResolvedValue({} as never);
    mockPrisma.chartinkScreenerRun.update.mockResolvedValue({} as never);

    const result = await runFullChartinkSync([
      { templateId: "a", rows: capturedRows },
      { templateId: "b", rows: [] },
    ]);

    expect(result).toEqual({ runId: "run-1", screenersRun: 2, rowsInserted: 2 });

    // 1. clean
    expect(mockPrisma.chartinkScreenerResult.deleteMany).toHaveBeenCalledWith({});
    // 2. per-template inserts under the same run (both templates processed;
    //    "b" had no rows so only "a" inserted)
    const insertCalls = mockPrisma.chartinkScreenerResult.createMany.mock.calls;
    expect(insertCalls).toHaveLength(1); // only template "a" had rows
    expect(insertCalls[0][0].data[0].runId).toBe("run-1");
    expect(insertCalls[0][0].data).toHaveLength(2);
    // 3. completed with totals
    const doneCall = mockPrisma.chartinkScreenerRun.update.mock.calls.find(
      (c) => c[0].data.status === "completed",
    );
    expect(doneCall?.[0].data).toMatchObject({
      screenersRun: 2,
      rowsInserted: 2,
    });
  });

  test("marks run failed when insertion throws", async () => {
    mockPrisma.chartinkScreenerRun.create.mockResolvedValue({ id: "run-1" } as never);
    mockPrisma.chartinkScreenerResult.deleteMany.mockResolvedValue({ count: 0 } as never);
    mockPrisma.chartinkScreenerResult.createMany.mockRejectedValue(
      new Error("db down"),
    );

    await expect(
      runFullChartinkSync([{ templateId: "a", rows: capturedRows }]),
    ).rejects.toThrow("db down");

    const failCall = mockPrisma.chartinkScreenerRun.update.mock.calls.find(
      (c) => c[0].data.status === "failed",
    );
    expect(failCall?.[0].data).toMatchObject({
      status: "failed",
      error: "db down",
    });
  });
});

describe("TTL constant", () => {
  test("exposes 72h default", () => {
    expect(CHARTINK_SCREENER_TTL_HOURS).toBe(72);
  });
});