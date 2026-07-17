"use client";

import { useState, useEffect, useMemo } from "react";
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
  TimeScale,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { PortfolioSummary } from "@/lib/services/portfolioService";
import type { PortfolioValueHistory } from "@/lib/services/portfolioHistoryService";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler, TimeScale);

interface PnLChartProps {
  portfolio: PortfolioSummary | null;
}

type ViewMode = "overview" | "timeline";

export default function PnLChart({ portfolio }: PnLChartProps) {
  const [view, setView] = useState<ViewMode>("overview");
  const [history, setHistory] = useState<PortfolioValueHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (view !== "timeline") return;
    fetchHistory();
  }, [view]);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch("/api/portfolio/history?maxPoints=120");
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to load history");
      }
      const data = await res.json();
      setHistory(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  };

  // ---------- Overview Mode (existing 2-point chart) ----------
  const overviewData = useMemo(() => {
    if (!portfolio || !portfolio.holdings || portfolio.holdings.length === 0) {
      return null;
    }
    const totalInvested = portfolio.totalInvested;
    const totalCurrent = portfolio.totalValue;
    const totalPnL = portfolio.totalPnl;
    const pnlPercent = portfolio.totalPnlPercent;
    const isProfit = totalPnL >= 0;

    return {
      labels: ["Invested", "Current"],
      datasets: [
        {
          label: "Value (₹)",
          data: [totalInvested, totalCurrent],
          borderColor: isProfit ? "rgb(16, 185, 129)" : "rgb(239, 68, 68)",
          backgroundColor: isProfit ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
          fill: true,
          tension: 0.4,
          pointBackgroundColor: isProfit ? "rgb(16, 185, 129)" : "rgb(239, 68, 68)",
          pointBorderColor: "#fff",
          pointHoverBackgroundColor: "#fff",
          pointHoverBorderColor: isProfit ? "rgb(16, 185, 129)" : "rgb(239, 68, 68)",
        },
      ],
    };
  }, [portfolio]);

  // ---------- Timeline Mode ----------
  const timelineData = useMemo(() => {
    if (!history || history.history.length < 2) return null;

    const dates = history.history.map((p) => p.date);
    const values = history.history.map((p) => p.value);
    const invested = history.history.map((p) => p.invested);
    const isProfit = history.totalPnl >= 0;

    return {
      labels: dates,
      datasets: [
        {
          label: "Portfolio Value",
          data: values,
          borderColor: isProfit ? "rgb(16, 185, 129)" : "rgb(239, 68, 68)",
          backgroundColor: isProfit ? "rgba(16, 185, 129, 0.08)" : "rgba(239, 68, 68, 0.08)",
          fill: true,
          tension: 0.2,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2,
        },
        {
          label: "Total Invested",
          data: invested,
          borderColor: "rgb(99, 102, 241)",
          backgroundColor: "rgba(99, 102, 241, 0.05)",
          fill: false,
          tension: 0.2,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 1.5,
          borderDash: [5, 5],
        },
      ],
    };
  }, [history]);

  // ---------- Empty state ----------
  if (!portfolio || portfolio.holdings.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
        <h2 className="text-xl font-semibold mb-6 text-gray-900 dark:text-white">P&L Overview</h2>
        <div className="h-48 flex items-center justify-center text-gray-500 dark:text-slate-400">
          No holdings data available
        </div>
      </div>
    );
  }

  const totalPnL = portfolio.totalPnl;
  const pnlPercent = portfolio.totalPnlPercent;
  const isProfit = totalPnL >= 0;

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: view === "timeline",
        position: "top" as const,
        labels: { usePointStyle: true, boxWidth: 8, padding: 16 },
      },
      tooltip: {
        callbacks: {
          label: (context: { dataset: { label?: string }; parsed: { y: number | null } }) => {
            return `${context.dataset.label || ""}: ₹${(context.parsed.y || 0).toLocaleString("en-IN")}`;
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: false,
        ticks: {
          callback: (value: number | string) => "₹" + Number(value).toLocaleString("en-IN"),
        },
      },
    },
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
          {view === "overview" ? "P&L Overview" : "P&L Over Time"}
        </h2>
        <div className="flex gap-1 bg-gray-100 dark:bg-slate-800 p-0.5 rounded-lg">
          <button
            onClick={() => setView("overview")}
            className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
              view === "overview" ? "bg-white dark:bg-slate-700 text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setView("timeline")}
            className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
              view === "timeline" ? "bg-white dark:bg-slate-700 text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Timeline
          </button>
        </div>
      </div>

      {/* P&L Badge */}
      <div className={`text-2xl font-bold mb-4 ${isProfit ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
        {isProfit ? "+" : ""}₹{totalPnL.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        <span className="text-sm ml-2">({isProfit ? "+" : ""}{pnlPercent.toFixed(2)}%)</span>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-4">
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-1">Total Invested</p>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">
            ₹{portfolio.totalInvested.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-4">
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-1">Current Value</p>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">
            ₹{portfolio.totalValue.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {/* Chart Area */}
      <div className="h-64">
        {view === "overview" && overviewData && <Line data={overviewData} options={options} />}

        {view === "timeline" && loading && (
          <div className="h-full flex items-center justify-center text-gray-500 dark:text-slate-400">
            Loading history...
          </div>
        )}

        {view === "timeline" && error && (
          <div className="h-full flex flex-col items-center justify-center text-gray-500 dark:text-slate-400 space-y-2">
            <p className="text-red-500 text-sm">{error}</p>
            <button
              onClick={fetchHistory}
              className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        )}

        {view === "timeline" && !loading && !error && timelineData && (
          <Line data={timelineData} options={options} />
        )}

        {view === "timeline" && !loading && !error && !timelineData && (
          <div className="h-full flex items-center justify-center text-gray-500 dark:text-slate-400">
            {history?.history.length === 0
              ? "Not enough transaction history to build timeline"
              : "Historical data not available"}
          </div>
        )}
      </div>

      {/* Timeline Stats */}
      {view === "timeline" && history && history.history.length > 1 && (
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-3">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Data Points</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{history.history.length}</p>
          </div>
          <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-3">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">From</p>
            <p className="text-sm font-bold text-gray-900 dark:text-white">
              {history.history[0]?.date || "-"}
            </p>
          </div>
          <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-3">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">To</p>
            <p className="text-sm font-bold text-gray-900 dark:text-white">
              {history.history[history.history.length - 1]?.date || "-"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
