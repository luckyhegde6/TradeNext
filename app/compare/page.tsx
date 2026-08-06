"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

interface StockQuote {
  symbol: string;
  lastPrice: number;
  change: number;
  pChange: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  avgVolume: number;
  marketCap: number;
  pe: number;
  pb: number;
  dividendYield: number;
  week52High: number;
  week52Low: number;
}

interface StockData {
  [key: string]: StockQuote | null;
}

export default function ComparePage() {
  const { data: session, status } = useSession();
  const [symbols, setSymbols] = useState<string[]>(["", "", "", "", ""]);
  const [stockData, setStockData] = useState<StockData>({});
  const [chartHistory, setChartHistory] = useState<Record<string, number[]>>({});
  const [chartLabels, setChartLabels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSymbolChange = (index: number, value: string) => {
    const newSymbols = [...symbols];
    newSymbols[index] = value.toUpperCase();
    setSymbols(newSymbols);
  };

  const handleCompare = async () => {
    const validSymbols = symbols.filter(s => s.trim() !== "");
    if (validSymbols.length < 2) {
      setError("Please enter at least 2 stock symbols to compare");
      return;
    }

    setLoading(true);
    setError(null);
    setStockData({});
    setChartHistory({});
    setChartLabels([]);

    try {
      const response = await fetch(`/api/compare?symbols=${validSymbols.join(",")}`);
      if (!response.ok) {
        throw new Error("Failed to fetch stock data");
      }
      const data = await response.json();
      
      const dataMap: StockData = {};
      data.forEach((stock: StockQuote) => {
        dataMap[stock.symbol] = stock;
      });
      validSymbols.forEach(symbol => {
        if (!dataMap[symbol]) {
          dataMap[symbol] = null;
        }
      });
      setStockData(dataMap);

      // Also fetch historical chart data for each symbol
      try {
        const baseUrl = window.location.origin;
        const chartPromises = validSymbols.map(async (symbol) => {
          const chartRes = await fetch(`${baseUrl}/api/nse/stock/${symbol}/chart?period=1M`);
          if (!chartRes.ok) return { symbol, dates: [], prices: [] };
          const chartData = await chartRes.json();
          const series = Array.isArray(chartData) ? chartData : (chartData?.data || chartData?.grapthData || []);
          if (Array.isArray(series) && series.length > 0) {
            // series is an array of [timestamp_ms, close, ...]
            const dates = series.map((p: any) => {
              const ts = Array.isArray(p) ? p[0] : (p.timestamp || p.time || p.date || 0);
              const d = new Date(ts);
              return d.toISOString().split("T")[0];
            });
            const prices = series.map((p: any) => {
              if (Array.isArray(p)) return p[1] ?? 0;
              return p.close ?? p.price ?? p.value ?? 0;
            });
            return { symbol, dates, prices };
          }
          return { symbol, dates: [], prices: [] };
        });
        const chartResults = await Promise.all(chartPromises);

        // Find common dates, normalize to 100
        const allDates = [...new Set(chartResults.flatMap((r) => r.dates))].sort();
        const historyMap: Record<string, number[]> = {};
        chartResults.forEach((r) => {
          const priceByDate: Record<string, number> = {};
          r.dates.forEach((d, i) => (priceByDate[d] = r.prices[i]));
          // Normalize
          const firstPrice = priceByDate[r.dates[0]];
          if (firstPrice && firstPrice > 0) {
            historyMap[r.symbol] = allDates.map((d) => {
              const p = priceByDate[d];
              return p ? Math.round((p / firstPrice) * 10000) / 100 : 0;
            });
          }
        });
        setChartLabels(allDates);
        setChartHistory(historyMap);
      } catch {
        // Chart data is optional — silently fail
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to compare stocks");
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (num: number | undefined | null, decimals: number = 2) => {
    if (num === undefined || num === null) return "—";
    if (num >= 10000000) {
      return (num / 10000000).toFixed(decimals) + " Cr";
    }
    if (num >= 100000) {
      return (num / 100000).toFixed(decimals) + " L";
    }
    return num.toFixed(decimals);
  };

  const COLORS = [
    "rgb(59, 130, 246)",   // blue
    "rgb(239, 68, 68)",    // red
    "rgb(16, 185, 129)",   // green
    "rgb(245, 158, 11)",   // amber
    "rgb(139, 92, 246)",   // violet
    "rgb(236, 72, 153)",   // pink
    "rgb(14, 165, 233)",   // sky
    "rgb(168, 85, 247)",   // purple
  ];

  const formatPrice = (price: number | undefined | null) => {
    if (price === undefined || price === null) return "—";
    return "₹" + price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const validSymbols = symbols.filter(s => s.trim() !== "");

  return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Stock Compare</h1>
        </div>

      <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Compare Stocks
        </h2>
        
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
          {symbols.map((symbol, index) => (
            <div key={index}>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Stock {index + 1}
              </label>
              <input
                type="text"
                value={symbol}
                onChange={(e) => handleSymbolChange(index, e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCompare()}
                placeholder="e.g., RELIANCE"
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-800 dark:text-white uppercase"
              />
            </div>
          ))}
        </div>

        <button
          onClick={handleCompare}
          disabled={loading || validSymbols.length < 2}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Comparing..." : "Compare"}
        </button>

        {error && (
          <p className="mt-4 text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>

      {validSymbols.length >= 2 && Object.keys(stockData).length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-800">
              <thead className="bg-gray-50 dark:bg-slate-800/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Metric
                  </th>
                  {validSymbols.map(symbol => (
                    <th key={symbol} className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {symbol}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-800">
                <tr>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">Last Price</td>
                  {validSymbols.map(symbol => {
                    const stock = stockData[symbol];
                    return (
                      <td key={symbol} className="px-4 py-3 text-right text-sm text-gray-900 dark:text-white">
                        {stock ? formatPrice(stock.lastPrice) : "—"}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">Change</td>
                  {validSymbols.map(symbol => {
                    const stock = stockData[symbol];
                    const isPositive = stock && stock.change >= 0;
                    return (
                      <td key={symbol} className={`px-4 py-3 text-right text-sm ${isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                        {stock ? (stock.change >= 0 ? "+" : "") + formatPrice(stock.change) : "—"}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">% Change</td>
                  {validSymbols.map(symbol => {
                    const stock = stockData[symbol];
                    const isPositive = stock && stock.pChange >= 0;
                    return (
                      <td key={symbol} className={`px-4 py-3 text-right text-sm ${isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                        {stock ? (stock.pChange >= 0 ? "+" : "") + stock.pChange.toFixed(2) + "%" : "—"}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">Open</td>
                  {validSymbols.map(symbol => (
                    <td key={symbol} className="px-4 py-3 text-right text-sm text-gray-900 dark:text-white">
                      {stockData[symbol] ? formatPrice(stockData[symbol]!.open) : "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">High</td>
                  {validSymbols.map(symbol => (
                    <td key={symbol} className="px-4 py-3 text-right text-sm text-gray-900 dark:text-white">
                      {stockData[symbol] ? formatPrice(stockData[symbol]!.high) : "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">Low</td>
                  {validSymbols.map(symbol => (
                    <td key={symbol} className="px-4 py-3 text-right text-sm text-gray-900 dark:text-white">
                      {stockData[symbol] ? formatPrice(stockData[symbol]!.low) : "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">Volume</td>
                  {validSymbols.map(symbol => (
                    <td key={symbol} className="px-4 py-3 text-right text-sm text-gray-900 dark:text-white">
                      {stockData[symbol] ? stockData[symbol]!.volume.toLocaleString("en-IN") : "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">Market Cap</td>
                  {validSymbols.map(symbol => (
                    <td key={symbol} className="px-4 py-3 text-right text-sm text-gray-900 dark:text-white">
                      {stockData[symbol] ? formatNumber(stockData[symbol]!.marketCap) : "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">P/E Ratio</td>
                  {validSymbols.map(symbol => (
                    <td key={symbol} className="px-4 py-3 text-right text-sm text-gray-900 dark:text-white">
                      {stockData[symbol] ? stockData[symbol]!.pe?.toFixed(2) || "—" : "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">P/B Ratio</td>
                  {validSymbols.map(symbol => (
                    <td key={symbol} className="px-4 py-3 text-right text-sm text-gray-900 dark:text-white">
                      {stockData[symbol] ? stockData[symbol]!.pb?.toFixed(2) || "—" : "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">Dividend Yield</td>
                  {validSymbols.map(symbol => (
                    <td key={symbol} className="px-4 py-3 text-right text-sm text-gray-900 dark:text-white">
                      {stockData[symbol] ? (stockData[symbol]!.dividendYield?.toFixed(2) || "—") + "%" : "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">52W High</td>
                  {validSymbols.map(symbol => (
                    <td key={symbol} className="px-4 py-3 text-right text-sm text-gray-900 dark:text-white">
                      {stockData[symbol] ? formatPrice(stockData[symbol]!.week52High) : "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">52W Low</td>
                  {validSymbols.map(symbol => (
                    <td key={symbol} className="px-4 py-3 text-right text-sm text-gray-900 dark:text-white">
                      {stockData[symbol] ? formatPrice(stockData[symbol]!.week52Low) : "—"}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Historical Performance Chart */}
      {Object.keys(chartHistory).length >= 2 && chartLabels.length > 1 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Normalized Performance (1 Month)
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            All stocks normalized to 100 at start date for fair comparison
          </p>
          <div className="h-72 md:h-80">
            <Line
              data={{
                labels: chartLabels,
                datasets: Object.entries(chartHistory).filter(([_, vals]) => vals.some(v => v > 0)).map(([symbol, values], idx) => ({
                  label: symbol,
                  data: values,
                  borderColor: COLORS[idx % COLORS.length],
                  backgroundColor: COLORS[idx % COLORS.length] + "20",
                  fill: false,
                  tension: 0.15,
                  pointRadius: 0,
                  pointHoverRadius: 4,
                  borderWidth: 2,
                })),
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                  mode: "index",
                  intersect: false,
                },
                plugins: {
                  legend: {
                    position: "top",
                    labels: {
                      usePointStyle: true,
                      boxWidth: 8,
                      padding: 16,
                      font: { size: 11 },
                    },
                  },
                  tooltip: {
                    mode: "index",
                    intersect: false,
                    callbacks: {
                      label: (ctx) => `${ctx.dataset.label}: ${(ctx.parsed.y ?? 0).toFixed(1)}`,
                    },
                  },
                },
                scales: {
                  x: {
                    grid: { display: false },
                    ticks: {
                      maxTicksLimit: 8,
                      font: { size: 10 },
                      maxRotation: 45,
                    },
                  },
                  y: {
                    beginAtZero: false,
                    grid: {
                      color: "rgba(0,0,0,0.05)",
                    },
                    ticks: {
                      font: { size: 10 },
                      callback: (v: string | number) => (typeof v === "number" ? v.toFixed(0) : v),
                    },
                    title: {
                      display: true,
                      text: "Normalized Price (Base 100)",
                      font: { size: 11 },
                    },
                  },
                },
              }}
            />
          </div>
          <div className="mt-3 text-xs text-gray-400 text-center">
            Y-axis shows price relative to first day (set to 100). Line above 100 = gain, below = loss.
          </div>
        </div>
      )}

      {validSymbols.length >= 2 && Object.keys(stockData).length === 0 && !loading && !error && (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-8 text-center">
          <p className="text-gray-500 dark:text-gray-400">
            Enter stock symbols and click Compare to see the comparison table.
          </p>
        </div>
      )}
    </div>
  );
}
