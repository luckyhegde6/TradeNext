/* @jest-environment node */

import { POST } from "@/app/api/backtest/run/route";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { runBacktest } from "@/lib/screener/backtest-engine";
import { getBacktestData } from "@/lib/services/backtestDataService";
import logger from "@/lib/logger";

// Route-level harness — mock the DB, auth, the data chain and the engine so
// the tests exercise ONLY the softened symbol-presence gate (= symbolSource
// derivation, no 404) and the barCount guard.
jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    symbol: { findUnique: jest.fn() },
    backtestRun: { create: jest.fn() },
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/screener/backtest-engine", () => ({ runBacktest: jest.fn() }));
jest.mock("@/lib/services/backtestDataService", () => ({ getBacktestData: jest.fn() }));
jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockAuth = jest.mocked(auth);
const mockPrisma = jest.mocked(prisma);
const mockRunBacktest = jest.mocked(runBacktest);
const mockGetBacktestData = jest.mocked(getBacktestData);
const mockLogger = logger as unknown as { info: jest.Mock; warn: jest.Mock; error: jest.Mock };

const basePayload = {
  symbol: "RBLBANK",
  entryFilter: {
    id: "g1",
    logic: "AND" as const,
    conditions: [
      { id: "c1", field: "close", fieldLabel: "Close", condition: { operator: "gt", value: 100 } },
    ],
    groups: [],
  },
  initialCapital: 100000,
  profitTarget: 10,
  stopLoss: 5,
  trailingStop: 5,
  maxHoldingBars: 20,
};

const enoughBars = {
  barCount: 250,
  ohlcv: [],
  rangeStart: "2026-01-01",
  rangeEnd: "2026-06-30",
  source: "memory",
};

const fewBars = { ...enoughBars, barCount: 30 };

const mockRunResult = {
  metrics: {
    totalTrades: 12,
    winRate: 58.3,
    totalReturn: 12400,
    totalReturnPercent: 12.4,
    maxDrawdownPercent: 4.2,
    sharpeRatio: 1.1,
  },
  trades: [],
  barCount: 250,
};

const mockRunRow = {
  id: 123,
  name: "Backtest: RBLBANK",
  status: "completed",
  totalTrades: 12,
  winRate: 58.3,
  totalPnl: 12400,
  maxDrawdown: 4.2,
  sharpeRatio: 1.1,
  trades: [],
};

const callRoute = (payload: unknown = basePayload) =>
  POST(
    new Request("http://localhost/api/backtest/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );

describe("POST /api/backtest/run — symbol-presence gate softening", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "7" } } as never);
    mockRunBacktest.mockReturnValue(mockRunResult as never);
    mockGetBacktestData.mockResolvedValue(enoughBars as never);
    mockPrisma.backtestRun.create.mockResolvedValue(mockRunRow as never);
  });

  it("unlisted symbol (no static-table row) with enough bars → 200 + symbolSource unlisted (no 404)", async () => {
    mockPrisma.symbol.findUnique.mockResolvedValue(null);

    const res = await callRoute();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.symbolSource).toBe("unlisted");
    expect(body.dataSource).toBe("memory");
    expect(body.barCount).toBe(250);
    expect(mockRunBacktest).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: "Backtest fall-through: symbol not in static table, using data chain", symbol: "RBLBANK" }),
    );
  });

  it("unlisted symbol with fewer than 50 bars → 400 (the only no-data failure)", async () => {
    mockPrisma.symbol.findUnique.mockResolvedValue(null);
    mockGetBacktestData.mockResolvedValue(fewBars as never);

    const res = await callRoute();
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(String(body.error)).toContain("Insufficient historical data");
    expect(mockRunBacktest).not.toHaveBeenCalled();
    expect(mockPrisma.backtestRun.create).not.toHaveBeenCalled();
  });

  it("listed symbol → 200 + symbolSource known", async () => {
    mockPrisma.symbol.findUnique.mockResolvedValue({ symbol: "RBLBANK" } as never);

    const res = await callRoute();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.symbolSource).toBe("known");
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("unauthenticated request → 401", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await callRoute();

    expect(res.status).toBe(401);
    expect(mockPrisma.symbol.findUnique).not.toHaveBeenCalled();
  });
});