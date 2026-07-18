"use client";

import { useState, useEffect } from "react";
import type { RiskMetrics } from "@/lib/services/portfolioRiskMetricsService";

export default function RiskMetricsCards() {
  const [metrics, setMetrics] = useState<RiskMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchMetrics();
  }, []);

  const fetchMetrics = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch("/api/portfolio/risk-metrics");
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to load risk metrics");
      }
      const data = await res.json();
      setMetrics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load risk metrics");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Risk Metrics</h3>
        <div className="h-16 flex items-center justify-center text-gray-500 dark:text-slate-400">
          Loading...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Risk Metrics</h3>
        <div className="flex items-center justify-between">
          <p className="text-sm text-red-500">{error}</p>
          <button onClick={fetchMetrics} className="text-xs font-bold text-blue-600 hover:text-blue-800">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!metrics || metrics.totalDays === 0) {
    return null; // hide section if no data
  }

  const getSharpeLabel = (s: number) => {
    if (s >= 2) return { label: "Excellent", color: "text-green-600" };
    if (s >= 1) return { label: "Good", color: "text-green-500" };
    if (s >= 0) return { label: "Fair", color: "text-yellow-500" };
    return { label: "Poor", color: "text-red-500" };
  };

  const getDrawdownLabel = (dd: number) => {
    if (dd < 10) return { label: "Low", color: "text-green-500" };
    if (dd < 20) return { label: "Moderate", color: "text-yellow-500" };
    if (dd < 35) return { label: "High", color: "text-orange-500" };
    return { label: "Severe", color: "text-red-500" };
  };

  const formatPct = (val: number) => `${val >= 0 ? "+" : ""}${val.toFixed(1)}%`;
  const formatRatio = (val: number) => val.toFixed(2);

  const sharpeRating = getSharpeLabel(metrics.sharpeRatio);
  const ddRating = getDrawdownLabel(metrics.maxDrawdownPercent);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Risk Metrics</h3>
        <button
          onClick={fetchMetrics}
          className="text-xs font-bold text-blue-600 hover:text-blue-800"
          title="Refresh"
        >
          ↻ Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {/* Sharpe Ratio */}
        <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-3">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Sharpe Ratio</p>
          <p className="text-xl font-black text-gray-900 dark:text-white">{formatRatio(metrics.sharpeRatio)}</p>
          <p className={`text-[10px] font-bold uppercase ${sharpeRating.color}`}>{sharpeRating.label}</p>
        </div>

        {/* Max Drawdown */}
        <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-3">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Max Drawdown</p>
          <p className="text-xl font-black text-red-500">{formatPct(-metrics.maxDrawdownPercent)}</p>
          <p className={`text-[10px] font-bold uppercase ${ddRating.color}`}>{ddRating.label}</p>
        </div>

        {/* Volatility */}
        <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-3">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Volatility (Ann.)</p>
          <p className="text-xl font-black text-gray-900 dark:text-white">{formatPct(metrics.annualizedVolatility)}</p>
          <p className="text-[10px] text-gray-400">Annualized</p>
        </div>

        {/* Annualized Return */}
        <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-3">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Ann. Return</p>
          <p className={`text-xl font-black ${metrics.annualizedReturn >= 0 ? "text-green-600" : "text-red-500"}`}>
            {formatPct(metrics.annualizedReturn)}
          </p>
          <p className="text-[10px] text-gray-400">CAGR</p>
        </div>

        {/* Beta */}
        <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-3">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Beta (vs NIFTY 50)</p>
          <p className="text-xl font-black text-gray-900 dark:text-white">
            {metrics.beta !== null ? formatRatio(metrics.beta) : "—"}
          </p>
          <p className="text-[10px] text-gray-400">
            {metrics.beta !== null
              ? metrics.beta > 1
                ? "Higher Risk"
                : metrics.beta < 0.5
                  ? "Lower Risk"
                  : "Market-like"
              : "Insufficient data"}
          </p>
        </div>

        {/* Win Rate */}
        <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-3">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Win Rate</p>
          <p className={`text-xl font-black ${metrics.winRate >= 50 ? "text-green-600" : "text-red-500"}`}>
            {formatPct(metrics.winRate)}
          </p>
          <p className="text-[10px] text-gray-400">{metrics.positiveDays} up / {metrics.negativeDays} down</p>
        </div>
      </div>
    </div>
  );
}
