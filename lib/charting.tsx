import React from 'react';

export interface ChartOptions {
  symbol: string;
  isIndex?: boolean;
  timeframe?: '1D' | '1W' | '1M' | '3M' | '6M' | '1Y';
}

// TradingView symbol pages for NSE indices (verified against in.tradingview.com, 2026-09)
const INDEX_TV_TICKERS: Record<string, string> = {
  NIFTY: 'NSE-NIFTY',
  BANKNIFTY: 'NSE-BANKNIFTY',
  NIFTYIT: 'NSE-CNXIT', // Nifty IT is listed as CNXIT on TradingView
  SENSEX: 'BSE-SENSEX',
  FINNIFTY: 'NSE-CNXFINANCE', // Nifty Financial Services is listed as CNXFINANCE on TradingView
};

export function getNSEChartUrl(options: ChartOptions): string {
  const { symbol, isIndex = false, timeframe = '1D' } = options;

  if (isIndex) {
    // NSE charting has no index charts — indices open the TradingView symbol page
    const ticker = INDEX_TV_TICKERS[symbol] ?? INDEX_TV_TICKERS[symbol.toUpperCase()];
    if (ticker) {
      return `https://in.tradingview.com/symbols/${ticker}/`;
    }
    // Unknown index → NSE charting fallback (matches pre-change behavior)
    return `https://charting.nseindia.com/?symbol=${encodeURIComponent(symbol)}`;
  }

  return `https://charting.nseindia.com/?symbol=${encodeURIComponent(symbol)}-EQ`;
}

export function openNSEChart(symbol: string, isIndex = false): void {
  const url = getNSEChartUrl({ symbol, isIndex });
  window.open(url, '_blank');
}

export function isNSEIndexSymbol(symbol: string): boolean {
  const indices = ['NIFTY', 'BANKNIFTY', 'NIFTYIT', 'SENSEX', 'FINNIFTY'];
  return indices.some(idx => symbol.includes(idx));
}

import { ChartBarIcon } from '@heroicons/react/24/outline';

export function getChartIcon(): React.JSX.Element {
  return <ChartBarIcon className="w-5 h-5" />;
}

export function getChartButton(symbol: string, isIndex = false): React.JSX.Element {
  // Known indices open TradingView symbol pages; everything else (stocks, unknown indices) opens NSE charting
  const tvTicker = INDEX_TV_TICKERS[symbol] ?? INDEX_TV_TICKERS[symbol.toUpperCase()];
  const opensTradingView = isIndex && tvTicker !== undefined;
  return (
    <button
      onClick={() => openNSEChart(symbol, isIndex)}
      className="p-2 rounded-full hover:bg-gray-100 transition-colors"
      title={opensTradingView ? `View ${symbol} chart on TradingView` : 'View on NSE Charting'}
    >
      {getChartIcon()}
    </button>
  );
}