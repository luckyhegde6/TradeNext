"use client";

import { TaxSummary } from "@/lib/services/taxCalculator";

interface Props {
  summary: TaxSummary;
  loading?: boolean;
}

export default function TaxSummaryCards({ summary, loading }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-slate-700 animate-pulse">
            <div className="h-4 w-24 bg-gray-200 dark:bg-slate-600 rounded mb-3" />
            <div className="h-8 w-20 bg-gray-200 dark:bg-slate-600 rounded" />
          </div>
        ))}
      </div>
    );
  }

  const cards = [
    {
      label: "Total STCG",
      value: `₹${summary.totalSTCG.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
      sub: `${summary.stcgTrades} trade${summary.stcgTrades !== 1 ? "s" : ""}`,
      color: summary.totalSTCG >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400",
      bg: "bg-green-50 dark:bg-green-900/20",
    },
    {
      label: "Total LTCG",
      value: `₹${summary.totalLTCG.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
      sub: `${summary.ltcgTrades} trade${summary.ltcgTrades !== 1 ? "s" : ""}`,
      color: summary.totalLTCG >= 0 ? "text-blue-600 dark:text-blue-400" : "text-red-600 dark:text-red-400",
      bg: "bg-blue-50 dark:bg-blue-900/20",
    },
    {
      label: "Est. ST Tax (15%)",
      value: `₹${summary.estSTTax.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
      sub: `on ₹${Math.max(0, summary.totalSTCG).toLocaleString("en-IN", { maximumFractionDigits: 0 })} gains`,
      color: "text-orange-600 dark:text-orange-400",
      bg: "bg-orange-50 dark:bg-orange-900/20",
    },
    {
      label: "Est. LT Tax (10%)",
      value: `₹${summary.estLTTax.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
      sub: `on ₹${summary.taxableLTCG.toLocaleString("en-IN", { maximumFractionDigits: 0 })} taxable gains`,
      color: "text-purple-600 dark:text-purple-400",
      bg: "bg-purple-50 dark:bg-purple-900/20",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div key={card.label} className={`${card.bg} rounded-lg p-4 border border-gray-200 dark:border-slate-700`}>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            {card.label}
          </p>
          <p className={`text-2xl font-bold mt-1 ${card.color}`}>{card.value}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{card.sub}</p>
        </div>
      ))}
    </div>
  );
}
