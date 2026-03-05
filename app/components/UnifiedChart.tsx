'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import Chart from 'chart.js/auto';
import {
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateSMA,
  calculateEMA,
  PriceData
} from '@/lib/technical-indicators';

interface UnifiedChartProps {
  prices: { trade_date: Date; open: number; high: number; low: number; close: number; volume: number }[];
  ticker: string;
}

type IndicatorType = 'sma' | 'ema' | 'bollinger' | 'rsi' | 'macd' | 'volume';

const INDICATORS: { id: IndicatorType; label: string }[] = [
  { id: 'sma', label: 'SMA (20, 50, 200)' },
  { id: 'ema', label: 'EMA (20)' },
  { id: 'bollinger', label: 'Bollinger Bands' },
  { id: 'rsi', label: 'RSI (14)' },
  { id: 'macd', label: 'MACD' },
  { id: 'volume', label: 'Volume' },
];

export default function UnifiedChart({ prices, ticker }: UnifiedChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const [selectedIndicators, setSelectedIndicators] = useState<IndicatorType[]>(['volume', 'sma']);
  const [showIndicatorMenu, setShowIndicatorMenu] = useState(false);

  const priceData: PriceData[] = useMemo(() => {
    // Ensure data is chronological (oldest to newest)
    return prices
      .map(p => ({
        timestamp: new Date(p.trade_date).getTime(),
        open: Number(p.open) || 0,
        high: Number(p.high) || 0,
        low: Number(p.low) || 0,
        close: Number(p.close) || 0,
        volume: Number(p.volume) || 0,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
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

    const labels = priceData.map(p => {
      const date = new Date(p.timestamp);
      return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    });
    const closePrices = priceData.map(p => p.close);

    const datasets: any[] = [
      {
        label: 'Price',
        data: closePrices,
        borderColor: '#6366f1',
        backgroundColor: (context: any) => {
          const chart = context.chart;
          const { ctx, chartArea } = chart;
          if (!chartArea) return "rgba(99, 102, 241, 0.1)";
          const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, "rgba(99, 102, 241, 0.15)");
          gradient.addColorStop(1, "rgba(99, 102, 241, 0)");
          return gradient;
        },
        borderWidth: 2,
        fill: true,
        tension: 0.1,
        yAxisID: 'y',
        pointRadius: 0,
        pointHoverRadius: 4,
        order: 1,
      }
    ];

    // Add SMA
    if (selectedIndicators.includes('sma') && priceData.length >= 20) {
      const sma20 = calculateSMA(priceData, 20);
      const sma50 = calculateSMA(priceData, 50);
      const sma200 = priceData.length >= 200 ? calculateSMA(priceData, 200) : [];

      if (sma20.length > 0) {
        const paddedSma20 = new Array(labels.length - sma20.length).fill(null).concat(sma20.map(s => s.value));
        datasets.push({
          label: 'SMA 20',
          data: paddedSma20,
          borderColor: '#f59e0b',
          borderWidth: 1.5,
          borderDash: [4, 4],
          fill: false,
          tension: 0.1,
          yAxisID: 'y',
          pointRadius: 0,
        });
      }

      if (sma50.length > 0) {
        const paddedSma50 = new Array(labels.length - sma50.length).fill(null).concat(sma50.map(s => s.value));
        datasets.push({
          label: 'SMA 50',
          data: paddedSma50,
          borderColor: '#8b5cf6',
          borderWidth: 1.5,
          borderDash: [4, 4],
          fill: false,
          tension: 0.1,
          yAxisID: 'y',
          pointRadius: 0,
        });
      }

      if (sma200.length > 0) {
        const paddedSma200 = new Array(labels.length - sma200.length).fill(null).concat(sma200.map(s => s.value));
        datasets.push({
          label: 'SMA 200',
          data: paddedSma200,
          borderColor: '#06b6d4',
          borderWidth: 1.5,
          borderDash: [4, 4],
          fill: false,
          tension: 0.1,
          yAxisID: 'y',
          pointRadius: 0,
        });
      }
    }

    // Add EMA
    if (selectedIndicators.includes('ema') && priceData.length >= 20) {
      const ema20 = calculateEMA(priceData, 20);
      if (ema20.length > 0) {
        const paddedEma20 = new Array(labels.length - ema20.length).fill(null).concat(ema20.map(v => v.value));
        datasets.push({
          label: 'EMA 20',
          data: paddedEma20,
          borderColor: '#10b981',
          borderWidth: 1.5,
          fill: false,
          tension: 0.2,
          yAxisID: 'y',
          pointRadius: 0,
          order: 2,
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
        borderColor: 'rgba(239, 68, 68, 0.3)',
        borderWidth: 1,
        borderDash: [5, 5],
        fill: false,
        tension: 0.2,
        yAxisID: 'y',
        pointRadius: 0,
      });
      datasets.push({
        label: 'BB Middle',
        data: paddedMiddle,
        borderColor: 'rgba(245, 158, 11, 0.4)',
        borderWidth: 1,
        fill: false,
        tension: 0.2,
        yAxisID: 'y',
        pointRadius: 0,
      });
      datasets.push({
        label: 'BB Lower',
        data: paddedLower,
        borderColor: 'rgba(34, 197, 94, 0.3)',
        borderWidth: 1,
        borderDash: [5, 5],
        fill: '-1',
        backgroundColor: 'rgba(34, 197, 94, 0.03)',
        tension: 0.2,
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
          return p.close >= priceData[i - 1].close ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)';
        }),
        borderWidth: 0,
        yAxisID: 'y1',
        type: 'bar',
      });
    }

    // Add RSI
    if (selectedIndicators.includes('rsi') && priceData.length >= 14) {
      const rsiData = calculateRSI(priceData, 14);
      const paddedRsi = new Array(labels.length - rsiData.length).fill(null).concat(rsiData.map(v => v.value));
      datasets.push({
        label: 'RSI (14)',
        data: paddedRsi,
        borderColor: '#8b5cf6',
        borderWidth: 1.5,
        fill: false,
        yAxisID: 'y_rsi',
        pointRadius: 0,
        order: 3,
      });
    }

    // Add MACD
    if (selectedIndicators.includes('macd') && priceData.length >= 26) {
      const macdData = calculateMACD(priceData, 12, 26, 9);
      const paddedMacd = new Array(labels.length - macdData.length).fill(null).concat(macdData.map((v: any) => v.macd));
      const paddedSignal = new Array(labels.length - macdData.length).fill(null).concat(macdData.map((v: any) => v.signal));

      datasets.push({
        label: 'MACD',
        data: paddedMacd,
        borderColor: '#3b82f6',
        borderWidth: 1.5,
        fill: false,
        yAxisID: 'y_macd',
        pointRadius: 0,
        order: 3,
      });
      datasets.push({
        label: 'Signal',
        data: paddedSignal,
        borderColor: '#f59e0b',
        borderWidth: 1.2,
        fill: false,
        yAxisID: 'y_macd',
        pointRadius: 0,
        order: 3,
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
            ticks: {
              color: '#64748b',
              font: { size: 10 }
            },
            grid: { color: 'rgba(148, 163, 184, 0.05)' },
            border: { display: false }
          },
          y1: {
            display: selectedIndicators.includes('volume'),
            position: 'right',
            ticks: {
              display: false
            },
            grid: { display: false },
          },
          y_rsi: {
            display: selectedIndicators.includes('rsi'),
            position: 'right',
            min: 0,
            max: 100,
            grid: { display: false },
            ticks: { color: '#8b5cf6', font: { size: 8 } }
          },
          y_macd: {
            display: selectedIndicators.includes('macd'),
            position: 'right',
            grid: { display: false },
            ticks: { display: false }
          },
          x: {
            ticks: {
              color: '#64748b',
              maxTicksLimit: 12,
              font: { size: 10 }
            },
            grid: { display: false },
            border: { display: false }
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
            backgroundColor: "rgba(15,23,42,0.95)",
            titleColor: "#e2e8f0",
            bodyColor: "#94a3b8",
            padding: 12,
            cornerRadius: 10,
            borderColor: "rgba(148,163,184,0.1)",
            borderWidth: 1,
            callbacks: {
              label: (context) => {
                const label = context.dataset.label || '';
                const value = context.parsed.y;
                if (value === null || value === undefined) return '';
                if (context.dataset.yAxisID === 'y1' || label === 'Volume') {
                  const vol = value >= 10000000 ? (value / 10000000).toFixed(2) + 'Cr' : value.toLocaleString();
                  return `${label}: ${vol}`;
                }
                return `${label}: ₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

      <div className="h-96">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
