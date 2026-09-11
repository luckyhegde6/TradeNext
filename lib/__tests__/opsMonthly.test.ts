/* @jest-environment node */

/**
 * v3.34.0 unit tests for the IST-monthly query-consumption ledger
 * (lib/services/opsMonthly.ts). This module is PURE: its only import is
 * `getIstDayKey` from @/lib/prisma and it MUST never be invoked at module load
 * (lib/sqlite.ts pulls this module in, and several suites mock @/lib/prisma
 * with NO named exports — a load-time call would crash them). Here the
 * aggregation semantics are locked down; the db-health route plumbing and the
 * SQLite persistence layer are covered in dbHealthRoute.test.ts / sqlite.test.ts.
 */

let mockTodayKey = "2026-09-10";
jest.mock("@/lib/prisma", () => ({
  getIstDayKey: () => mockTodayKey,
}));

import {
  buildQueryConsumption,
  foldOpsCounterIntoMonthly,
  getOpsMonthlyState,
  resetOpsMonthlyForTests,
} from "@/lib/services/opsMonthly";

beforeEach(() => {
  mockTodayKey = "2026-09-10";
  resetOpsMonthlyForTests();
});

describe("getOpsMonthlyState (lazy month-scoped ledger)", () => {
  it("seeds an empty ledger for the current IST month", () => {
    const state = getOpsMonthlyState();
    expect(state.monthKey).toBe("2026-09");
    expect(state.days).toEqual({});
  });

  it("starts a FRESH ledger when the IST month rolls over", () => {
    const first = getOpsMonthlyState();
    foldOpsCounterIntoMonthly(first, "2026-09-09", { reads: 100, writes: 20 });
    mockTodayKey = "2026-10-01";
    const next = getOpsMonthlyState();
    expect(next).not.toBe(first);
    expect(next.monthKey).toBe("2026-10");
    expect(next.days).toEqual({});
  });

  it("resetOpsMonthlyForTests clears IN PLACE (same object identity)", () => {
    const state = getOpsMonthlyState();
    foldOpsCounterIntoMonthly(state, "2026-09-09", { reads: 1, writes: 2 });
    resetOpsMonthlyForTests();
    expect(getOpsMonthlyState()).toBe(state); // in-place reset, not a re-seed
    expect(state.monthKey).toBe("2026-09");
    expect(state.days).toEqual({});
  });
});

describe("foldOpsCounterIntoMonthly", () => {
  it("merges idempotently with Math.max (never shrinks)", () => {
    const state = getOpsMonthlyState();
    foldOpsCounterIntoMonthly(state, "2026-09-09", { reads: 100, writes: 20 });
    foldOpsCounterIntoMonthly(state, "2026-09-09", { reads: 80, writes: 30 });
    foldOpsCounterIntoMonthly(state, "2026-09-09", { reads: 120, writes: 5 });
    expect(state.days["2026-09-09"]).toEqual({ reads: 120, writes: 30 });
  });
});

describe("buildQueryConsumption", () => {
  it("reports an empty month with today's 0/0 row included", () => {
    const body = buildQueryConsumption(getOpsMonthlyState(), { reads: 0, writes: 0 }, 200_000);
    expect(body.monthKey).toBe("2026-09");
    expect(body.reads).toBe(0);
    expect(body.writes).toBe(0);
    expect(body.totalOperations).toBe(0);
    expect(body.planLimit).toBe(200_000);
    expect(body.planOperationsRemaining).toBe(200_000);
    expect(body.today).toEqual({ dayKey: "2026-09-10", reads: 0, writes: 0 });
    expect(body.perDay).toEqual([{ day: "2026-09-10", reads: 0, writes: 0 }]);
  });

  it("sums folded days and merges today's live counter", () => {
    const state = getOpsMonthlyState();
    foldOpsCounterIntoMonthly(state, "2026-09-09", { reads: 100, writes: 20 });
    foldOpsCounterIntoMonthly(state, "2026-09-08", { reads: 40, writes: 5 });
    const body = buildQueryConsumption(state, { reads: 7, writes: 2 }, 200_000);
    expect(body.reads).toBe(147);
    expect(body.writes).toBe(27);
    expect(body.totalOperations).toBe(174);
    expect(body.planOperationsRemaining).toBe(199_826);
    expect(body.today).toEqual({ dayKey: "2026-09-10", reads: 7, writes: 2 });
    expect(body.perDay).toEqual([
      { day: "2026-09-10", reads: 7, writes: 2 },
      { day: "2026-09-09", reads: 100, writes: 20 },
      { day: "2026-09-08", reads: 40, writes: 5 },
    ]);
  });

  it("keeps the persisted high-water for today when the live counter is lower (restart)", () => {
    const state = getOpsMonthlyState();
    foldOpsCounterIntoMonthly(state, "2026-09-10", { reads: 1234, writes: 567 });
    const body = buildQueryConsumption(state, { reads: 0, writes: 0 }, 200_000);
    expect(body.today).toEqual({ dayKey: "2026-09-10", reads: 1234, writes: 567 });
    expect(body.reads).toBe(1234);
    expect(body.writes).toBe(567);
  });

  it("caps perDay at 31 entries, newest first", () => {
    const state = getOpsMonthlyState();
    for (let d = 1; d <= 35; d++) {
      foldOpsCounterIntoMonthly(state, `2026-09-${String(d).padStart(2, "0")}`, { reads: d, writes: 0 });
    }
    const body = buildQueryConsumption(state, { reads: 0, writes: 0 }, 200_000);
    expect(body.perDay).toHaveLength(31);
    expect(body.perDay[0].day).toBe("2026-09-35");
    for (let i = 1; i < body.perDay.length; i++) {
      expect(body.perDay[i - 1].day.localeCompare(body.perDay[i].day)).toBeGreaterThan(0);
    }
  });

  it("clamps planOperationsRemaining at zero once over the limit", () => {
    const state = getOpsMonthlyState();
    foldOpsCounterIntoMonthly(state, "2026-09-09", { reads: 150_000, writes: 60_000 });
    const body = buildQueryConsumption(state, { reads: 0, writes: 0 }, 200_000);
    expect(body.totalOperations).toBe(210_000);
    expect(body.planOperationsRemaining).toBe(0);
  });
});