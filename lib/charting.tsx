import React from 'react';

export interface ChartOptions {
  symbol: string;
  isIndex?: boolean;
  timeframe?: '1D' | '1W' | '1M' | '3M' | '6M' | '1Y';
}

export function getNSEChartUrl(options: ChartOptions): string {
  const { symbol, isIndex = false, timeframe = '1D' } = options;
  
  let url = 'https://charting.nseindia.com/';
  
  if (isIndex) {
    url += `?symbol=${encodeURIComponent(symbol)}`;
  } else {
    url += `?symbol=${encodeURIComponent(symbol)}-EQ`;
  }
  
  // Add timeframe parameter if needed (check NSE charting API for support)
  return url;
}

export function openNSEChart(symbol: string, isIndex = false): void {
  const url = getNSEChartUrl({ symbol, isIndex });
  window.open(url, '_blank');
}

export function isNSEIndexSymbol(symbol: string): boolean {
  const indices = ['NIFTY', 'BANKNIFTY', 'NIFTYIT', 'SENSEX', 'FINNIFTY'];
  return indices.some(idx => symbol.includes(idx));
}

export function getChartIcon(): React.JSX.Element {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
    </svg>
  );
}

export function getChartButton(symbol: string, isIndex = false): React.JSX.Element {
  return (
    <button
      onClick={() => openNSEChart(symbol, isIndex)}
      className="p-2 rounded-full hover:bg-gray-100 transition-colors"
      title="View on NSE Charting"
    >
      {getChartIcon()}
    </button>
  );
}