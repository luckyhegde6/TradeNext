'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import Chart from 'chart.js/auto';
import { 
  calculateRSI, 
  calculateMACD, 
  calculateBollingerBands,
  calculateSMA,
  PriceData 
} from '@/lib/technical-indicators';

interface UnifiedChartProps {
  prices: { trade_date: Date; open: number; high: number; low: number; close: number; volume: number }[];
  ticker: string;
}

type IndicatorType = 'sma' | 'ema' | 'bollinger' | 'rsi' | 'macd' | 'volume';

const INDICATORS: { id: IndicatorType; label: string }[] = [
  { id: 'sma', label: 'SMA (20 & 50)' },
  { id: 'bollinger', label: 'Bollinger Bands' },
  { id: 'rsi', label: 'RSI (14)' },
  { id: 'macd', label: 'MACD' },
  { id: 'volume', label: 'Volume' },
];

export default function UnifiedChart({ prices, ticker }: UnifiedChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const [selectedIndicators, setSelectedIndicators] = useState<IndicatorType[]>(['volume']);
  const [showIndicatorMenu, setShowIndicatorMenu] = useState(false);

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

  const toggleIndicator = (indicator: IndicatorType) => {
    setSelectedIndicators(prev => 
      prev.includes(indicator)
        ? prev.filter(i => i !== indicator)
        : [...prev, indicator]
    );
  };

  useEffect(() => {
    if (!canvasRef.current || priceData.length === 0) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const labels = priceData.map(p => new Date(p.timestamp).toISOString().slice(0, 10));
    const closePrices = priceData.map(p => p.close);
    
    const datasets: any[] = [
      {
        label: 'Price',
        data: closePrices,
        borderColor: 'rgb(99, 102, 241)',
        backgroundColor: 'rgba(99, 102, 241, 0.1)',
        borderWidth: 2,
        fill: false,
        tension: 0.4,
        yAxisID: 'y',
      }
    ];

    // Add SMA
    if (selectedIndicators.includes('sma') && priceData.length >= 50) {
      const sma20 = calculateSMA(priceData, 20);
      const sma50 = calculateSMA(priceData, 50);
      const minLength = Math.min(sma20.length, sma50.length);
      
      if (minLength > 0) {
        const smaLabels = sma20.slice(-minLength).map(s => new Date(s.timestamp).toISOString().slice(0, 10));
        const paddedSma20 = new Array(labels.length - minLength).fill(null).concat(sma20.slice(-minLength).map(s => s.value));
        const paddedSma50 = new Array(labels.length - minLength).fill(null).concat(sma50.slice(-minLength).map(s => s.value));
        
        datasets.push({
          label: 'SMA 20',
          data: paddedSma20,
          borderColor: 'rgb(59, 130, 246)',
          borderWidth: 1.5,
          fill: false,
          tension: 0.4,
          yAxisID: 'y',
        });
        datasets.push({
          label: 'SMA 50',
          data: paddedSma50,
          borderColor: 'rgb(234, 179, 8)',
          borderWidth: 1.5,
          fill: false,
          tension: 0.4,
          yAxisID: 'y',
        });
      }
    }

    // Add Bollinger Bands
    if (selectedIndicators.includes('bollinger') && priceData.length >= 20) {
      const bbData = calculateBollingerBands(priceData, 20, 2);
      
      const paddedUpper = new Array(labels.length - bbData.length).fill(null).concat(bbData.map(b => b.upper));
      const paddedMiddle = new Array(labels.length - bbData.length).fill(null).concat(bbData.map(b => b.middle));
      const paddedLower = new Array(labels.length - bbData.length).fill(null).concat(bbData.map(b => b.lower));
      
      datasets.push({
        label: 'BB Upper',
        data: paddedUpper,
        borderColor: 'rgba(239, 68, 68, 0.4)',
        borderWidth: 1,
        borderDash: [5, 5],
        fill: false,
        tension: 0.4,
        yAxisID: 'y',
        pointRadius: 0,
      });
      datasets.push({
        label: 'BB Middle',
        data: paddedMiddle,
        borderColor: 'rgba(234, 179, 8, 0.6)',
        borderWidth: 1,
        fill: false,
        tension: 0.4,
        yAxisID: 'y',
        pointRadius: 0,
      });
      datasets.push({
        label: 'BB Lower',
        data: paddedLower,
        borderColor: 'rgba(34, 197, 94, 0.4)',
        borderWidth: 1,
        borderDash: [5, 5],
        fill: '-1',
        backgroundColor: 'rgba(34, 197, 94, 0.05)',
        tension: 0.4,
        yAxisID: 'y',
        pointRadius: 0,
      });
    }

    // Add Volume
    if (selectedIndicators.includes('volume')) {
      datasets.push({
        label: 'Volume',
        data: priceData.map(p => p.volume),
        backgroundColor: priceData.map((p, i) => {
          if (i === 0) return 'rgba(156, 163, 175, 0.3)';
          return p.close >= priceData[i-1].close ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)';
        }),
        borderWidth: 0,
        yAxisID: 'y1',
        type: 'bar',
      });
    }

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        scales: {
          y: {
            position: 'left',
            ticks: { color: '#9ca3af' },
            grid: { color: 'rgba(156, 163, 175, 0.1)' },
          },
          y1: {
            display: selectedIndicators.includes('volume'),
            position: 'right',
            ticks: { 
              color: '#9ca3af',
              callback: (value) => {
                if (typeof value === 'number') {
                  if (value >= 10000000) return (value / 10000000).toFixed(1) + 'M';
                  if (value >= 10000) return (value / 1000).toFixed(0) + 'K';
                }
                return value;
              }
            },
            grid: { display: false },
          },
          x: { 
            ticks: { 
              color: '#9ca3af',
              maxTicksLimit: 12 
            },
            grid: { display: false },
          }
        },
        plugins: {
          legend: { 
            display: true,
            position: 'top',
            labels: { 
              color: '#9ca3af',
              filter: (item) => item.text !== 'Price' 
            } 
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const label = context.dataset.label || '';
                const value = context.parsed.y;
                if (context.dataset.yAxisID === 'y1' || label === 'Volume') {
                  return `${label}: ${value.toLocaleString()}`;
                }
                return `${label}: ₹${value.toFixed(2)}`;
              }
            }
          }
        }
      }
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [priceData, selectedIndicators]);

  if (priceData.length < 2) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-6">
        <p className="text-muted-foreground">Not enough historical data for chart</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Price Chart</h3>
        <div className="relative">
          <button
            onClick={() => setShowIndicatorMenu(!showIndicatorMenu)}
            className="px-3 py-1.5 text-sm bg-primary/10 text-primary rounded hover:bg-primary/20 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Indicators
            {selectedIndicators.length > 0 && (
              <span className="bg-primary text-white text-xs rounded-full px-1.5 py-0.5">
                {selectedIndicators.length}
              </span>
            )}
          </button>
          
          {showIndicatorMenu && (
            <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg z-10">
              {INDICATORS.map((indicator) => (
                <button
                  key={indicator.id}
                  onClick={() => toggleIndicator(indicator.id)}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 flex items-center justify-between"
                >
                  {indicator.label}
                  {selectedIndicators.includes(indicator.id) && (
                    <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      
      <div className="h-80">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
