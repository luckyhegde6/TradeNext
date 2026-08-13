import { render, screen } from "@testing-library/react";
import DividendMonthView, { toLocalDateKey } from "../DividendMonthView";
import { DividendEvent } from "@/lib/services/dividendCalendarService";

// NSE ex-dates are stored at 12:00 UTC (seed parseDateCA). The regression only
// manifests in positive-offset timezones (IST +05:30 shifts the local day), so
// pin the test process to IST to make the guard deterministic across CI (UTC).
process.env.TZ = "Asia/Kolkata";

describe("DividendMonthView timezone keying (regression: v3.6.1)", () => {
  // NSE ex-dates are stored at 12:00 UTC (seed parseDateCA). Before the fix the
  // dividend map used `toISOString()` (UTC) while grid cells used local dates —
  // in IST a noon-UTC ex-date landed ONE calendar day late in the grid.
  const noonUtcExDate = "2026-08-10T12:00:00.000Z";

  const makeDividend = (over: Partial<DividendEvent> = {}): DividendEvent => ({
    id: 1,
    symbol: "PTC",
    companyName: "PTC India Ltd",
    exDate: noonUtcExDate,
    recordDate: null,
    dividendPerShare: 2.5,
    dividendYield: 1.2,
    currentPrice: 200,
    faceValue: null,
    ratio: null,
    actionType: "dividend",
    source: "NSE",
    isin: null,
    ...over,
  });

  describe("toLocalDateKey", () => {
    test("formats local calendar components as YYYY-MM-DD", () => {
      expect(toLocalDateKey(new Date(2026, 7, 10))).toBe("2026-08-10");
    });

    test("midnight-local grid date and noon-UTC ex-date share the key", () => {
      // new Date(2026, 7, 10) is Aug 10 00:00 local; the stored ex-date instant
      // is Aug 10 12:00 UTC. Both must bucket to the same local calendar day.
      expect(toLocalDateKey(new Date(2026, 7, 10))).toBe(
        toLocalDateKey(new Date(noonUtcExDate))
      );
    });
  });

  describe("calendar grid placement", () => {
    test("noon-UTC ex-date renders on the correct local day (10 Aug, not 11 Aug)", () => {
      render(
        <DividendMonthView
          dividends={[makeDividend()]}
          month={8}
          year={2026}
          onPrevMonth={() => {}}
          onNextMonth={() => {}}
          onToday={() => {}}
        />
      );

      const aug10Cell = screen.getByTestId("cell-2026-08-10");
      const aug11Cell = screen.getByTestId("cell-2026-08-11");

      expect(aug10Cell.textContent).toContain("PTC");
      expect(aug11Cell.textContent).not.toContain("PTC");
    });

    test("separate ex-dates group under their own days", () => {
      render(
        <DividendMonthView
          dividends={[
            makeDividend({ id: 1 }),
            makeDividend({ id: 2, symbol: "RITES", companyName: "RITES Ltd", exDate: "2026-08-11T12:00:00.000Z" }),
          ]}
          month={8}
          year={2026}
          onPrevMonth={() => {}}
          onNextMonth={() => {}}
          onToday={() => {}}
        />
      );

      const aug10Cell = screen.getByTestId("cell-2026-08-10");
      const aug11Cell = screen.getByTestId("cell-2026-08-11");

      expect(aug10Cell.textContent).toContain("PTC");
      expect(aug10Cell.textContent).not.toContain("RITES");
      expect(aug11Cell.textContent).toContain("RITES");
      expect(aug11Cell.textContent).not.toContain("PTC");
    });
  });
});