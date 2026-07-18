"use client";

import { DividendEvent } from "@/lib/services/dividendCalendarService";

interface Props {
  dividends: DividendEvent[];
  loading?: boolean;
  showHoldings?: boolean;
  userHoldings?: Map<string, number>;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function DividendListView({ dividends, loading, showHoldings, userHoldings }: Props) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-slate-700 animate-pulse">
            <div className="h-4 w-48 bg-gray-200 dark:bg-slate-600 rounded mb-2" />
            <div className="h-3 w-32 bg-gray-200 dark:bg-slate-600 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (dividends.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg p-8 text-center border border-gray-200 dark:border-slate-700">
        <div className="text-4xl mb-3">📅</div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">No Dividends Found</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No dividends are scheduled for the selected period.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-slate-700">
            <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Ex-Date</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Symbol</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Company</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Amount</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Yield</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Record Date</th>
            {showHoldings && (
              <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Your Qty</th>
            )}
            {showHoldings && (
              <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Est. Income</th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
          {dividends.map((d) => {
            const qty = userHoldings?.get(d.symbol) || 0;
            const estIncome = (d.dividendPerShare || 0) * qty;
            return (
              <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors">
                <td className="px-4 py-3 text-gray-900 dark:text-white font-medium whitespace-nowrap">
                  {formatDate(d.exDate)}
                </td>
                <td className="px-4 py-3 font-mono font-medium text-gray-900 dark:text-white">
                  {d.symbol}
                </td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-400 max-w-[200px] truncate">
                  {d.companyName}
                </td>
                <td className="px-4 py-3 text-right text-green-600 dark:text-green-400 font-medium whitespace-nowrap">
                  {d.dividendPerShare ? `₹${d.dividendPerShare.toFixed(2)}` : "—"}
                </td>
                <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                  {d.dividendYield !== null ? `${d.dividendYield.toFixed(2)}%` : "—"}
                </td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                  {formatDate(d.recordDate)}
                </td>
                {showHoldings && (
                  <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">
                    {qty > 0 ? qty : "—"}
                  </td>
                )}
                {showHoldings && (
                  <td className={`px-4 py-3 text-right font-medium whitespace-nowrap ${qty > 0 ? "text-green-600 dark:text-green-400" : "text-gray-400 dark:text-gray-500"}`}>
                    {qty > 0 ? `₹${estIncome.toFixed(2)}` : "—"}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
