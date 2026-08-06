"use client";

import { ComputedTrade } from "@/lib/services/taxCalculator";

interface Props {
  trades: ComputedTrade[];
  loading?: boolean;
}

export default function TaxTradeTable({ trades, loading }: Props) {
  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden animate-pulse">
        <div className="p-4 space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-8 bg-gray-200 dark:bg-slate-600 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg p-8 text-center border border-gray-200 dark:border-slate-700">
        <div className="text-4xl mb-3">📄</div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">No Capital Gains Transactions</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No sell transactions were found for this financial year.
          {trades.length === 0 && " If you held positions for more than 12 months without selling, there are no realized gains to report."}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-200 dark:border-slate-600">
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Symbol</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Buy Date</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Sell Date</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Qty</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Buy Price</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Sell Price</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Gain/Loss</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Gain %</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Holding Days</th>
              <th className="px-4 py-3 text-center font-medium text-gray-500 dark:text-gray-400">Type</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Tax Est.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
            {trades.map((t, i) => (
              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors">
                <td className="px-4 py-3 font-mono font-medium text-gray-900 dark:text-white">{t.symbol}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">{t.buyDate}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">{t.sellDate}</td>
                <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">{t.quantity}</td>
                <td className="px-4 py-3 text-right font-mono text-gray-600 dark:text-gray-400">
                  ₹{t.buyPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-3 text-right font-mono text-gray-600 dark:text-gray-400">
                  ₹{t.sellPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </td>
                <td className={`px-4 py-3 text-right font-medium font-mono whitespace-nowrap ${
                  t.gain >= 0
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                }`}>
                  {t.gain >= 0 ? "+" : ""}₹{t.gain.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </td>
                <td className={`px-4 py-3 text-right font-mono ${
                  t.gainPercent >= 0
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                }`}>
                  {t.gainPercent >= 0 ? "+" : ""}{t.gainPercent.toFixed(1)}%
                </td>
                <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">{t.holdingDays}d</td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    t.type === "STCG"
                      ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300"
                      : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                  }`}>
                    {t.type}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-gray-500 dark:text-gray-400 text-xs">
                  {t.taxEstimate > 0 ? `₹${t.taxEstimate.toFixed(0)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
