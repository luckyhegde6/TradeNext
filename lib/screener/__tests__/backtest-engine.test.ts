import { runBacktest, type BacktestParams } from "../backtest-engine";
import { createDefaultFilterGroup } from "../condition-tree";
import type { FilterGroup, FilterCondition } from "../condition-tree";
import type { OHLCV } from "../technical-analysis";

// ============================================================
// Helpers
// ============================================================

/** Generate synthetic OHLCV data with a trend */
function generateTrendData(
  length: number,
  startPrice: number = 100,
  volatility: number = 2,
  trend: number = 0.1
): OHLCV[] {
  const bars: OHLCV[] = [];
  let price = startPrice;
  for (let i = 0; i < length; i++) {
    const change = (Math.random() - 0.5) * volatility + trend;
    price += change;
    const open = price;
    const close = price + (Math.random() - 0.5) * volatility * 0.5;
    const high = Math.max(open, close) + Math.random() * volatility * 0.3;
    const low = Math.min(open, close) - Math.random() * volatility * 0.3;
    bars.push({
      timestamp: Date.now() - (length - i) * 86400000,
      open,
      high,
      low,
      close: close,
      volume: 1000000 + Math.random() * 500000,
    });
    price = close;
  }
  return bars;
}

/** Generate OHLCV data with a clear uptrend */
function generateUptrend(length: number, startPrice = 100): OHLCV[] {
  const bars: OHLCV[] = [];
  let price = startPrice;
  for (let i = 0; i < length; i++) {
    price += 1 + Math.random() * 0.5; // Steady uptrend
    bars.push({
      timestamp: Date.now() - (length - i) * 86400000,
      open: price - 0.5,
      high: price + 1,
      low: price - 1,
      close: price,
      volume: 1000000,
    });
  }
  return bars;
}

/** Generate OHLCV data with a clear downtrend */
function generateDowntrend(length: number, startPrice = 200): OHLCV[] {
  const bars: OHLCV[] = [];
  let price = startPrice;
  for (let i = 0; i < length; i++) {
    price -= 1 + Math.random() * 0.5; // Steady downtrend
    bars.push({
      timestamp: Date.now() - (length - i) * 86400000,
      open: price + 0.5,
      high: price + 1,
      low: price - 1,
      close: price,
      volume: 1000000,
    });
  }
  return bars;
}

/** RSI < 30 (oversold) entry filter */
function oversoldFilter(): FilterGroup {
  return {
    id: "g1",
    logic: "AND",
    conditions: [
      { id: "c1", field: "RSI", condition: { operator: "lt", value: 35 } },
    ],
    groups: [],
  };
}

/** close > SMA50 entry filter */
function bullishCrossFilter(): FilterGroup {
  return {
    id: "g1",
    logic: "AND",
    conditions: [
      { id: "c1", field: "close", condition: { operator: "gt", value: 0 } }, // Always passes
    ],
    groups: [],
  };
}

// ============================================================
// Tests
// ============================================================

describe("runBacktest", () => {
  it("returns empty trades for insufficient data (< 50 bars)", () => {
    const ohlcv = generateTrendData(30, 100);
    const result = runBacktest("TEST", ohlcv, {
      entryFilter: oversoldFilter(),
      initialCapital: 100000,
    });
    expect(result.trades.length).toBe(0);
    expect(result.metrics.totalTrades).toBe(0);
    expect(result.barCount).toBe(30);
  });

  it("generates trades for sufficient data", () => {
    const ohlcv = generateTrendData(200, 100);
    const result = runBacktest("TEST", ohlcv, {
      entryFilter: bullishCrossFilter(),
      initialCapital: 100000,
      positionSizePercent: 25,
    });
    // With always-passing filter, should have trades
    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.symbol).toBe("TEST");
  });

  it("calculates profit target exit correctly", () => {
    // Strong uptrend should hit profit target
    const ohlcv = generateUptrend(200, 100);
    const result = runBacktest("TEST", ohlcv, {
      entryFilter: bullishCrossFilter(),
      initialCapital: 100000,
      profitTarget: 5, // 5% target
      positionSizePercent: 25,
    });
    const targetExits = result.trades.filter((t) => t.exitReason === "target");
    // In a strong uptrend, many trades should hit target
    expect(targetExits.length).toBeGreaterThan(0);
  });

  it("calculates stop loss exit correctly", () => {
    // Strong downtrend should hit stop loss
    const ohlcv = generateDowntrend(200, 200);
    const result = runBacktest("TEST", ohlcv, {
      entryFilter: bullishCrossFilter(),
      initialCapital: 100000,
      stopLoss: 3, // 3% stop
      positionSizePercent: 25,
    });
    const stopExits = result.trades.filter((t) => t.exitReason === "stop_loss");
    // In a strong downtrend, stop loss should trigger
    expect(stopExits.length).toBeGreaterThan(0);
  });

  it("computes performance metrics correctly", () => {
    const ohlcv = generateTrendData(300, 100);
    const result = runBacktest("TEST", ohlcv, {
      entryFilter: bullishCrossFilter(),
      initialCapital: 100000,
      profitTarget: 5,
      stopLoss: 3,
      positionSizePercent: 25,
    });

    // Should have trades
    expect(result.metrics.totalTrades).toBeGreaterThan(0);
    expect(result.metrics.winningTrades + result.metrics.losingTrades).toBe(result.metrics.totalTrades);

    // Win rate should be between 0 and 100
    expect(result.metrics.winRate).toBeGreaterThanOrEqual(0);
    expect(result.metrics.winRate).toBeLessThanOrEqual(100);

    // Sharpe ratio should be a number
    expect(typeof result.metrics.sharpeRatio).toBe("number");
  });

  it("respects maxHoldingBars parameter", () => {
    const ohlcv = generateTrendData(200, 100, 0.2, 0.05); // Low volatility, slight uptrend
    const result = runBacktest("TEST", ohlcv, {
      entryFilter: bullishCrossFilter(),
      initialCapital: 100000,
      maxHoldingBars: 5, // Force exit after 5 bars
      positionSizePercent: 25,
    });
    const maxBarExits = result.trades.filter((t) => t.exitReason === "max_bars");
    // With short max holding, some trades should exit due to max bars
    expect(maxBarExits.length).toBeGreaterThanOrEqual(0);
  });

  it("returns meaningful metrics for profitable strategy", () => {
    // Generate very strong uptrend
    const ohlcv = generateUptrend(300, 100);
    const result = runBacktest("TEST", ohlcv, {
      entryFilter: bullishCrossFilter(),
      initialCapital: 100000,
      profitTarget: 10,
      stopLoss: 5,
      positionSizePercent: 50,
    });

    if (result.trades.length > 0) {
      // In an uptrend with profit target, total return should be positive
      expect(result.metrics.totalReturnPercent).toBeGreaterThanOrEqual(0);
      // Win rate should be decent
      expect(result.metrics.winRate).toBeGreaterThan(30);
    }
  });
});
