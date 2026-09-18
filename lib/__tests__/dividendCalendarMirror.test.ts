/* @jest-environment node */

/**
 * Dividend calendar mirror fallback (BUGS 17).
 *
 * Under the P6003 plan-limit hold Prisma throws, which used to blank the whole
 * dividend calendar. fetchDividends must fall back to the SQLite
 * `corporate_action` mirror (raw snake_case) and still emit camelCase
 * DividendEvent rows. deps are mocked; the service wiring is real.
 */

import { getDividendCalendar, getUpcomingDividends } from "@/lib/services/dividendCalendarService";
import prisma from "@/lib/prisma";
import { getSqliteFallback } from "@/lib/sqlite";

jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
  },
}));
jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    corporateAction: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  },
}));
jest.mock("@/lib/sqlite", () => ({
  __esModule: true,
  getSqliteFallback: jest.fn(),
}));

const mockFindMany = (prisma as unknown as { corporateAction: { findMany: jest.Mock } })
  .corporateAction.findMany;
const mockQueryRaw = (prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw;
const mockGetSqliteFallback = getSqliteFallback as jest.Mock;

const holdError = Object.assign(
  new Error("There is a hold on your account. Reason: planLimitReached."),
  { code: "P6003" }
);

const mirrorRows = [
  {
    id: 11,
    symbol: "RELIANCE",
    company_name: "Reliance Industries Ltd",
    action_type: "DIVIDEND",
    ex_date: "2026-09-22T00:00:00.000Z",
    record_date: "2026-09-23T00:00:00.000Z",
    dividend_per_share: "12.5",
    dividend_yield: 1.01,
    face_value: "10",
    source: "nse",
    isin: "INE002A01018",
  },
  {
    id: 12,
    symbol: "INFY",
    company_name: "Infosys Ltd",
    action_type: "BONUS",
    ex_date: "2026-09-22T00:00:00.000Z",
  },
  {
    id: 13,
    symbol: "TCS",
    company_name: "Tata Consultancy Services",
    action_type: "DIVIDEND",
    ex_date: "2026-11-05T00:00:00.000Z",
    dividend_per_share: "27",
  },
  {
    id: 14,
    symbol: "WIPRO",
    company_name: "Wipro Ltd",
    action_type: "DIVIDEND",
    ex_date: null,
  },
];

function sqliteWith(rows: Array<Record<string, unknown>>) {
  mockGetSqliteFallback.mockReturnValue({
    isReady: () => true,
    getCorporateActions: () => rows,
  });
}

describe("dividend calendar mirror fallback (BUGS 17)", () => {
  beforeAll(() => {
    // Freeze the clock so the upcoming window is deterministic.
    jest.useFakeTimers({ now: new Date("2026-09-19T00:00:00.000Z") });
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryRaw.mockResolvedValue([]);
    sqliteWith([]);
  });

  test("P6003 hold → serves month-scoped dividends from the mirror (mapped, DIVIDEND only)", async () => {
    mockFindMany.mockRejectedValue(holdError);
    sqliteWith(mirrorRows);

    const data = await getDividendCalendar(9, 2026);

    expect(mockFindMany).toHaveBeenCalled();
    expect(data.dividends).toHaveLength(1); // BONUS + out-of-window + null-date dropped
    expect(data.dividends[0]).toMatchObject({
      id: 11,
      symbol: "RELIANCE",
      companyName: "Reliance Industries Ltd",
      exDate: "2026-09-22T00:00:00.000Z",
      dividendPerShare: 12.5,
      currentPrice: null, // no price map available in mirror mode
      actionType: "DIVIDEND",
    });
    expect(data.summary.totalDividends).toBe(1);
  });

  test("P6003 hold with an empty mirror → empty calendar, no throw", async () => {
    mockFindMany.mockRejectedValue(holdError);
    sqliteWith([]);

    const data = await getDividendCalendar(9, 2026);
    expect(data.dividends).toEqual([]);
    expect(data.summary.totalDividends).toBe(0);
  });

  test("getUpcomingDividends also falls back to the mirror", async () => {
    mockFindMany.mockRejectedValue(holdError);
    sqliteWith(mirrorRows);

    const upcoming = await getUpcomingDividends(50);

    // Both future DIVIDEND rows within today → +1yr, ascending by ex-date.
    expect(upcoming.map((d) => d.symbol)).toEqual(["RELIANCE", "TCS"]);
  });

  test("a non-hold error does NOT consult the mirror (returns empty)", async () => {
    mockFindMany.mockRejectedValue(new Error("syntax error near FROM"));

    const data = await getDividendCalendar(9, 2026);

    expect(data.dividends).toEqual([]);
    expect(mockGetSqliteFallback).not.toHaveBeenCalled();
  });

  test("a healthy Prisma result never touches the mirror", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 99,
        symbol: "HDFCBANK",
        companyName: "HDFC Bank Ltd",
        actionType: "DIVIDEND",
        exDate: new Date("2026-09-25T00:00:00.000Z"),
        recordDate: null,
        dividendPerShare: 19.5,
        dividendYield: null,
        faceValue: "1",
        ratio: null,
        source: "nse",
        isin: null,
      },
    ]);

    const data = await getDividendCalendar(9, 2026);

    expect(mockGetSqliteFallback).not.toHaveBeenCalled();
    expect(data.dividends).toHaveLength(1);
    expect(data.dividends[0].symbol).toBe("HDFCBANK");
  });
});
