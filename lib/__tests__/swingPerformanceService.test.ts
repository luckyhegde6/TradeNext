/**
 * Tests for swingPerformanceService (v3.14.0) — the swing-signal leg of the
 * daily performance check:
 *
 *   - evaluateSwingSignalStatus(): pure, direction-aware status evaluator
 *     (target/stop crossing + 45-day expiry, SELL inverts the comparisons)
 *   - checkSwingPerformance(): DB path — batch DISTINCT ON daily_prices,
 *     per-signal updates, status-flip + run-level audits, live-quote bridge
 *     for symbols missing price rows, and safe skips for unresolvable prices
 *
 * The prisma client is mocked (findMany/$queryRaw/update) and the live-quote
 * bridge (getStockQuote) is stubbed — no network or DB in these tests.
 */

// ─── Mocks (MUST be before any imports — SWC hoists jest.mock) ─────────

jest.mock("@/lib/logger", () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return {
    __esModule: true,
    default: mock,
    info: mock.info,
    warn: mock.warn,
    error: mock.error,
    debug: mock.debug,
  };
});

jest.mock("@/lib/audit", () => ({
  __esModule: true,
  createAuditLog: jest.fn(async () => {}),
}));

jest.mock("@/lib/prisma", () => {
  const mock = {
    swingSignal: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };
  return { __esModule: true, default: mock };
});

jest.mock("@/lib/stock-service", () => ({
  getStockQuote: jest.fn(),
}));

jest.mock("@/lib/services/unifiedEventService", () => ({
  __esModule: true,
  recordSystemEvent: jest.fn(async () => {}),
}));

jest.mock("@/lib/services/systemHealthService", () => ({
  __esModule: true,
  recordMetric: jest.fn(async () => {}),
}));

// ─── Imports ──────────────────────────────────────────────────────────────

import {
  SWING_EXPIRY_DAYS,
  evaluateSwingSignalStatus,
  checkSwingPerformance,
} from "@/lib/services/swingPerformanceService";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const prisma = require("@/lib/prisma").default as {
  swingSignal: {
    findMany: jest.Mock;
    update: jest.Mock;
  };
  $queryRaw: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getStockQuote } = require("@/lib/stock-service") as { getStockQuote: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createAuditLog } = require("@/lib/audit") as { createAuditLog: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { recordSystemEvent } = require("@/lib/services/unifiedEventService") as {
  recordSystemEvent: jest.Mock;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function makeSignal(overrides: Record<string, unknown> = {}) {
  return {
    id: "sig-1",
    jobId: "job-1",
    symbol: "RELIANCE",
    status: "active",
    price: 2500,
    aiRecommendation: "BUY",
    targetPrice: 2750,
    stopLoss: 2375,
    currentPrice: null,
    returnPercent: null,
    lastCheckedAt: null,
    postedAt: new Date("2026-08-15T10:00:00.000Z"),
    createdAt: new Date("2026-08-15T10:00:00.000Z"),
    updatedAt: new Date("2026-08-15T10:00:00.000Z"),
    ...overrides,
  };
}

// ─── evaluateSwingSignalStatus (pure) ──────────────────────────────────────

describe("evaluateSwingSignalStatus", () => {
  it("marks BUY target_achieved when the price reaches the target", () => {
    const r = evaluateSwingSignalStatus({
      aiRecommendation: "BUY",
      targetPrice: 2750,
      stopLoss: 2375,
      currentPrice: 2800,
      postedDaysAgo: 1,
    });
    expect(r.status).toBe("target_achieved");
    expect(r.reason).toContain("2800");
  });

  it("marks BUY stop_loss_hit when the price falls to the stop", () => {
    const r = evaluateSwingSignalStatus({
      aiRecommendation: "BUY",
      targetPrice: 2750,
      stopLoss: 2375,
      currentPrice: 2300,
      postedDaysAgo: 1,
    });
    expect(r.status).toBe("stop_loss_hit");
  });

  it("inverts the comparisons for SELL (target below, stop above)", () => {
    // SELL posted at 2500: target 2300 (below), stop 2600 (above).
    const target = evaluateSwingSignalStatus({
      aiRecommendation: "SELL",
      targetPrice: 2300,
      stopLoss: 2600,
      currentPrice: 2200,
      postedDaysAgo: 1,
    });
    expect(target.status).toBe("target_achieved");

    const stop = evaluateSwingSignalStatus({
      aiRecommendation: "SELL",
      targetPrice: 2300,
      stopLoss: 2600,
      currentPrice: 2700,
      postedDaysAgo: 1,
    });
    expect(stop.status).toBe("stop_loss_hit");

    // Inside the window → still active.
    const inside = evaluateSwingSignalStatus({
      aiRecommendation: "SELL",
      targetPrice: 2300,
      stopLoss: 2600,
      currentPrice: 2500,
      postedDaysAgo: 1,
    });
    expect(inside.status).toBe("active");
  });

  it("target wins over stop on a tie", () => {
    const r = evaluateSwingSignalStatus({
      aiRecommendation: "BUY",
      targetPrice: 2500,
      stopLoss: 2500,
      currentPrice: 2500,
      postedDaysAgo: 1,
    });
    expect(r.status).toBe("target_achieved");
  });

  it("expires when postedDaysAgo reaches the 45-day default", () => {
    const r = evaluateSwingSignalStatus({
      aiRecommendation: "BUY",
      targetPrice: 2750,
      stopLoss: 2375,
      currentPrice: 2600,
      postedDaysAgo: SWING_EXPIRY_DAYS,
    });
    expect(r.status).toBe("expired");
  });

  it("respects a custom expiryDays override", () => {
    const r = evaluateSwingSignalStatus({
      aiRecommendation: "BUY",
      targetPrice: 2750,
      stopLoss: 2375,
      currentPrice: 2600,
      postedDaysAgo: 10,
      expiryDays: 7,
    });
    expect(r.status).toBe("expired");
  });

  it("stays active inside the window even after a big price move", () => {
    const r = evaluateSwingSignalStatus({
      aiRecommendation: "BUY",
      targetPrice: 2750,
      stopLoss: 2375,
      currentPrice: 2600,
      postedDaysAgo: 1,
    });
    expect(r.status).toBe("active");
  });

  it("signals without levels can only expire (never a crossing verdict)", () => {
    const moved = evaluateSwingSignalStatus({
      aiRecommendation: "BUY",
      targetPrice: null,
      stopLoss: null,
      currentPrice: 5000,
      postedDaysAgo: 1,
    });
    expect(moved.status).toBe("active"); // no target/stop → nothing crossed

    const expired = evaluateSwingSignalStatus({
      aiRecommendation: "BUY",
      targetPrice: null,
      stopLoss: null,
      currentPrice: 5000,
      postedDaysAgo: SWING_EXPIRY_DAYS,
    });
    expect(expired.status).toBe("expired");
  });

  it("treats zero/negative target or stop as absent", () => {
    const r = evaluateSwingSignalStatus({
      aiRecommendation: "BUY",
      targetPrice: 0,
      stopLoss: -1,
      currentPrice: 9999,
      postedDaysAgo: 1,
    });
    expect(r.status).toBe("active"); // no valid level crossed
  });
});

// ─── checkSwingPerformance (DB path) ───────────────────────────────────────

describe("checkSwingPerformance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.swingSignal.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.swingSignal.update.mockResolvedValue({});
    getStockQuote.mockResolvedValue({ lastPrice: 2600 });
  });

  it("returns zeros and audits the run when no active signals exist", async () => {
    const result = await checkSwingPerformance();

    expect(result).toEqual({
      checked: 0,
      targetAchieved: 0,
      stopLossHit: 0,
      expired: 0,
      updated: 0,
      executionTimeMs: 0,
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.swingSignal.update).not.toHaveBeenCalled();
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SWING_PERFORMANCE_CHECK",
        metadata: expect.objectContaining({ checked: 0 }),
      }),
    );
  });

  it("flips a BUY signal to target_achieved and refreshes price + return", async () => {
    prisma.swingSignal.findMany.mockResolvedValue([makeSignal()]);
    prisma.$queryRaw.mockResolvedValue([{ ticker: "RELIANCE", close: 2800 }]);

    const result = await checkSwingPerformance();

    expect(result).toEqual(
      expect.objectContaining({
        checked: 1,
        targetAchieved: 1,
        stopLossHit: 0,
        expired: 0,
        updated: 1,
      }),
    );
    expect(prisma.swingSignal.update).toHaveBeenCalledWith({
      where: { id: "sig-1" },
      data: expect.objectContaining({
        status: "target_achieved",
        currentPrice: 2800,
        returnPercent: expect.closeTo((2800 - 2500) / 2500 * 100, 5),
        lastCheckedAt: expect.any(Date),
      }),
    });

    // Status flip is audit-logged with full metadata.
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SWING_SIGNAL_STATUS_CHANGED",
        resourceId: "sig-1",
        metadata: expect.objectContaining({
          symbol: "RELIANCE",
          jobId: "job-1",
          previousStatus: "active",
          newStatus: "target_achieved",
          currentPrice: 2800,
          reason: expect.stringContaining("crossed target"),
        }),
      }),
    );
    // Run-level audit + system event recorded once.
    const actions = createAuditLog.mock.calls.map((c) => c[0].action);
    expect(actions.filter((a: string) => a === "SWING_PERFORMANCE_CHECK")).toHaveLength(1);
    expect(recordSystemEvent).toHaveBeenCalled();
  });

  it("flips a SELL signal direction-aware (price fell to its below target)", async () => {
    prisma.swingSignal.findMany.mockResolvedValue([
      makeSignal({ symbol: "HDFCBANK", aiRecommendation: "SELL", targetPrice: 2300, stopLoss: 2600 }),
    ]);
    prisma.$queryRaw.mockResolvedValue([{ ticker: "HDFCBANK", close: 2200 }]);

    const result = await checkSwingPerformance();
    expect(result.targetAchieved).toBe(1);
    expect(prisma.swingSignal.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "target_achieved" }) }),
    );
  });

  it("marks a stop_loss_hit when the price crosses the stop", async () => {
    prisma.swingSignal.findMany.mockResolvedValue([makeSignal()]);
    prisma.$queryRaw.mockResolvedValue([{ ticker: "RELIANCE", close: 2300 }]);

    const result = await checkSwingPerformance();
    expect(result.stopLossHit).toBe(1);
    expect(prisma.swingSignal.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "stop_loss_hit" }) }),
    );
  });

  it("expires signals 45+ days old even without a level crossing", async () => {
    const old = new Date(Date.now() - SWING_EXPIRY_DAYS * DAY_MS - 60 * 60 * 1000);
    prisma.swingSignal.findMany.mockResolvedValue([makeSignal({ postedAt: old })]);
    prisma.$queryRaw.mockResolvedValue([{ ticker: "RELIANCE", close: 2600 }]);

    const result = await checkSwingPerformance();
    expect(result.expired).toBe(1);
    expect(prisma.swingSignal.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "expired" }) }),
    );
  });

  it("keeps an in-window signal active and refreshes price WITHOUT touching status", async () => {
    prisma.swingSignal.findMany.mockResolvedValue([makeSignal()]);
    prisma.$queryRaw.mockResolvedValue([{ ticker: "RELIANCE", close: 2600 }]);

    const result = await checkSwingPerformance();
    expect(result.checked).toBe(1);
    expect(result.expired).toBe(0);
    expect(prisma.swingSignal.update).toHaveBeenCalledWith({
      where: { id: "sig-1" },
      data: {
        currentPrice: 2600,
        returnPercent: expect.closeTo(4, 5),
        lastCheckedAt: expect.any(Date),
      },
    });
    // No status key → status stays "active" in the DB.
    expect(prisma.swingSignal.update.mock.calls[0][0].data.status).toBeUndefined();
  });

  it("skips signals with no resolvable price (no update, not counted)", async () => {
    prisma.swingSignal.findMany.mockResolvedValue([makeSignal()]);
    prisma.$queryRaw.mockResolvedValue([]); // no daily_prices rows
    getStockQuote.mockResolvedValue(null); // and no live quote

    const result = await checkSwingPerformance();
    expect(result).toEqual(
      expect.objectContaining({ checked: 0, targetAchieved: 0, stopLossHit: 0, expired: 0, updated: 0 }),
    );
    expect(prisma.swingSignal.update).not.toHaveBeenCalled();
  });

  it("bridges missing symbols with a live quote when daily_prices has no rows", async () => {
    prisma.swingSignal.findMany.mockResolvedValue([makeSignal()]);
    prisma.$queryRaw.mockResolvedValue([]);
    getStockQuote.mockResolvedValue({ lastPrice: 2700 });

    const result = await checkSwingPerformance();
    expect(getStockQuote).toHaveBeenCalledWith("RELIANCE", false);
    expect(result.checked).toBe(1);
    expect(prisma.swingSignal.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currentPrice: 2700 }) }),
    );
  });

  it("contains the live-quote bridge when getStockQuote throws", async () => {
    prisma.swingSignal.findMany.mockResolvedValue([makeSignal()]);
    prisma.$queryRaw.mockResolvedValue([]);
    getStockQuote.mockRejectedValue(new Error("NSE 419"));

    const result = await checkSwingPerformance();
    // Bridge failure → price unresolvable → signal skipped, run still completes.
    expect(result.checked).toBe(0);
    expect(prisma.swingSignal.update).not.toHaveBeenCalled();
  });
});
