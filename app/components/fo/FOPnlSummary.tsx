"use client";

import { FOComputedPosition } from "@/lib/services/foPnlService";

interface FOPnlSummaryProps {
  positions: FOComputedPosition[];
}

/**
 * Realized / Unrealized / Total P&L summary cards for F&O positions.
 * Realized = closed positions' settled P&L; Unrealized = open positions marked-to-market.
 */
export default function FOPnlSummary({ positions }: FOPnlSummaryProps) {
  const realized = positions
    .filter((p) => p.status === "CLOSED")
    .reduce((sum, p) => sum + p.pnl, 0);
  const unrealized = positions
    .filter((p) => p.status === "OPEN")
    .reduce((sum, p) => sum + p.pnl, 0);
  const total = realized + unrealized;

  const fmt = (v: number) =>
    `${v < 0 ? "-" : "+"}₹${Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const cardClass = (v: number) =>
    v > 0 ? "text-green-600 dark:text-green-400" : v < 0 ? "text-red-600 dark:text-red-400" : "text-gray-600 dark:text-gray-400";

  const cards = [
    { label: "Realized P&L", value: fmt(realized), valueClass: cardClass(realized) },
    { label: "Unrealized P&L", value: fmt(unrealized), valueClass: cardClass(unrealized) },
    { label: "Total P&L", value: fmt(total), valueClass: cardClass(total) },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4"
        >
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{c.label}</p>
          <p className={`text-2xl font-bold mt-1 ${c.valueClass}`}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}
