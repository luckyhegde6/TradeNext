'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

const UnifiedChart = dynamic(() => import('../../components/UnifiedChart'), { ssr: false });

interface DynamicChartWrapperProps {
  ticker: string;
  dbPrices?: {
    trade_date: Date;
    open?: number;
    high?: number;
    low?: number;
    close: number;
    volume?: number;
  }[];
}

export default function DynamicChartWrapper({ ticker, dbPrices }: DynamicChartWrapperProps) {
  const [prices, setPrices] = useState<{
    trade_date: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        if (dbPrices && dbPrices.length >= 20) {
          const formatted = dbPrices.map(p => ({
            trade_date: new Date(p.trade_date),
            open: Number(p.open) || Number(p.close) || 0,
            high: Number(p.high) || Number(p.close) || 0,
            low: Number(p.low) || Number(p.close) || 0,
            close: Number(p.close) || 0,
            volume: Number(p.volume) || 0,
          }));
          setPrices(formatted);
          setLoading(false);
          return;
        }

        const response = await fetch(`/api/nse/stock/${ticker}/chart?days=1Y`);
        const data = await response.json();
        
        if (!data || !Array.isArray(data) || data.length === 0) {
          if (dbPrices && dbPrices.length > 0) {
            const formatted = dbPrices.map(p => ({
              trade_date: new Date(p.trade_date),
              open: Number(p.open) || Number(p.close) || 0,
              high: Number(p.high) || Number(p.close) || 0,
              low: Number(p.low) || Number(p.close) || 0,
              close: Number(p.close) || 0,
              volume: Number(p.volume) || 0,
            }));
            setPrices(formatted);
          }
          setLoading(false);
          return;
        }

        const formatted = data.map((item: [number, number, string, null, null]) => ({
          trade_date: new Date(item[0]),
          open: item[1],
          high: item[1],
          low: item[1],
          close: item[1],
          volume: 0,
        })).reverse();

        setPrices(formatted);
      } catch (err) {
        console.error('Chart load error:', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [ticker, JSON.stringify(dbPrices)]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-800 p-6">
        <div className="animate-pulse h-96 bg-gray-100 dark:bg-slate-800 rounded"></div>
      </div>
    );
  }

  if (prices.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-800 p-6">
        <p className="text-gray-500">No chart data available</p>
      </div>
    );
  }

  return (
    <div>
      <UnifiedChart prices={prices} ticker={ticker} />
    </div>
  );
}
