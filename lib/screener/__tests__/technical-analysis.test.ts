import {
  computeSMA,
  computeEMA,
  computeRSI,
  computeMACD,
  computeBollinger,
  detectCandlestickPatterns,
  type OHLCV,
} from "../technical-analysis";

// ============================================================
// SMA
// ============================================================

describe("computeSMA", () => {
  it("computes simple moving average correctly", () => {
    const values = [10, 20, 30, 40, 50];
    const sma = computeSMA(values, 3);
    expect(sma[0]).toBeNaN();
    expect(sma[1]).toBeNaN();
    expect(sma[2]).toBeCloseTo(20); // (10+20+30)/3
    expect(sma[3]).toBeCloseTo(30); // (20+30+40)/3
    expect(sma[4]).toBeCloseTo(40); // (30+40+50)/3
  });

  it("returns NaN array when data length < period", () => {
    const sma = computeSMA([1, 2], 5);
    expect(sma.every((v) => isNaN(v))).toBe(true);
  });

  it("handles single-element period", () => {
    const values = [10, 20, 30];
    const sma = computeSMA(values, 1);
    expect(sma[0]).toBeCloseTo(10);
    expect(sma[1]).toBeCloseTo(20);
    expect(sma[2]).toBeCloseTo(30);
  });
});

// ============================================================
// EMA
// ============================================================

describe("computeEMA", () => {
  it("computes exponential moving average correctly", () => {
    const values = [10, 20, 30, 40, 50];
    const ema = computeEMA(values, 3);
    // multiplier = 2/(3+1) = 0.5
    // SMA(3) = (10+20+30)/3 = 20  →  ema[2] = 20
    // ema[3] = (40 - 20) * 0.5 + 20 = 30
    // ema[4] = (50 - 30) * 0.5 + 30 = 40
    expect(ema[2]).toBeCloseTo(20);
    expect(ema[3]).toBeCloseTo(30);
    expect(ema[4]).toBeCloseTo(40);
  });

  it("returns NaN array when data length < period", () => {
    const ema = computeEMA([1], 5);
    expect(ema.every((v) => isNaN(v))).toBe(true);
  });
});

// ============================================================
// RSI
// ============================================================

describe("computeRSI", () => {
  it("returns 100 when no losses", () => {
    // All positive gains
    const prices = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115];
    const rsi = computeRSI(prices, 14);
    expect(rsi[rsi.length - 1]).toBeCloseTo(100);
  });

  it("returns 0 when no gains", () => {
    const prices = [115, 114, 113, 112, 111, 110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100];
    const rsi = computeRSI(prices, 14);
    expect(rsi[rsi.length - 1]).toBeCloseTo(0);
  });

  it("returns 50 for equal gains and losses", () => {
    // Alternating gains and losses of equal magnitude
    const prices: number[] = [100];
    for (let i = 0; i < 30; i++) {
      prices.push(prices[prices.length - 1] + (i % 2 === 0 ? 1 : -1));
    }
    const rsi = computeRSI(prices, 14);
    // Should be near 50
    expect(rsi[rsi.length - 1]).toBeGreaterThan(40);
    expect(rsi[rsi.length - 1]).toBeLessThan(60);
  });
});

// ============================================================
// MACD
// ============================================================

describe("computeMACD", () => {
  it("returns macd, signal, and histogram arrays", () => {
    const prices = Array.from({ length: 50 }, (_, i) => 100 + i + Math.sin(i * 0.5) * 10);
    const result = computeMACD(prices, 12, 26, 9);
    expect(result.macd.length).toBe(50);
    expect(result.signal.length).toBe(50);
    expect(result.histogram.length).toBe(50);
    // MACD values should be NaN before slow period
    expect(result.macd[20]).toBeNaN();
    // After slow period, MACD should be defined
    const lastValues = result.macd.slice(30);
    expect(lastValues.some((v) => !isNaN(v))).toBe(true);
  });
});

// ============================================================
// Bollinger Bands
// ============================================================

describe("computeBollinger", () => {
  it("upper > middle > lower for non-trivial data", () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 + Math.random() * 20);
    const bb = computeBollinger(prices, 20, 2);
    const last = bb.upper.length - 1;
    expect(bb.upper[last]).toBeGreaterThan(bb.middle[last]);
    expect(bb.middle[last]).toBeGreaterThan(bb.lower[last]);
  });
});

// ============================================================
// Candlestick Patterns
// ============================================================

describe("detectCandlestickPatterns", () => {
  function candle(open: number, high: number, low: number, close: number, timestamp?: number): OHLCV {
    return { timestamp: timestamp ?? Date.now(), open, high, low, close, volume: 1000000 };
  }

  it("detects Doji", () => {
    const ohlcv = [
      candle(100, 105, 95, 102),
      candle(102, 106, 96, 104),
      candle(100, 110, 90, 100.5), // Doji: close ≈ open
    ];
    const patterns = detectCandlestickPatterns(ohlcv);
    expect(patterns.some((p) => p.name === "Doji")).toBe(true);
  });

  it("detects Bullish Engulfing", () => {
    const ohlcv = [
      candle(100, 105, 95, 103), // up
      candle(110, 115, 105, 112), // up (prev bullish)
      candle(115, 118, 108, 109), // Bearish: close < open AND open > prev.close AND close < prev.open
    ];
    // Current: open=115 > prev.close=112, close=109 < prev.open=110 → Bullish Engulfing
    const patterns = detectCandlestickPatterns(ohlcv);
    expect(patterns.some((p) => p.name === "Bullish Engulfing")).toBe(true);
  });

  it("returns empty for insufficient data", () => {
    const ohlcv = [candle(100, 105, 95, 102)];
    expect(detectCandlestickPatterns(ohlcv)).toEqual([]);
  });

  it("returns empty when totalRange is 0", () => {
    const ohlcv = [
      candle(100, 100, 100, 100),
      candle(100, 100, 100, 100),
      candle(100, 100, 100, 100),
    ];
    expect(detectCandlestickPatterns(ohlcv)).toEqual([]);
  });
});
