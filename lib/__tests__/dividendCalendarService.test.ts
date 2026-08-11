/**
 * Tests for lib/services/dividendCalendarService.ts
 *
 * Focus: the v3.5.8 summary fix — `getUpcomingDividendSummary()` must compute
 * the "Upcoming / Est. Income / Avg Yield" cards from the upcoming dividend
 * list (today → end of next year), NOT from a month-scoped calendar view that
 * zeroes out once the viewed month's ex-dates pass.
 *
 * Covers:
 *   - computeSummary: upcoming filter (exDate >= now), income from holdings,
 *     avgYield, totalDividends
 *   - getUpcomingDividends: fetch + price enrichment + yield recompute
 *   - getUpcomingDividendSummary: summary derived from the upcoming list,
 *     holdings respected, empty-safe
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

jest.mock("@/lib/prisma", () => {
  const mock = {
    corporateAction: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
    portfolio: { findMany: jest.fn() },
  };
  return { __esModule: true, default: mock };
});

// ─── Imports ──────────────────────────────────────────────────────────────

import {
  computeSummary,
  getUpcomingDividends,
  getUpcomingDividendSummary,
  type DividendEvent,
} from "@/lib/services/dividendCalendarService";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const prisma = require("@/lib/prisma").default as {
  corporateAction: { findMany: jest.Mock };
  $queryRaw: jest.Mock;
  portfolio: { findMany: jest.Mock };
};

/* ─── Helpers ─── */

const day = 24 * 60 * 60 * 1000;

/** exDate string `n` days from now (relative to real now — avoids clock drift). */
function inDays(n: number): string {
  return new Date(Date.now() + n * day).toISOString();
}

function makeDividend(overrides: Partial<DividendEvent> = {}): DividendEvent {
  return {
    id: 1,
    symbol: "TEST",
    companyName: "Test Corp",
    exDate: inDays(10),
    recordDate: inDays(9),
    dividendPerShare: 10,
    dividendYield: 1.5,
    currentPrice: 100,
    faceValue: "10",
    ratio: null,
    actionType: "DIVIDEND",
    source: "nse",
    isin: "INE000000001",
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function prismaRow(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    symbol: "TEST",
    companyName: "Test Corp",
    exDate: new Date(Date.now() + 10 * day),
    recordDate: new Date(Date.now() + 9 * day),
    dividendPerShare: 10,
    dividendYield: null,
    faceValue: "10",
    ratio: null,
    actionType: "DIVIDEND",
    source: "nse",
    isin: "INE000000001",
    ...overrides,
  };
}

/* ─── computeSummary ─── */

describe("computeSummary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("counts only dividends with exDate >= now as upcoming", () => {
    const dividends = [
      makeDividend({ id: 1, exDate: inDays(-5) }), // past → not upcoming
      makeDividend({ id: 2, exDate: inDays(30) }), // future → upcoming
      makeDividend({ id: 3, exDate: null }), // no exDate → not upcoming
    ];

    const summary = computeSummary(dividends, new Map());

    expect(summary.upcomingCount).toBe(1);
    // totalDividends counts everything in the input list
    expect(summary.totalDividends).toBe(3);
  });

  it("computes annual income from holdings (per-share × qty)", () => {
    const dividends = [
      makeDividend({ id: 1, symbol: "AAA", dividendPerShare: 10, exDate: inDays(30) }),
      makeDividend({ id: 2, symbol: "BBB", dividendPerShare: 5, exDate: inDays(60) }),
      // Past ex-date — held stock but NOT counted as upcoming income
      makeDividend({ id: 3, symbol: "AAA", dividendPerShare: 10, exDate: inDays(-1) }),
    ];
    const holdings = new Map([
      ["AAA", 100],
      ["BBB", 200],
    ]);

    const summary = computeSummary(dividends, holdings);

    // Annual: AAA 100×10 + BBB 200×5 = 2000 (past one excluded)
    expect(summary.estAnnualIncome).toBe(2000);
  });

  it("computes monthly income for the NEXT month only", () => {
    const now = new Date();
    const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 20); // next month
    const twoMonthsOut = new Date(now.getFullYear(), now.getMonth() + 2, 20);
    // Handle year rollover for Dec → Jan
    const nextMonthIso = nextMonthDate.toISOString();
    const twoMonthsIso = twoMonthsOut.toISOString();

    const dividends = [
      makeDividend({ id: 1, symbol: "AAA", dividendPerShare: 10, exDate: nextMonthIso }),
      makeDividend({ id: 2, symbol: "BBB", dividendPerShare: 5, exDate: twoMonthsIso }),
    ];
    const holdings = new Map([
      ["AAA", 100],
      ["BBB", 200],
    ]);

    const summary = computeSummary(dividends, holdings);

    // Next month: only AAA 100×10 = 1000 (BBB is 2 months out)
    expect(summary.estMonthlyIncome).toBe(1000);
    // Annual: 1000 + 200×5 = 2000
    expect(summary.estAnnualIncome).toBe(2000);
  });

  it("averages yield over upcoming dividends and nulls when none", () => {
    const dividends = [
      makeDividend({ id: 1, dividendYield: 2, exDate: inDays(5) }),
      makeDividend({ id: 2, dividendYield: 4, exDate: inDays(40) }),
      // Past dividend with yield must NOT pollute the average
      makeDividend({ id: 3, dividendYield: 99, exDate: inDays(-3) }),
    ];

    const summary = computeSummary(dividends, new Map());

    expect(summary.avgYield).toBe(3);

    const noYield = computeSummary(
      [makeDividend({ id: 4, dividendYield: null, exDate: inDays(5) })],
      new Map(),
    );
    expect(noYield.avgYield).toBeNull();
  });

  it("returns all-zero summary for empty input", () => {
    const summary = computeSummary([], new Map());

    expect(summary).toEqual({
      upcomingCount: 0,
      estMonthlyIncome: 0,
      estAnnualIncome: 0,
      avgYield: null,
      totalDividends: 0,
    });
  });
});

/* ─── getUpcomingDividends ─── */

describe("getUpcomingDividends", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("fetches dividends with exDate >= today and enriches with latest prices", async () => {
    prisma.corporateAction.findMany.mockResolvedValue([
      prismaRow({ symbol: "RELIANCE", dividendPerShare: 12 }),
    ]);
    prisma.$queryRaw.mockResolvedValue([{ ticker: "RELIANCE", close: 2500 }]);

    const result = await getUpcomingDividends(10);

    // Queried against corporateAction with a gte = today (start of UTC day)
    const findArgs = prisma.corporateAction.findMany.mock.calls[0][0];
    expect(findArgs.where.actionType).toBe("DIVIDEND");
    expect(findArgs.where.exDate.gte).toBeInstanceOf(Date);
    expect(findArgs.take).toBe(10);

    expect(result).toHaveLength(1);
    expect(result[0].currentPrice).toBe(2500);
    // yield recomputed from price: 12/2500*100 = 0.48
    expect(result[0].dividendYield).toBeCloseTo(0.48, 2);
  });

  it("keeps stored yield when no price available", async () => {
    prisma.corporateAction.findMany.mockResolvedValue([
      prismaRow({ symbol: "RELIANCE", dividendPerShare: 12, dividendYield: 5 }),
    ]);
    prisma.$queryRaw.mockResolvedValue([]); // no prices in DB

    const result = await getUpcomingDividends(10);

    expect(result[0].currentPrice).toBeNull();
    expect(result[0].dividendYield).toBe(5);
  });

  it("returns [] on prisma error (safe default)", async () => {
    prisma.corporateAction.findMany.mockRejectedValue(new Error("db down"));

    const result = await getUpcomingDividends(10);

    expect(result).toEqual([]);
  });
});

/* ─── getUpcomingDividendSummary ─── */

describe("getUpcomingDividendSummary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("computes the summary from the upcoming list (today → end of next year)", async () => {
    // Two upcoming dividends, 30 and 60 days out — BOTH inside the window and
    // `exDate >= now`, so both count (unlike the month-scoped bug).
    prisma.corporateAction.findMany.mockResolvedValue([
      prismaRow({ id: 1, symbol: "AAA", dividendPerShare: 10, exDate: new Date(Date.now() + 30 * day) }),
      prismaRow({ id: 2, symbol: "BBB", dividendPerShare: 5, exDate: new Date(Date.now() + 60 * day) }),
    ]);
    prisma.$queryRaw.mockResolvedValue([]); // no prices → stored yields kept
    prisma.portfolio.findMany.mockResolvedValue([
      {
        id: 1,
        transactions: [
          { ticker: "AAA", side: "BUY", quantity: 100 },
          { ticker: "BBB", side: "BUY", quantity: 200 },
        ],
      },
    ]);

    const summary = await getUpcomingDividendSummary(42);

    // Both dividends are upcoming
    expect(summary.upcomingCount).toBe(2);
    // Annual income from holdings: 100×10 + 200×5 = 2000
    expect(summary.estAnnualIncome).toBe(2000);
    expect(summary.totalDividends).toBe(2);
    // portfolio holdings were fetched for userId 42
    expect(prisma.portfolio.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 42 } }),
    );
  });

  it("applies SELL transactions to reduce holdings", async () => {
    prisma.corporateAction.findMany.mockResolvedValue([
      prismaRow({ id: 1, symbol: "AAA", dividendPerShare: 10, exDate: new Date(Date.now() + 30 * day) }),
    ]);
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.portfolio.findMany.mockResolvedValue([
      {
        id: 1,
        transactions: [
          { ticker: "AAA", side: "BUY", quantity: 100 },
          { ticker: "AAA", side: "SELL", quantity: 40 },
        ],
      },
    ]);

    const summary = await getUpcomingDividendSummary(7);

    // Net holding 60 → income 60×10 = 600
    expect(summary.estAnnualIncome).toBe(600);
  });

  it("returns zeroed summary when there are no upcoming dividends", async () => {
    // The real query filters exDate >= today, so an empty findMany result is
    // what the service sees once all ex-dates have passed.
    prisma.corporateAction.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.portfolio.findMany.mockResolvedValue([]);

    const summary = await getUpcomingDividendSummary();

    expect(summary.upcomingCount).toBe(0);
    expect(summary.estAnnualIncome).toBe(0);
    expect(summary.estMonthlyIncome).toBe(0);
    expect(summary.avgYield).toBeNull();
    expect(summary.totalDividends).toBe(0);
  });
});