/**
 * Tests for the shared cron parser (lib/cron-parser.ts).
 *
 * Covers weekday ranges ("1-5", "MON-FRI"), both-restricted OR semantics,
 * lists/steps/wildcards, and the fallback behavior for invalid expressions.
 *
 * TIMEZONE SEMANTICS (v3.10.1): the parser evaluates expressions in **UTC**
 * on every host (IST = UTC + 5:30), so the returned instant is
 * host-independent — "30 4 * * 1-5" always means 04:30 UTC = 10:00 AM IST,
 * whether the process runs on a UTC host or an IST dev machine.
 * Expected dates are therefore constructed with Date.UTC components.
 */

import { calculateNextRun } from "@/lib/cron-parser";

// UTC helper: construct a Date from UTC components (Y, M, D, h, m).
const utc = (y: number, m: number, d: number, h: number, min: number): Date =>
  new Date(Date.UTC(y, m - 1, d, h, min, 0, 0));

describe("cron-parser calculateNextRun", () => {
  describe("UTC semantics (host-independent)", () => {
    it("evaluates expressions in UTC, not the host's local timezone", () => {
      // Regression for the v3.10.1 fix: an IST dev machine previously
      // computed "30 4 * * 1-5" as 04:30 IST (= 23:00 UTC the day before),
      // firing recommendations 5.5h early. from = Sat Aug 8 2026 09:00 IST
      // (= 03:30 UTC) → next Mon-Fri slot must be Mon Aug 10 04:30 **UTC**.
      const from = new Date(Date.UTC(2026, 7, 8, 3, 30, 0, 0));
      const next = calculateNextRun("30 4 * * 1-5", from);
      expect(next.toISOString()).toBe("2026-08-10T04:30:00.000Z");
    });

    it("30 4 * * 1-5 = 04:30 UTC = 10:00 AM IST (weekday only)", () => {
      // Sunday 09:00 UTC → Monday 04:30 UTC (next Mon-Fri)
      const from = utc(2026, 8, 9, 9, 0); // Sunday
      const next = calculateNextRun("30 4 * * 1-5", from);
      expect(next.toISOString()).toBe("2026-08-10T04:30:00.000Z");
    });

    it("30 10 * * 1-5 = 10:30 UTC = 4:00 PM IST (weekday only)", () => {
      // Friday 09:00 UTC → Friday 10:30 UTC (same day, later time)
      const from = utc(2026, 8, 7, 9, 0); // Friday
      const next = calculateNextRun("30 10 * * 1-5", from);
      expect(next.toISOString()).toBe("2026-08-07T10:30:00.000Z");
    });
  });

  describe("weekday ranges (dom-dow semantics)", () => {
    it("matches Mon-Fri numeric range", () => {
      // "30 4 * * 1-5" → next Mon-Fri at 04:30 UTC after Sat 09:00 UTC
      // Aug 8 2026 is a Saturday; next weekday Mon Aug 10.
      const from = utc(2026, 8, 8, 9, 0);
      const next = calculateNextRun("30 4 * * 1-5", from);
      expect(next.getTime()).toBe(utc(2026, 8, 10, 4, 30).getTime());
    });

    it("matches MON-FRI named range", () => {
      // Friday 09:00 UTC → same day 16:00 UTC
      const from = utc(2026, 8, 7, 9, 0); // Friday
      const next = calculateNextRun("0 16 * * MON-FRI", from);
      expect(next.getTime()).toBe(utc(2026, 8, 7, 16, 0).getTime());
    });

    it("does not run on weekends with 1-5 range", () => {
      // Sunday 09:00 UTC → next Mon-Fri 10:30 UTC → Monday
      const from = utc(2026, 8, 9, 9, 0); // Sunday
      const next = calculateNextRun("30 10 * * 1-5", from);
      expect(next.getUTCDay()).not.toBe(0);
      expect(next.getUTCDay()).not.toBe(6);
      expect(next.getTime()).toBe(utc(2026, 8, 10, 10, 30).getTime());
    });

    it("single weekday (5 = Friday only)", () => {
      // Mon 10:00 UTC → next Friday 09:00 UTC
      const from = utc(2026, 8, 3, 10, 0); // Monday
      const next = calculateNextRun("0 9 * * 5", from);
      expect(next.getTime()).toBe(utc(2026, 8, 7, 9, 0).getTime());
    });

    it("finds same-day slot when time is in the future", () => {
      // Mon 10:00 UTC (past 04:30) → next Monday 04:30 UTC
      const from = utc(2026, 8, 3, 10, 0); // Monday
      const next = calculateNextRun("30 4 * * 1", from);
      expect(next.getTime()).toBe(utc(2026, 8, 10, 4, 30).getTime());
    });
  });

  describe("both dom and dow restricted → OR (standard cron)", () => {
    it("runs on day-of-month 15 OR Wednesday", () => {
      // 2026-08-15 is a Saturday; Wednesdays are 5, 12, 19, 26
      const from = utc(2026, 8, 3, 10, 0); // Monday
      const next = calculateNextRun("0 12 15 * 3", from);
      // First Wed after Aug 3 → Aug 5
      expect(next.getTime()).toBe(utc(2026, 8, 5, 12, 0).getTime());
    });
  });

  describe("lists, steps, wildcards", () => {
    it("supports comma lists in hour field", () => {
      const from = utc(2026, 8, 3, 10, 0);
      const next = calculateNextRun("0 9,18 * * *", from);
      expect(next.getTime()).toBe(utc(2026, 8, 3, 18, 0).getTime());
    });

    it("supports */step syntax", () => {
      // Every 15 minutes → next quarter after 10:00
      const from = utc(2026, 8, 3, 10, 0);
      const next = calculateNextRun("*/15 * * * *", from);
      expect(next.getTime()).toBe(utc(2026, 8, 3, 10, 15).getTime());
    });

    it("supports month ranges", () => {
      // Only in December → Dec 1 00:00 UTC
      const from = utc(2026, 8, 3, 10, 0);
      const next = calculateNextRun("0 0 1 12 *", from);
      expect(next.getTime()).toBe(utc(2026, 12, 1, 0, 0).getTime());
    });
  });

  describe("invalid input fallback", () => {
    it("returns now+60s for wrong field count", () => {
      const from = utc(2026, 8, 3, 10, 0);
      const next = calculateNextRun("30 4 * *", from);
      expect(next.getTime()).toBe(from.getTime() + 60_000);
    });

    it("returns now+60s for non-numeric fields", () => {
      const from = utc(2026, 8, 3, 10, 0);
      const next = calculateNextRun("x x * * *", from);
      expect(next.getTime()).toBe(from.getTime() + 60_000);
    });

    it("returns now+60s for empty expression", () => {
      const from = utc(2026, 8, 3, 10, 0);
      const next = calculateNextRun("", from);
      expect(next.getTime()).toBe(from.getTime() + 60_000);
    });
  });
});
