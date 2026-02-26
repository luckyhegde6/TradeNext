'use client';

import { useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import { 
  calculateRSI, 
  calculateMACD, 
  calculateBollingerBands,
  calculateSMA,
  PriceData 
} from '@/lib/technical-indicators';

interface TechnicalChartProps {
  prices: { trade_date: Date; open: number; high: number; low: number; close: number; volume: number }[];
  ticker: string;
}

export default function TechnicalIndicatorsChart({ prices, ticker }: TechnicalChartProps) {
  const rsiCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const macdCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bbCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const smaCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const priceData: PriceData[] = useMemo(() => {
    return prices
      .slice()
      .reverse()
      .map(p => ({
        timestamp: new Date(p.trade_date).getTime(),
        open: Number(p.open) || 0,
        high: Number(p.high) || 0,
        low: Number(p.low) || 0,
        close: Number(p.close) || 0,
        volume: Number(p.volume) || 0,
      }));
  }, [prices]);

  useEffect(() => {
    if (!rsiCanvasRef.current || priceData.length < 14) return;
    
    const rsiData = calculateRSI(priceData, 14);
    const labels = rsiData.map(r => new Date(r.timestamp).toISOString().slice(0, 10));
    
    const ctx = rsiCanvasRef.current.getContext('2d');
    if (!ctx) return;
    
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'RSI (14)',
          data: rsiData.map(r => r.value),
          borderColor: 'rgb(147, 51, 234)',
          backgroundColor: 'rgba(147, 51, 234, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            min: 0,
            max: 100,
            ticks: { color: '#9ca3af' }
          },
          x: { ticks: { color: '#9ca3af' } }
        },
        plugins: {
          legend: { labels: { color: '#fff' } }
        }
      }
    });
    
    return () => chart.destroy();
  }, [priceData]);

  useEffect(() => {
    if (!macdCanvasRef.current || priceData.length < 26) return;
    
    const macdData = calculateMACD(priceData, 12, 26, 9);
    const labels = macdData.map(m => new Date(m.timestamp).toISOString().slice(0, 10));
    
    const ctx = macdCanvasRef.current.getContext('2d');
    if (!ctx) return;
    
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'MACD',
            data: macdData.map(m => m.macd),
            borderColor: 'rgb(59, 130, 246)',
            backgroundColor: 'transparent',
            borderWidth: 2,
          },
          {
            label: 'Signal',
            data: macdData.map(m => m.signal),
            borderColor: 'rgb(234, 179, 8)',
            backgroundColor: 'transparent',
            borderWidth: 2,
          },
          {
            label: 'Histogram',
            data: macdData.map(m => m.histogram),
            borderColor: 'transparent',
            backgroundColor: macdData.map(m => m.histogram >= 0 ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)'),
            borderWidth: 1,
            fill: true,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { ticks: { color: '#9ca3af' } },
          x: { ticks: { color: '#9ca3af' } }
        },
        plugins: {
          legend: { labels: { color: '#fff' } }
        }
      }
    });
    
    return () => chart.destroy();
  }, [priceData]);

  useEffect(() => {
    if (!bbCanvasRef.current || priceData.length < 20) return;
    
    const bbData = calculateBollingerBands(priceData, 20, 2);
    const labels = bbData.map(b => new Date(b.timestamp).toISOString().slice(0, 10));
    
    const ctx = bbCanvasRef.current.getContext('2d');
    if (!ctx) return;
    
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Upper Band',
            data: bbData.map(b => b.upper),
            borderColor: 'rgba(239, 68, 68, 0.5)',
            backgroundColor: 'transparent',
            borderWidth: 1,
            borderDash: [5, 5],
          },
          {
            label: 'Middle Band (SMA)',
            data: bbData.map(b => b.middle),
            borderColor: 'rgb(234, 179, 8)',
            backgroundColor: 'transparent',
            borderWidth: 2,
          },
          {
            label: 'Lower Band',
            data: bbData.map(b => b.lower),
            borderColor: 'rgba(34, 197, 94, 0.5)',
            backgroundColor: 'transparent',
            borderWidth: 1,
            borderDash: [5, 5],
          },
          {
            label: 'Close Price',
            data: priceData.slice(-bbData.length).map(p => p.close),
            borderColor: 'rgb(147, 51, 234)',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { ticks: { color: '#9ca3af' } },
          x: { ticks: { color: '#9ca3af' } }
        },
        plugins: {
          legend: { labels: { color: '#fff' } }
        }
      }
    });
    
    return () => chart.destroy();
  }, [priceData]);

  useEffect(() => {
    if (!smaCanvasRef.current || priceData.length < 20) return;
    
    const sma20 = calculateSMA(priceData, 20);
    const sma50 = calculateSMA(priceData, 50);
    const minLength = Math.min(sma20.length, sma50.length);
    
    if (minLength === 0) return;
    
    const labels = sma20.slice(-minLength).map(s => new Date(s.timestamp).toISOString().slice(0, 10));
    
    const ctx = smaCanvasRef.current.getContext('2d');
    if (!ctx) return;
    
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Price',
            data: priceData.slice(-minLength).map(p => p.close),
            borderColor: 'rgb(156, 163, 175)',
            backgroundColor: 'transparent',
            borderWidth: 1,
          },
          {
            label: 'SMA 20',
            data: sma20.slice(-minLength).map(s => s.value),
            borderColor: 'rgb(59, 130, 246)',
            backgroundColor: 'transparent',
            borderWidth: 2,
          },
          {
            label: 'SMA 50',
            data: sma50.slice(-minLength).map(s => s.value),
            borderColor: 'rgb(234, 179, 8)',
            backgroundColor: 'transparent',
            borderWidth: 2,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { ticks: { color: '#9ca3af' } },
          x: { ticks: { color: '#9ca3af' } }
        },
        plugins: {
          legend: { labels: { color: '#fff' } }
        }
      }
    });
    
    return () => chart.destroy();
  }, [priceData]);

  if (priceData.length < 20) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-6">
        <p className="text-muted-foreground">Not enough historical data for technical indicators (need at least 20 days)</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold text-gray-900 dark:text-white">Technical Indicators</h3>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">RSI (14)</h4>
          <div className="h-48">
            <canvas ref={rsiCanvasRef} />
          </div>
        </div>
        
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">MACD (12,26,9)</h4>
          <div className="h-48">
            <canvas ref={macdCanvasRef} />
          </div>
        </div>
      </div>
      
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Bollinger Bands (20,2)</h4>
        <div className="h-64">
          <canvas ref={bbCanvasRef} />
        </div>
      </div>
      
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">SMA Crossover (20 & 50)</h4>
        <div className="h-64">
          <canvas ref={smaCanvasRef} />
        </div>
      </div>
    </div>
  );
}
