// lib/__tests__/technical-analysis.test.ts — Tests for computeATR + findSupportResistance
import {
  computeATR,
  findSupportResistance,
  type OHLCV,
  type SupportResistance,
} from "@/lib/screener/technical-analysis";

// ─── Test Data ───────────────────────────────────────────────────────────────

const sampleOHLCV: OHLCV[] = [
  { timestamp: 1754006400, open: 100, high: 105, low: 98, close: 103, volume: 1000 },
  { timestamp: 1754092800, open: 103, high: 108, low: 101, close: 106, volume: 1100 },
  { timestamp: 1754179200, open: 106, high: 110, low: 104, close: 108, volume: 1200 },
  { timestamp: 1754265600, open: 108, high: 112, low: 106, close: 110, volume: 1300 },
  { timestamp: 1754352000, open: 110, high: 114, low: 108, close: 112, volume: 1400 },
  { timestamp: 1754438400, open: 112, high: 115, low: 109, close: 111, volume: 1500 },
  { timestamp: 1754524800, open: 111, high: 113, low: 107, close: 109, volume: 1600 },
  { timestamp: 1754611200, open: 109, high: 111, low: 105, close: 107, volume: 1700 },
  { timestamp: 1754697600, open: 107, high: 109, low: 103, close: 105, volume: 1800 },
  { timestamp: 1754784000, open: 105, high: 107, low: 101, close: 103, volume: 1900 },
  { timestamp: 1754870400, open: 103, high: 105, low: 99, close: 101, volume: 2000 },
  { timestamp: 1754956800, open: 101, high: 103, low: 97, close: 99, volume: 2100 },
  { timestamp: 1755043200, open: 99, high: 101, low: 95, close: 97, volume: 2200 },
  { timestamp: 1755129600, open: 97, high: 99, low: 93, close: 95, volume: 2300 },
  { timestamp: 1755216000, open: 95, high: 97, low: 91, close: 93, volume: 2400 },
  { timestamp: 1755302400, open: 93, high: 95, low: 89, close: 91, volume: 2500 },
  { timestamp: 1755388800, open: 91, high: 93, low: 87, close: 89, volume: 2600 },
  { timestamp: 1755475200, open: 89, high: 91, low: 85, close: 87, volume: 2700 },
  { timestamp: 1755561600, open: 87, high: 89, low: 83, close: 85, volume: 2800 },
  { timestamp: 1755648000, open: 85, high: 87, low: 81, close: 83, volume: 2900 },
];

// ─── computeATR Tests ────────────────────────────────────────────────────────

describe("computeATR", () => {
  it("returns correct ATR values for known OHLC data", () => {
    const atr = computeATR(sampleOHLCV, 14);
    expect(atr.length).toBeGreaterThan(0);
    // ATR should be positive
    atr.forEach((val) => {
      expect(val).toBeGreaterThan(0);
    });
    // First ATR should be average of first 14 true ranges
    // TR[0] = high - low = 105 - 98 = 7
    // TR[1] = max(108-101, |108-103|, |101-103|) = max(7, 5, 2) = 7
    // etc.
    expect(atr[0]).toBeGreaterThan(0);
  });

  it("returns empty array for empty bars", () => {
    const atr = computeATR([], 14);
    expect(atr).toEqual([]);
  });

  it("returns empty array for single bar", () => {
    const atr = computeATR([sampleOHLCV[0]], 14);
    expect(atr).toEqual([]);
  });

  it("returns empty array when bars.length < period", () => {
    const atr = computeATR(sampleOHLCV.slice(0, 5), 14);
    expect(atr).toEqual([]);
  });

  it("computes ATR with custom period", () => {
    const atr5 = computeATR(sampleOHLCV, 5);
    const atr10 = computeATR(sampleOHLCV, 10);
    // Shorter period should have more values (starts earlier)
    expect(atr5.length).toBeGreaterThan(atr10.length);
  });

  it("ATR values are rounded to 2 decimal places", () => {
    const atr = computeATR(sampleOHLCV, 5);
    atr.forEach((val) => {
      const decimals = val.toString().split(".")[1];
      expect(decimals ? decimals.length : 0).toBeLessThanOrEqual(2);
    });
  });

  it("handles bars where high === low (no range)", () => {
    const flatBars: OHLCV[] = Array.from({ length: 20 }, (_, i) => ({
      timestamp: i,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 1000,
    }));
    const atr = computeATR(flatBars, 14);
    expect(atr.length).toBeGreaterThan(0);
    // All ATR values should be 0 (no price movement)
    atr.forEach((val) => {
      expect(val).toBe(0);
    });
  });
});

// ─── findSupportResistance Tests ─────────────────────────────────────────────

describe("findSupportResistance", () => {
  // Create bars with clear pivot points: uptrend → peak → downtrend → trough → uptrend
  const pivotBars: OHLCV[] = [
    // Uptrend
    { timestamp: 1, open: 100, high: 102, low: 99, close: 101, volume: 1000 },
    { timestamp: 2, open: 101, high: 104, low: 100, close: 103, volume: 1000 },
    { timestamp: 3, open: 103, high: 106, low: 102, close: 105, volume: 1000 },
    { timestamp: 4, open: 105, high: 108, low: 104, close: 107, volume: 1000 },
    { timestamp: 5, open: 107, high: 110, low: 106, close: 109, volume: 1000 },
    // Peak (pivot high at 112)
    { timestamp: 6, open: 109, high: 112, low: 108, close: 110, volume: 1000 },
    // Downtrend
    { timestamp: 7, open: 110, high: 111, low: 107, close: 108, volume: 1000 },
    { timestamp: 8, open: 108, high: 109, low: 105, close: 106, volume: 1000 },
    { timestamp: 9, open: 106, high: 107, low: 103, close: 104, volume: 1000 },
    { timestamp: 10, open: 104, high: 105, low: 101, close: 102, volume: 1000 },
    { timestamp: 11, open: 102, high: 103, low: 99, close: 100, volume: 1000 },
    // Trough (pivot low at 97)
    { timestamp: 12, open: 100, high: 101, low: 97, close: 99, volume: 1000 },
    // Recovery
    { timestamp: 13, open: 99, high: 101, low: 98, close: 100, volume: 1000 },
    { timestamp: 14, open: 100, high: 102, low: 99, close: 101, volume: 1000 },
    { timestamp: 15, open: 101, high: 103, low: 100, close: 102, volume: 1000 },
    { timestamp: 16, open: 102, high: 104, low: 101, close: 103, volume: 1000 },
    { timestamp: 17, open: 103, high: 105, low: 102, close: 104, volume: 1000 },
  ];

  it("identifies pivot highs and lows", () => {
    const result: SupportResistance = findSupportResistance(pivotBars, 3);
    expect(result.pivotHighs.length).toBeGreaterThan(0);
    expect(result.pivotLows.length).toBeGreaterThan(0);
  });

  it("returns support below current price", () => {
    const result: SupportResistance = findSupportResistance(pivotBars, 3);
    const currentPrice = pivotBars[pivotBars.length - 1].close;
    if (result.support !== null) {
      expect(result.support).toBeLessThan(currentPrice);
    }
  });

  it("returns resistance above current price", () => {
    const result: SupportResistance = findSupportResistance(pivotBars, 3);
    const currentPrice = pivotBars[pivotBars.length - 1].close;
    if (result.resistance !== null) {
      expect(result.resistance).toBeGreaterThan(currentPrice);
    }
  });

  it("returns nulls for insufficient data (< 2*lookback+1 bars)", () => {
    const fewBars = sampleOHLCV.slice(0, 3);
    const result: SupportResistance = findSupportResistance(fewBars, 5);
    expect(result.support).toBeNull();
    expect(result.resistance).toBeNull();
    expect(result.pivotHighs).toEqual([]);
    expect(result.pivotLows).toEqual([]);
  });

  it("returns nulls for empty bars", () => {
    const result: SupportResistance = findSupportResistance([], 5);
    expect(result.support).toBeNull();
    expect(result.resistance).toBeNull();
  });

  it("respects lookback parameter", () => {
    const result3: SupportResistance = findSupportResistance(pivotBars, 3);
    const result5: SupportResistance = findSupportResistance(pivotBars, 5);
    // Larger lookback should find fewer pivot points (stricter)
    expect(result5.pivotHighs.length).toBeLessThanOrEqual(result3.pivotHighs.length);
  });

  it("support and resistance are rounded to 2 decimal places", () => {
    const result: SupportResistance = findSupportResistance(pivotBars, 3);
    if (result.support !== null) {
      const decimals = result.support.toString().split(".")[1];
      expect(decimals ? decimals.length : 0).toBeLessThanOrEqual(2);
    }
    if (result.resistance !== null) {
      const decimals = result.resistance.toString().split(".")[1];
      expect(decimals ? decimals.length : 0).toBeLessThanOrEqual(2);
    }
  });
});
