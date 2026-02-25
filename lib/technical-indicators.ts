export interface PriceData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorResult {
  timestamp: number;
  value: number;
}

export interface MACDResult {
  timestamp: number;
  macd: number;
  signal: number;
  histogram: number;
}

export interface BollingerBandResult {
  timestamp: number;
  upper: number;
  middle: number;
  lower: number;
}

export function calculateSMA(data: PriceData[], period: number): IndicatorResult[] {
  if (data.length < period) return [];
  
  const results: IndicatorResult[] = [];
  
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j].close;
    }
    results.push({
      timestamp: data[i].timestamp,
      value: sum / period,
    });
  }
  
  return results;
}

export function calculateEMA(data: PriceData[], period: number): IndicatorResult[] {
  if (data.length < period) return [];
  
  const results: IndicatorResult[] = [];
  const multiplier = 2 / (period + 1);
  
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i].close;
  }
  let prevEMA = sum / period;
  
  results.push({
    timestamp: data[period - 1].timestamp,
    value: prevEMA,
  });
  
  for (let i = period; i < data.length; i++) {
    const ema = (data[i].close - prevEMA) * multiplier + prevEMA;
    results.push({
      timestamp: data[i].timestamp,
      value: ema,
    });
    prevEMA = ema;
  }
  
  return results;
}

export function calculateRSI(data: PriceData[], period: number = 14): IndicatorResult[] {
  if (data.length < period + 1) return [];
  
  const results: IndicatorResult[] = [];
  const changes: number[] = [];
  
  for (let i = 1; i < data.length; i++) {
    changes.push(data[i].close - data[i - 1].close);
  }
  
  let avgGain = 0;
  let avgLoss = 0;
  
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) {
      avgGain += changes[i];
    } else {
      avgLoss += Math.abs(changes[i]);
    }
  }
  
  avgGain /= period;
  avgLoss /= period;
  
  if (avgLoss === 0) {
    results.push({ timestamp: data[period].timestamp, value: 100 });
  } else {
    const rs = avgGain / avgLoss;
    results.push({ timestamp: data[period].timestamp, value: 100 - 100 / (1 + rs) });
  }
  
  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    
    if (avgLoss === 0) {
      results.push({ timestamp: data[i + 1].timestamp, value: 100 });
    } else {
      const rs = avgGain / avgLoss;
      results.push({ timestamp: data[i + 1].timestamp, value: 100 - 100 / (1 + rs) });
    }
  }
  
  return results;
}

export function calculateMACD(
  data: PriceData[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDResult[] {
  const fastEMA = calculateEMA(data, fastPeriod);
  const slowEMA = calculateEMA(data, slowPeriod);
  
  if (fastEMA.length !== slowEMA.length) return [];
  
  const macdLine: IndicatorResult[] = [];
  
  for (let i = 0; i < fastEMA.length; i++) {
    macdLine.push({
      timestamp: fastEMA[i].timestamp,
      value: fastEMA[i].value - slowEMA[i].value,
    });
  }
  
  const signalEMA = calculateEMA(
    macdLine.map((d) => ({ ...d, open: d.value, high: d.value, low: d.value, close: d.value, volume: 0 })),
    signalPeriod
  );
  
  const results: MACDResult[] = [];
  const offset = macdLine.length - signalEMA.length;
  
  for (let i = 0; i < signalEMA.length; i++) {
    const macdIdx = i + offset;
    results.push({
      timestamp: macdLine[macdIdx].timestamp,
      macd: macdLine[macdIdx].value,
      signal: signalEMA[i].value,
      histogram: macdLine[macdIdx].value - signalEMA[i].value,
    });
  }
  
  return results;
}

export function calculateBollingerBands(
  data: PriceData[],
  period: number = 20,
  stdDevMultiplier: number = 2
): BollingerBandResult[] {
  const sma = calculateSMA(data, period);
  
  if (sma.length === 0) return [];
  
  const results: BollingerBandResult[] = [];
  
  for (let i = 0; i < sma.length; i++) {
    const dataIdx = i + period - 1;
    let sumSquaredDiff = 0;
    
    for (let j = 0; j < period; j++) {
      const diff = data[dataIdx - j].close - sma[i].value;
      sumSquaredDiff += diff * diff;
    }
    
    const stdDev = Math.sqrt(sumSquaredDiff / period);
    
    results.push({
      timestamp: sma[i].timestamp,
      upper: sma[i].value + stdDevMultiplier * stdDev,
      middle: sma[i].value,
      lower: sma[i].value - stdDevMultiplier * stdDev,
    });
  }
  
  return results;
}

export function calculateStochastic(
  data: PriceData[],
  kPeriod: number = 14,
  dPeriod: number = 3
): { k: IndicatorResult[]; d: IndicatorResult[] } {
  if (data.length < kPeriod) return { k: [], d: [] };
  
  const k: IndicatorResult[] = [];
  
  for (let i = kPeriod - 1; i < data.length; i++) {
    let highest = data[i - kPeriod + 1].high;
    let lowest = data[i - kPeriod + 1].low;
    
    for (let j = 1; j < kPeriod; j++) {
      highest = Math.max(highest, data[i - j].high);
      lowest = Math.min(lowest, data[i - j].low);
    }
    
    const range = highest - lowest;
    const stochastic = range === 0 
      ? 50 
      : ((data[i].close - lowest) / range) * 100;
    
    k.push({
      timestamp: data[i].timestamp,
      value: Math.max(0, Math.min(100, stochastic)),
    });
  }
  
  const d = calculateSMA(
    k.map((x) => ({ ...x, open: x.value, high: x.value, low: x.value, close: x.value, volume: 0 })),
    dPeriod
  );
  
  return { k, d };
}

export function calculateAverageTrueRange(data: PriceData[], period: number = 14): IndicatorResult[] {
  if (data.length < period + 1) return [];
  
  const trueRanges: number[] = [];
  
  for (let i = 1; i < data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i - 1].close;
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }
  
  const results: IndicatorResult[] = [];
  let sum = 0;
  
  for (let i = 0; i < period; i++) {
    sum += trueRanges[i];
  }
  results.push({
    timestamp: data[period].timestamp,
    value: sum / period,
  });
  
  for (let i = period; i < trueRanges.length; i++) {
    const prevATR = results[results.length - 1].value;
    const atr = (prevATR * (period - 1) + trueRanges[i]) / period;
    results.push({
      timestamp: data[i + 1].timestamp,
      value: atr,
    });
  }
  
  return results;
}

export function calculateOBV(data: PriceData[]): IndicatorResult[] {
  if (data.length === 0) return [];
  
  const results: IndicatorResult[] = [{
    timestamp: data[0].timestamp,
    value: data[0].volume,
  }];
  
  for (let i = 1; i < data.length; i++) {
    let obv = results[results.length - 1].value;
    
    if (data[i].close > data[i - 1].close) {
      obv += data[i].volume;
    } else if (data[i].close < data[i - 1].close) {
      obv -= data[i].volume;
    }
    
    results.push({
      timestamp: data[i].timestamp,
      value: obv,
    });
  }
  
  return results;
}

export function interpretRSI(rsi: number): string {
  if (rsi >= 70) return 'Overbought';
  if (rsi <= 30) return 'Oversold';
  return 'Neutral';
}

export function interpretMACD(macd: MACDResult): string {
  if (macd.histogram > 0 && macd.macd > macd.signal) return 'Bullish';
  if (macd.histogram < 0 && macd.macd < macd.signal) return 'Bearish';
  return 'Neutral';
}

export function interpretBollinger(price: number, bands: BollingerBandResult): string {
  if (price >= bands.upper) return 'Overbought - Possible reversal';
  if (price <= bands.lower) return 'Oversold - Possible bounce';
  return 'Within bands';
}
