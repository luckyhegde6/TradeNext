/**
 * Unit tests for the `metrics` tab encoder + KPI math (Spec 20).
 *
 * Two layers, deliberately:
 *   1. `computeMetrics` is PURE, so every branch of the outcome/outcome math is
 *      tested directly with no database.
 *   2. `metricsRow` is a POSITIONAL contract, so the 11 columns are asserted by
 *      index. A column that silently moves is exactly the kind of break that
 *      would corrupt a user's existing sheet, and an index assertion is the only
 *      thing that catches it.
 *
 * The ratio columns are the subtle part: each is `number | null`, and the tests
 * pin WHICH state produces null (see the file header in metricsService.ts) so a
 * refactor cannot quietly turn "not computable" into a confident 0.
 */
import prisma from "@/lib/prisma";
import { isDbUnavailableError, isPlanLimitBreakerOpen } from "@/lib/db-utils";
import { computeMetrics, getMetrics, type TrackedPick } from "@/lib/services/googleSheets/metricsService";
import { metricsRow, type MetricsRowInput } from "@/lib/services/googleSheets/rows";

// `metricsService` imports Prisma at module load. The math is pure, so the DB is
// stubbed out here — the only test that uses it is the degraded-path suite, and
// stubbing keeps this file runnable with no DATABASE_URL.
jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: { recommendationTracker: { findMany: jest.fn() } },
}));
// The breaker check must not short-circuit the happy path; the plan-limit case
// is driven explicitly below.
jest.mock("@/lib/db-utils", () => ({
  isPlanLimitBreakerOpen: jest.fn(() => false),
  isDbUnavailableError: jest.fn(() => false),
}));

const AT = "2026-09-26T04:30:00.000Z";

/** Minimal closed pick; only the fields the math reads. */
function pick(over: Partial<TrackedPick> = {}): TrackedPick {
  return {
    status: "active",
    entryPrice: 100,
    currentPrice: 110,
    targetPrice: 120,
    stopLoss: 95,
    ...over,
  };
}

describe("computeMetrics — lifecycle counts", () => {
  it("counts every outcome status", () => {
    const m = computeMetrics(
      [
        pick({ status: "active" }),
        pick({ status: "active" }),
        pick({ status: "target_achieved" }),
        pick({ status: "stop_loss_hit" }),
        pick({ status: "expired" }),
      ],
      AT,
    );
    expect(m.totalTracked).toBe(5);
    expect(m.active).toBe(2);
    expect(m.targetAchieved).toBe(1);
    expect(m.stopLossHit).toBe(1);
    expect(m.expired).toBe(1);
  });

  it("returns an all-zero snapshot (with null ratios) for no picks", () => {
    const m = computeMetrics([], AT);
    expect(m).toEqual({
      snapshotAt: AT,
      totalTracked: 0,
      active: 0,
      targetAchieved: 0,
      stopLossHit: 0,
      expired: 0,
      winRate: null,
      netPnlAbs: 0,
      netPnlPct: null,
      avgReturnPct: null,
      grossPnlAbs: 0,
    });
  });

  it("echoes the pinned snapshotAt rather than reading the clock", () => {
    expect(computeMetrics([pick()], AT).snapshotAt).toBe(AT);
  });

  it("does not count an unrecognised status as any known outcome", () => {
    // A new status added to the tracker must not silently land in a bucket.
    const m = computeMetrics([pick({ status: "archived_v2" })], AT);
    expect(m.totalTracked).toBe(1);
    expect(m.active).toBe(0);
    expect(m.targetAchieved + m.stopLossHit + m.expired).toBe(0);
    expect(m.netPnlAbs).toBe(0);
  });
});

describe("computeMetrics — win rate", () => {
  it("is null when nothing has been decided", () => {
    expect(computeMetrics([pick({ status: "active" })], AT).winRate).toBeNull();
  });

  it("is a percentage 0..100, not a 0..1 fraction", () => {
    // 1 win, 1 stop loss -> 50 (not 0.5). The unit matters: a fraction here
    // would render "0.5%" in the sheet and silently disagree with the
    // portfolio winRate column the user already knows.
    expect(computeMetrics([pick({ status: "target_achieved" }), pick({ status: "stop_loss_hit" })], AT).winRate).toBe(50);
  });

  it("excludes expired picks from the denominator", () => {
    // 1 win, 1 loss, 4 expired -> 50%, not 1/6 = 16.67%. Time running out is
    // not a loss; counting it would understate accuracy for long horizons.
    const picks = [
      pick({ status: "target_achieved" }),
      pick({ status: "stop_loss_hit" }),
      ...Array.from({ length: 4 }, () => pick({ status: "expired" })),
    ];
    expect(computeMetrics(picks, AT).winRate).toBe(50);
  });

  it("is 100 with only wins and is 0 with only losses", () => {
    expect(computeMetrics([pick({ status: "target_achieved" }), pick({ status: "target_achieved" })], AT).winRate).toBe(100);
    expect(computeMetrics([pick({ status: "stop_loss_hit" })], AT).winRate).toBe(0);
  });

  it("rounds to 2dp", () => {
    // 1 win / 3 decided = 33.333... -> 33.33
    const picks = [
      pick({ status: "target_achieved" }),
      pick({ status: "stop_loss_hit" }),
      pick({ status: "stop_loss_hit" }),
    ];
    expect(computeMetrics(picks, AT).winRate).toBe(33.33);
  });
});

describe("computeMetrics — P&L", () => {
  it("realises a target at targetPrice, not the later currentPrice", () => {
    // currentPrice 500 must not inflate a closed +20 rupee pick.
    const m = computeMetrics(
      [pick({ status: "target_achieved", entryPrice: 100, targetPrice: 120, currentPrice: 500 })],
      AT,
    );
    expect(m.netPnlAbs).toBe(20);
    expect(m.avgReturnPct).toBe(20);
  });

  it("realises a stop loss at the stopLoss price", () => {
    const m = computeMetrics([pick({ status: "stop_loss_hit", entryPrice: 100, stopLoss: 90, currentPrice: 500 })], AT);
    expect(m.netPnlAbs).toBe(-10);
    expect(m.avgReturnPct).toBe(-10);
  });

  it("realises an expired pick at its last known price", () => {
    const m = computeMetrics([pick({ status: "expired", entryPrice: 100, currentPrice: 108 })], AT);
    expect(m.netPnlAbs).toBe(8);
    expect(m.avgReturnPct).toBe(8);
  });

  it("excludes an expired pick with no known price from P&L entirely", () => {
    // Unknown outcome != break-even: skipping it keeps gross and net honest.
    const m = computeMetrics([pick({ status: "expired", entryPrice: 100, currentPrice: null })], AT);
    expect(m.netPnlAbs).toBe(0);
    expect(m.grossPnlAbs).toBe(0);
    expect(m.avgReturnPct).toBeNull();
  });

  it("excludes active picks from P&L", () => {
    const m = computeMetrics([pick({ status: "active", entryPrice: 100, currentPrice: 400 })], AT);
    expect(m.netPnlAbs).toBe(0);
    expect(m.grossPnlAbs).toBe(0);
    expect(m.netPnlPct).toBeNull();
  });

  it("gross is the sum of absolute P&L, net is the signed sum", () => {
    // +20 and -10 -> net +10, gross 30. Net alone would hide the churn.
    const m = computeMetrics(
      [pick({ status: "target_achieved", entryPrice: 100, targetPrice: 120 }), pick({ status: "stop_loss_hit", entryPrice: 100, stopLoss: 90 })],
      AT,
    );
    expect(m.netPnlAbs).toBe(10);
    expect(m.grossPnlAbs).toBe(30);
  });

  it("netPnlPct is return on deployed capital, not the mean of returns", () => {
    // +100 on 100 capital (+100%) and +0 on 900 capital (0%) -> +100/1000 = 10%.
    // The naive mean of the two returns would say 50%.
    const m = computeMetrics(
      [
        pick({ status: "target_achieved", entryPrice: 100, targetPrice: 200 }),
        pick({ status: "target_achieved", entryPrice: 900, targetPrice: 900 }),
      ],
      AT,
    );
    expect(m.netPnlPct).toBe(10);
    expect(m.avgReturnPct).toBe(50);
  });

  it("ignores a non-positive entry price in the return and capital sums", () => {
    // Guards a divide-by-zero: entry 0 must not poison avgReturnPct with NaN/Infinity.
    // The zero-entry pick still REALISES its +10 P&L (it closed at target), but it
    // contributes neither capital nor a percentage return, so it can push
    // netPnlPct above any single pick's return. That is the documented
    // consequence of excluding a non-positive entry from the capital base.
    const m = computeMetrics(
      [
        pick({ status: "target_achieved", entryPrice: 0, targetPrice: 10 }),
        pick({ status: "target_achieved", entryPrice: 100, targetPrice: 110 }),
      ],
      AT,
    );
    expect(m.netPnlAbs).toBe(20); // both picks realised
    expect(m.avgReturnPct).toBe(10); // only the priced pick has a return
    expect(m.netPnlPct).toBe(20); // 20 realised over 100 of capital
  });

  it("keeps net and gross exact to 2dp against float error", () => {
    // 0.1 + 0.2 style drift: three thirds of a rupee must not leak a long tail.
    const m = computeMetrics(
      [
        pick({ status: "target_achieved", entryPrice: 100, targetPrice: 100.1 }),
        pick({ status: "target_achieved", entryPrice: 100, targetPrice: 100.2 }),
        pick({ status: "target_achieved", entryPrice: 100, targetPrice: 100.3 }),
      ],
      AT,
    );
    expect(m.netPnlAbs).toBe(0.6);
    expect(m.grossPnlAbs).toBe(0.6);
  });
});

describe("metricsRow — positional contract", () => {
  const snapshot: MetricsRowInput = {
    snapshotAt: AT,
    totalTracked: 40,
    active: 10,
    targetAchieved: 20,
    stopLossHit: 7,
    expired: 3,
    winRate: 74.07,
    netPnlAbs: 1234.5,
    netPnlPct: 3.21,
    avgReturnPct: 4.44,
    grossPnlAbs: 2000.75,
  };

  it("has exactly 11 columns, matching the metrics header count", () => {
    expect(metricsRow(snapshot)).toHaveLength(11);
  });

  it("lays each value out at its header position", () => {
    // Asserted by index on purpose: the sheet contract is positional, so a
    // reordering is a silent data-corruption bug for any existing user sheet.
    expect(metricsRow(snapshot)).toEqual([
      "2026-09-26T04:30:00.000Z", // snapshotAt
      "40", // totalTracked
      "10", // active
      "20", // targetAchieved
      "7", // stopLossHit
      "3", // expired
      "74.07", // winRate
      "1234.5", // netPnlAbs
      "3.21", // netPnlPct
      "4.44", // avgReturnPct
      "2000.75", // grossPnlAbs
    ]);
  });

  it("renders every null ratio as an empty cell, never 0", () => {
    const row = metricsRow({
      ...snapshot,
      winRate: null,
      netPnlPct: null,
      avgReturnPct: null,
      // Genuine zeros sit in the same columns and must survive as "0".
      netPnlAbs: 0,
      grossPnlAbs: 0,
    });
    expect(row[6]).toBe(""); // winRate
    expect(row[8]).toBe(""); // netPnlPct
    expect(row[9]).toBe(""); // avgReturnPct
    // 0 and "not computable" must stay distinguishable in the sheet.
    expect(row[7]).toBe("0"); // netPnlAbs
    expect(row[10]).toBe("0"); // grossPnlAbs
  });

  it("round-trips a computed snapshot with no empty numeric cells", () => {
    const m = computeMetrics([pick({ status: "target_achieved" }), pick({ status: "stop_loss_hit" })], AT);
    const row = metricsRow(m);
    expect(row).toHaveLength(11);
    expect(row.every((c) => c !== "")).toBe(true);
    expect(row[6]).toBe("50");
  });
});

describe("getMetrics — degraded paths never masquerade as zero", () => {
  // Lesson 138: a masked failure rendered as a data row is worse than an error,
  // because a KPI snapshot is something the user appends to their own sheet.
  const findMany = prisma.recommendationTracker.findMany as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    (isPlanLimitBreakerOpen as jest.Mock).mockReturnValue(false);
    (isDbUnavailableError as jest.Mock).mockReturnValue(false);
  });

  it("returns a snapshot on the happy path", async () => {
    findMany.mockResolvedValue([
      { status: "target_achieved", entryPrice: 100, currentPrice: 130, targetPrice: 120, stopLoss: 95 },
    ]);
    const res = await getMetrics();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.snapshot.targetAchieved).toBe(1);
      expect(res.snapshot.netPnlAbs).toBe(20);
      expect(res.snapshot.snapshotAt).toEqual(expect.any(String));
    }
  });

  it("reports db_unavailable instead of throwing when the plan-limit breaker is open", async () => {
    (isPlanLimitBreakerOpen as jest.Mock).mockReturnValue(true);
    // Must not even touch the DB while the breaker is open.
    await expect(getMetrics()).resolves.toEqual({ ok: false, reason: "db_unavailable" });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("maps an unavailable-DB error to db_unavailable", async () => {
    findMany.mockRejectedValue(new Error("P6003 hold on your account. Reason: planLimitReached"));
    (isDbUnavailableError as jest.Mock).mockReturnValue(true);
    await expect(getMetrics()).resolves.toEqual({ ok: false, reason: "db_unavailable" });
  });

  it("maps any other error to a generic error, still not a fake snapshot", async () => {
    findMany.mockRejectedValue(new Error("boom"));
    const res = await getMetrics();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("error");
  });
});
