"use client";

import { DividendSummary } from "@/lib/services/dividendCalendarService";

interface Props {
  summary: DividendSummary;
  loading?: boolean;
}

export default function DividendSummaryCards({ summary, loading }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-slate-700 animate-pulse">
            <div className="h-4 w-20 bg-gray-200 dark:bg-slate-600 rounded mb-3" />
            <div className="h-8 w-28 bg-gray-200 dark:bg-slate-600 rounded" />
          </div>
        ))}
      </div>
    );
  }

  const cards = [
    {
      label: "Upcoming Dividends",
      value: summary.upcomingCount,
      suffix: summary.upcomingCount === 1 ? "" : "",
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-900/20",
    },
    {
      label: "Est. Monthly Income",
      value: `₹${summary.estMonthlyIncome.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
      color: "text-green-600 dark:text-green-400",
      bg: "bg-green-50 dark:bg-green-900/20",
    },
    {
      label: "Est. Annual Income",
      value: `₹${summary.estAnnualIncome.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-900/20",
    },
    {
      label: "Avg Dividend Yield",
      value: summary.avgYield !== null ? `${summary.avgYield.toFixed(2)}%` : "—",
      color: "text-purple-600 dark:text-purple-400",
      bg: "bg-purple-50 dark:bg-purple-900/20",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`${card.bg} rounded-lg p-4 border border-gray-200 dark:border-slate-700`}
        >
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            {card.label}
          </p>
          <p className={`text-2xl font-bold mt-1 ${card.color}`}>{card.value}</p>
        </div>
      ))}
    </div>
  );
}
