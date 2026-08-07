/**
 * Tests for the shared cron parser (lib/cron-parser.ts).
 *
 * Covers weekday ranges ("1-5", "MON-FRI"), both-restricted OR semantics,
 * lists/steps/wildcards, and the fallback behavior for invalid expressions.
 *
 * NOTE: the parser operates in the process's LOCAL timezone (cron semantics).
 * Expected dates are therefore constructed with local-time components so the
 * suite passes on any machine (IST dev boxes, UTC serverless, etc.).
 */

import { calculateNextRun } from "@/lib/cron-parser";

// Local-time helper: construct a Date from local components (Y, M, D, h, m).
const local = (y: number, m: number, d: number, h: number, min: number): Date =>
  new Date(y, m - 1, d, h, min, 0, 0);

describe("cron-parser calculateNextRun", () => {
  describe("weekday ranges (dom-dow semantics)", () => {
    it("matches Mon-Fri numeric range", () => {
      // "30 4 * * 1-5" → next Mon-Fri at 04:30 after Sat 09:00 → Monday 04:30
      // Aug 8 2026 is a Saturday; next weekday Mon Aug 10.
      const from = local(2026, 8, 8, 9, 0);
      const next = calculateNextRun("30 4 * * 1-5", from);
      expect(next.getTime()).toBe(local(2026, 8, 10, 4, 30).getTime());
    });

    it("matches MON-FRI named range", () => {
      // Friday 09:00 → same day 16:00
      const from = local(2026, 8, 7, 9, 0); // Friday
      const next = calculateNextRun("0 16 * * MON-FRI", from);
      expect(next.getTime()).toBe(local(2026, 8, 7, 16, 0).getTime());
    });

    it("does not run on weekends with 1-5 range", () => {
      // Sunday 09:00 → next Mon-Fri 10:30 → Monday
      const from = local(2026, 8, 9, 9, 0); // Sunday
      const next = calculateNextRun("30 10 * * 1-5", from);
      expect(next.getDay()).not.toBe(0);
      expect(next.getDay()).not.toBe(6);
      expect(next.getTime()).toBe(local(2026, 8, 10, 10, 30).getTime());
    });

    it("single weekday (5 = Friday only)", () => {
      // Mon 10:00 → next Friday 09:00
      const from = local(2026, 8, 3, 10, 0); // Monday
      const next = calculateNextRun("0 9 * * 5", from);
      expect(next.getTime()).toBe(local(2026, 8, 7, 9, 0).getTime());
    });

    it("finds same-day slot when time is in the future", () => {
      // Mon 04:30 (already 10:00 Monday) → next Monday
      const from = local(2026, 8, 3, 10, 0); // Monday
      const next = calculateNextRun("30 4 * * 1", from);
      expect(next.getTime()).toBe(local(2026, 8, 10, 4, 30).getTime());
    });
  });

  describe("both dom and dow restricted → OR (standard cron)", () => {
    it("runs on day-of-month 15 OR Wednesday", () => {
      // 2026-08-15 is a Saturday; Wednesdays are 5, 12, 19, 26
      const from = local(2026, 8, 3, 10, 0); // Monday
      const next = calculateNextRun("0 12 15 * 3", from);
      // First Wed after Aug 3 → Aug 5
      expect(next.getTime()).toBe(local(2026, 8, 5, 12, 0).getTime());
    });
  });

  describe("lists, steps, wildcards", () => {
    it("supports comma lists in hour field", () => {
      const from = local(2026, 8, 3, 10, 0);
      const next = calculateNextRun("0 9,18 * * *", from);
      expect(next.getTime()).toBe(local(2026, 8, 3, 18, 0).getTime());
    });

    it("supports */step syntax", () => {
      // Every 15 minutes → next quarter after 10:00
      const from = local(2026, 8, 3, 10, 0);
      const next = calculateNextRun("*/15 * * * *", from);
      expect(next.getTime()).toBe(local(2026, 8, 3, 10, 15).getTime());
    });

    it("supports month ranges", () => {
      // Only in December → Dec 1 00:00
      const from = local(2026, 8, 3, 10, 0);
      const next = calculateNextRun("0 0 1 12 *", from);
      expect(next.getTime()).toBe(local(2026, 12, 1, 0, 0).getTime());
    });
  });

  describe("invalid input fallback", () => {
    it("returns now+60s for wrong field count", () => {
      const from = local(2026, 8, 3, 10, 0);
      const next = calculateNextRun("30 4 * *", from);
      expect(next.getTime()).toBe(from.getTime() + 60_000);
    });

    it("returns now+60s for non-numeric fields", () => {
      const from = local(2026, 8, 3, 10, 0);
      const next = calculateNextRun("x x * * *", from);
      expect(next.getTime()).toBe(from.getTime() + 60_000);
    });

    it("returns now+60s for empty expression", () => {
      const from = local(2026, 8, 3, 10, 0);
      const next = calculateNextRun("", from);
      expect(next.getTime()).toBe(from.getTime() + 60_000);
    });
  });

  describe("cron job expression registry (recommendation crons)", () => {
    it("10:00 IST recommendations = 30 4 * * 1-5 (weekday only)", () => {
      // Sunday 09:00 → Monday 04:30 (next Mon-Fri)
      const from = local(2026, 8, 9, 9, 0); // Sunday
      const next = calculateNextRun("30 4 * * 1-5", from);
      expect(next.getTime()).toBe(local(2026, 8, 10, 4, 30).getTime());
    });

    it("4:00 PM IST performance check = 30 10 * * 1-5 (weekday only)", () => {
      // Friday 09:00 → Friday 10:30 (same day, later time)
      const from = local(2026, 8, 7, 9, 0); // Friday
      const next = calculateNextRun("30 10 * * 1-5", from);
      expect(next.getTime()).toBe(local(2026, 8, 7, 10, 30).getTime());
    });
  });
});
