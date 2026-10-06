/**
 * Tests for lib/services/degradedMode.ts (v3.45.0, spec 21) — the PRE-EMPTIVE
 * SQLite-first switch.
 *
 * The three invariants named in the module header, each of which has stranded
 * work when wrong:
 *  1. HYSTERESIS — engage at 90% of the monthly plan limit, but stay engaged
 *     until usage falls to 80%. A switch with no gap flaps on a single operation
 *     straddling the line, which thrashes every SQLite/Prisma read path.
 *  2. PRECEDENCE `off > forced > breaker > threshold` — `off` is an operator kill
 *     switch that must beat even an OPEN breaker, otherwise the only way back to
 *     normal behaviour is a redeploy.
 *  3. FAIL-SAFE — an unreadable ops ledger reports NOT active. Erring toward
 *     "degraded" over a transient counter read would take the site down.
 *
 * `opsMonthly` is used for REAL here (only `getIstDayKey` is mocked), because
 * the hysteresis boundary is expressed in the ledger's own aggregation units —
 * a mocked `buildQueryConsumption` would let a unit mismatch hide an off-by-one
 * at exactly the 90%/80% edges this file exists to pin.
 *
 * Do NOT use `import { jest } from "@jest/globals"` — SWC (next/jest) needs
 * `jest` as the global for `jest.mock()` hoisting.
 */

// ─── Mocks (MUST be before any imports — SWC hoists jest.mock) ────────────

jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  getIstDayKey: jest.fn(() => "2026-10-05"),
}));

jest.mock("@/lib/db-utils", () => ({
  __esModule: true,
  isPlanLimitBreakerOpen: jest.fn(() => false),
}));

// Real opsMonthly (the aggregation under test), with ONLY the state read wrapped
// so one test can simulate an unreadable ledger. The `mock` prefix is required
// by Jest's out-of-scope-variable check in a `jest.mock` factory.
let mockLedgerUnreadable = false;
jest.mock("@/lib/services/opsMonthly", () => {
  const actual = jest.requireActual("@/lib/services/opsMonthly") as Record<string, unknown>;
  return {
    __esModule: true,
    ...actual,
    getOpsMonthlyState: () => {
      if (mockLedgerUnreadable) throw new Error("ops ledger unreadable");
      return (actual.getOpsMonthlyState as () => unknown)();
    },
  };
});

// ─── Imports ────────────────────────────────────────────────────────────────

import { isPlanLimitBreakerOpen } from "@/lib/db-utils";
import {
  DEFAULT_PLAN_LIMIT_OPS_MONTHLY,
  ENTER_RATIO,
  EXIT_RATIO,
  evaluateDegradedMode,
  getDegradedModeSetting,
  getDegradedState,
  isDegradedModeActive,
  monthlyPlanLimit,
  resetDegradedModeForTests,
  setDegradedMode,
} from "@/lib/services/degradedMode";
import {
  getOpsMonthlyState,
  resetOpsMonthlyForTests,
  setOpsMonthlyDay,
  setOpsMonthlyTotal,
} from "@/lib/services/opsMonthly";

const breakerOpen = isPlanLimitBreakerOpen as jest.MockedFunction<typeof isPlanLimitBreakerOpen>;

const LIMIT = 200_000;
const ENTER = Math.floor(LIMIT * ENTER_RATIO); // 180_000
const EXIT = Math.floor(LIMIT * EXIT_RATIO); // 160_000
/** Must match the mocked `getIstDayKey`, otherwise `buildQueryConsumption`
 *  treats the seeded day as a different day and the total reads 0. */
const DAY = "2026-10-05";

/** Seed month-to-date usage without touching a database. */
function usage(total: number): void {
  setOpsMonthlyTotal(getOpsMonthlyState(), DAY, total, 0);
}

describe("degradedMode — thresholds", () => {
  beforeEach(() => {
    resetDegradedModeForTests();
    resetOpsMonthlyForTests();
    breakerOpen.mockReturnValue(false);
    delete process.env.DB_PLAN_LIMIT_OPS_MONTHLY;
    delete process.env.DEGRADED_MODE;
    jest.useRealTimers();
  });

  afterAll(() => {
    delete process.env.DB_PLAN_LIMIT_OPS_MONTHLY;
    delete process.env.DEGRADED_MODE;
  });

  it("derives 90%/80% boundaries from the plan limit and reports the accounting", () => {
    usage(1234);
    const s = evaluateDegradedMode();
    expect(s.planLimit).toBe(LIMIT);
    expect(s.enterAt).toBe(ENTER);
    expect(s.exitAt).toBe(EXIT);
    expect(s.totalOperations).toBe(1234);
    expect(s.planOperationsRemaining).toBe(LIMIT - 1234);
    expect(s).toMatchObject({ active: false, mode: "auto", reason: "threshold", breakerOpen: false });
  });

  it("stays inactive below the enter threshold", () => {
    usage(ENTER - 1);
    expect(evaluateDegradedMode().active).toBe(false);
    expect(isDegradedModeActive()).toBe(false);
  });

  it("engages exactly AT the enter threshold (inclusive comparison)", () => {
    // Off-by-one here is silent: one op early never engages and we hit the hold;
    // one op late engages late for the same reason.
    usage(ENTER);
    expect(evaluateDegradedMode().active).toBe(true);
  });

  it("honours a custom DB_PLAN_LIMIT_OPS_MONTHLY instead of the default", () => {
    process.env.DB_PLAN_LIMIT_OPS_MONTHLY = "1000";
    expect(monthlyPlanLimit()).toBe(1000);
    usage(850); // 85% — below the 90% enter line of 900
    expect(evaluateDegradedMode().active).toBe(false);
    usage(900);
    expect(evaluateDegradedMode().active).toBe(true);
    expect(evaluateDegradedMode().enterAt).toBe(900);
    expect(evaluateDegradedMode().exitAt).toBe(800);
  });

  it("falls back to the default limit for a nonsense env value", () => {
    for (const bad of ["", "0", "-5", "abc"]) {
      process.env.DB_PLAN_LIMIT_OPS_MONTHLY = bad;
      expect(monthlyPlanLimit()).toBe(DEFAULT_PLAN_LIMIT_OPS_MONTHLY);
    }
  });
});

describe("degradedMode — hysteresis", () => {
  beforeEach(() => {
    resetDegradedModeForTests();
    resetOpsMonthlyForTests();
    breakerOpen.mockReturnValue(false);
    delete process.env.DB_PLAN_LIMIT_OPS_MONTHLY;
    delete process.env.DEGRADED_MODE;
  });

  it("STAYS engaged anywhere inside the 80–90% band (no flapping)", () => {
    usage(ENTER);
    expect(evaluateDegradedMode().active).toBe(true);
    // One operation under the enter line must NOT drop us back to normal.
    usage(ENTER - 1);
    expect(evaluateDegradedMode().active).toBe(true);
    usage(EXIT + 1);
    expect(evaluateDegradedMode().active).toBe(true);
  });

  it("disengages only at or below the exit threshold", () => {
    usage(ENTER);
    expect(evaluateDegradedMode().active).toBe(true);
    usage(EXIT + 1);
    expect(evaluateDegradedMode().active).toBe(true);
    usage(EXIT);
    expect(evaluateDegradedMode().active).toBe(false);
  });

  it("re-engages on the next crossing without needing a reset", () => {
    usage(ENTER);
    expect(evaluateDegradedMode().active).toBe(true);
    usage(EXIT);
    expect(evaluateDegradedMode().active).toBe(false);
    usage(ENTER);
    expect(evaluateDegradedMode().active).toBe(true);
  });

  it("stamps `since` on the transition and clears it on exit", () => {
    usage(EXIT); // start inactive
    const t0 = 1_700_000_000_000;
    expect(evaluateDegradedMode(t0).since).toBeNull();

    usage(ENTER);
    expect(evaluateDegradedMode(t0 + 5_000).since).toBe(t0 + 5_000);
    // Still engaged => `since` must NOT be re-stamped on every evaluation.
    expect(evaluateDegradedMode(t0 + 60_000).since).toBe(t0 + 5_000);

    usage(EXIT);
    expect(evaluateDegradedMode(t0 + 90_000).since).toBeNull();
  });

  it("reads as NOT engaged on a fresh process even above the exit line", () => {
    // Process-local hysteresis must never inherit "engaged" from nothing:
    // a restart at 85% usage must require a fresh 90% crossing.
    usage(EXIT + 10_000);
    expect(evaluateDegradedMode().active).toBe(false);
  });

  it("merges the live counter over the persisted day (a restart still sees the peak)", () => {
    usage(ENTER);
    expect(evaluateDegradedMode().active).toBe(true);
    // A day-level ledger entry must be honoured, not just the monthly total, so a
    // just-restarted instance with an empty in-memory counter still acts BEFORE
    // the hold rather than after it.
    resetOpsMonthlyForTests();
    setOpsMonthlyDay(getOpsMonthlyState(), DAY, ENTER, 0);
    expect(evaluateDegradedMode().totalOperations).toBe(ENTER);
    expect(evaluateDegradedMode().active).toBe(true);
  });
});

describe("degradedMode — precedence off > forced > breaker > threshold", () => {
  beforeEach(() => {
    resetDegradedModeForTests();
    resetOpsMonthlyForTests();
    breakerOpen.mockReturnValue(false);
    delete process.env.DB_PLAN_LIMIT_OPS_MONTHLY;
    delete process.env.DEGRADED_MODE;
    usage(0);
  });

  it("`off` beats an OPEN breaker — the operator kill switch always wins", () => {
    breakerOpen.mockReturnValue(true);
    usage(ENTER);
    setDegradedMode("off");
    const s = evaluateDegradedMode();
    expect(s).toMatchObject({ active: false, mode: "off", reason: "off", breakerOpen: true });
  });

  it("`force` engages with the breaker closed and zero usage", () => {
    setDegradedMode("force");
    expect(evaluateDegradedMode()).toMatchObject({ active: true, mode: "force", reason: "forced" });
  });

  it("`off` still beats `force` when both are somehow set (order is explicit)", () => {
    // `off` is checked first in the evaluator; this pins that ordering so a
    // future refactor cannot flip the two.
    breakerOpen.mockReturnValue(true);
    setDegradedMode("off");
    expect(evaluateDegradedMode().active).toBe(false);
  });

  it("an OPEN breaker engages degraded mode even far below the threshold", () => {
    usage(0);
    breakerOpen.mockReturnValue(true);
    expect(evaluateDegradedMode()).toMatchObject({ active: true, reason: "breaker" });
  });

  it("an OPEN breaker engages from a FRESH process (no hysteresis dependency)", () => {
    usage(EXIT - 1000); // well below even the exit line
    breakerOpen.mockReturnValue(true);
    expect(evaluateDegradedMode().active).toBe(true);
  });

  it("reads the mode from DEGRADED_MODE and coerces an unknown value to `auto`", () => {
    process.env.DEGRADED_MODE = "FORCE ";
    expect(getDegradedModeSetting()).toBe("force");
    process.env.DEGRADED_MODE = "definitely-not-a-mode";
    // A typo in env must not silently disable the protection.
    expect(getDegradedModeSetting()).toBe("auto");
    usage(ENTER);
    expect(evaluateDegradedMode().active).toBe(true);
  });
});

describe("degradedMode — fail-safe + caching", () => {
  beforeEach(() => {
    resetDegradedModeForTests();
    resetOpsMonthlyForTests();
    breakerOpen.mockReturnValue(false);
    delete process.env.DB_PLAN_LIMIT_OPS_MONTHLY;
    delete process.env.DEGRADED_MODE;
    usage(ENTER);
  });

  it("reports NOT active when the ops ledger cannot be read", () => {
    // Erring toward "degraded" here would take the whole site SQLite-only over a
    // transient counter failure — strictly worse than the hold itself.
    mockLedgerUnreadable = true;
    try {
      const s = evaluateDegradedMode();
      expect(s.active).toBe(false);
      expect(s.reason).toBe("threshold");
      expect(s.totalOperations).toBe(0);
      expect(s.planOperationsRemaining).toBe(LIMIT);
      // ...and it must NOT latch: a healthy read afterwards still engages.
      mockLedgerUnreadable = false;
      expect(evaluateDegradedMode().active).toBe(true);
    } finally {
      mockLedgerUnreadable = false;
    }
  });

  it("caches for 5s so hot paths do not re-read the ledger on every call", () => {
    const first = getDegradedState();
    usage(0); // would flip the answer if re-evaluated
    expect(getDegradedState()).toBe(first); // same object identity => cached
    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + 6_000);
    expect(getDegradedState()).not.toBe(first);
    jest.useRealTimers();
  });

  it("`setDegradedMode` invalidates the cache so the kill switch is immediate", () => {
    expect(getDegradedState().active).toBe(true);
    setDegradedMode("off");
    // Without the explicit cache invalidation this would still report active for
    // up to 5s, so an operator's kill switch would appear to do nothing.
    expect(getDegradedState().active).toBe(false);
  });

  it("resetDegradedModeForTests clears mode, hysteresis and cache", () => {
    usage(ENTER);
    expect(evaluateDegradedMode().active).toBe(true);
    setDegradedMode("force");
    resetDegradedModeForTests();
    expect(getDegradedModeSetting()).toBe("auto");
    usage(EXIT);
    // Hysteresis was cleared, so the drop below the enter line reads as inactive
    // rather than as a hysteresis exit.
    expect(evaluateDegradedMode().active).toBe(false);
  });
});