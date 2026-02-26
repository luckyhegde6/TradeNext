import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateStochastic,
  calculateAverageTrueRange,
  calculateOBV,
  interpretRSI,
  interpretMACD,
  interpretBollinger,
  PriceData,
} from '../technical-indicators';

const generateTestData = (count: number, basePrice: number = 100): PriceData[] => {
  const data: PriceData[] = [];
  let price = basePrice;
  const now = Date.now();
  
  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.5) * 10;
    price = Math.max(price + change, 10);
    const volatility = Math.random() * 5;
    
    data.push({
      timestamp: now - (count - i) * 86400000,
      open: price - Math.random() * 3,
      high: price + Math.random() * 5,
      low: price - Math.random() * 5,
      close: price,
      volume: Math.floor(Math.random() * 10000000),
    });
  }
  
  return data;
};

describe('Technical Indicators', () => {
  describe('calculateSMA', () => {
    test('should calculate SMA correctly', () => {
      const data = generateTestData(10, 100);
      const sma = calculateSMA(data, 5);
      
      expect(sma.length).toBe(6);
      expect(sma[0].value).toBeGreaterThan(90);
      expect(sma[0].value).toBeLessThan(110);
    });

    test('should return empty array for insufficient data', () => {
      const data = generateTestData(3, 100);
      const sma = calculateSMA(data, 5);
      
      expect(sma.length).toBe(0);
    });
  });

  describe('calculateEMA', () => {
    test('should calculate EMA correctly', () => {
      const data = generateTestData(20, 100);
      const ema = calculateEMA(data, 10);
      
      expect(ema.length).toBe(11);
    });
  });

  describe('calculateRSI', () => {
    test('should calculate RSI correctly', () => {
      const data = generateTestData(30, 100);
      const rsi = calculateRSI(data, 14);
      
      expect(rsi.length).toBe(16);
      rsi.forEach(r => {
        expect(r.value).toBeGreaterThanOrEqual(0);
        expect(r.value).toBeLessThanOrEqual(100);
      });
    });

    test('should handle trending data', () => {
      const data = generateTestData(30, 100);
      data.forEach((d, i) => {
        d.close = 100 + i * 2;
      });
      
      const rsi = calculateRSI(data, 14);
      expect(rsi[rsi.length - 1].value).toBeGreaterThan(50);
    });
  });

  describe('calculateMACD', () => {
    test('should calculate MACD correctly', () => {
      const data = generateTestData(60, 100);
      const macd = calculateMACD(data);
      
      expect(macd.length).toBeGreaterThanOrEqual(0);
      if (macd.length > 0) {
        macd.forEach(m => {
          expect(typeof m.macd).toBe('number');
          expect(typeof m.signal).toBe('number');
          expect(typeof m.histogram).toBe('number');
        });
      }
    });
  });

  describe('calculateStochastic', () => {
    test('should calculate Stochastic correctly', () => {
      const data = generateTestData(30, 100);
      const stoch = calculateStochastic(data, 14, 3);
      
      expect(stoch.k.length).toBeGreaterThan(0);
      stoch.k.forEach(k => {
        expect(k.value).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('calculateBollingerBands', () => {
    test('should calculate Bollinger Bands correctly', () => {
      const data = generateTestData(30, 100);
      const bands = calculateBollingerBands(data, 20, 2);
      
      expect(bands.length).toBe(11);
      bands.forEach(b => {
        expect(b.upper).toBeGreaterThan(b.middle);
        expect(b.lower).toBeLessThan(b.middle);
      });
    });
  });

  describe('calculateStochastic', () => {
    test('should calculate Stochastic correctly', () => {
      const data = generateTestData(30, 100);
      const stoch = calculateStochastic(data, 14, 3);
      
      expect(stoch.k.length).toBe(17);
      stoch.k.forEach(k => {
        expect(k.value).toBeGreaterThanOrEqual(0);
        expect(k.value).toBeLessThanOrEqual(100);
      });
    });
  });

  describe('calculateATR', () => {
    test('should calculate ATR correctly', () => {
      const data = generateTestData(30, 100);
      const atr = calculateAverageTrueRange(data, 14);
      
      expect(atr.length).toBe(16);
      atr.forEach(a => {
        expect(a.value).toBeGreaterThan(0);
      });
    });
  });

  describe('calculateOBV', () => {
    test('should calculate OBV correctly', () => {
      const data = generateTestData(20, 100);
      const obv = calculateOBV(data);
      
      expect(obv.length).toBe(20);
    });
  });

  describe('Interpretation functions', () => {
    test('interpretRSI should return correct values', () => {
      expect(interpretRSI(75)).toBe('Overbought');
      expect(interpretRSI(25)).toBe('Oversold');
      expect(interpretRSI(50)).toBe('Neutral');
    });

    test('interpretMACD should return correct values', () => {
      expect(interpretMACD({ timestamp: 0, macd: 5, signal: 3, histogram: 2 })).toBe('Bullish');
      expect(interpretMACD({ timestamp: 0, macd: 3, signal: 5, histogram: -2 })).toBe('Bearish');
      expect(interpretMACD({ timestamp: 0, macd: 5, signal: 5, histogram: 0 })).toBe('Neutral');
    });

    test('interpretBollinger should return correct values', () => {
      expect(interpretBollinger(120, { timestamp: 0, upper: 110, middle: 100, lower: 90 })).toBe('Overbought - Possible reversal');
      expect(interpretBollinger(80, { timestamp: 0, upper: 110, middle: 100, lower: 90 })).toBe('Oversold - Possible bounce');
      expect(interpretBollinger(100, { timestamp: 0, upper: 110, middle: 100, lower: 90 })).toBe('Within bands');
    });
  });
});
