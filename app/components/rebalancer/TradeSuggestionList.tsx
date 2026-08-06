"use client";

import { RebalancerAction } from "@/lib/services/rebalancerTypes";

interface Props {
  actions: RebalancerAction[];
  loading?: boolean;
}

export default function TradeSuggestionList({ actions, loading }: Props) {
  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 animate-pulse p-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 bg-gray-200 dark:bg-slate-600 rounded mb-2" />
        ))}
      </div>
    );
  }

  const buyActions = actions.filter((a) => a.type === "BUY");
  const sellActions = actions.filter((a) => a.type === "SELL");
  const totalBuy = buyActions.reduce((s, a) => s + a.amount, 0);
  const totalSell = sellActions.reduce((s, a) => s + a.amount, 0);

  if (actions.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg p-6 text-center border border-gray-200 dark:border-slate-700">
        <p className="text-gray-400 text-sm">No trade suggestions available.</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
      <div className="p-4 border-b border-gray-200 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Trade Suggestions</h3>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-4 p-4 border-b border-gray-200 dark:border-slate-700">
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">Total to BUY</p>
          <p className="text-lg font-bold text-green-600 dark:text-green-400">
            ₹{totalBuy.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-gray-400">{buyActions.length} categort{buyActions.length !== 1 ? "ies" : "y"}</p>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">Total to SELL</p>
          <p className="text-lg font-bold text-red-600 dark:text-red-400">
            ₹{totalSell.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-gray-400">{sellActions.length} categort{sellActions.length !== 1 ? "ies" : "y"}</p>
        </div>
      </div>

      {/* Sell list */}
      {sellActions.length > 0 && (
        <div className="p-4 border-b border-gray-200 dark:border-slate-700">
          <p className="text-xs font-medium text-red-600 dark:text-red-400 uppercase mb-2">Sell (Overallocated)</p>
          <div className="space-y-2">
            {sellActions.map((a, i) => (
              <div key={i} className="flex items-center justify-between bg-red-50 dark:bg-red-900/10 rounded-lg p-3">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{a.category}</p>
                  <p className="text-xs text-gray-500">
                    {a.targetPercent.toFixed(1)}% target vs {a.currentPercent.toFixed(1)}% current
                  </p>
                  {a.tickers && a.tickers.length > 0 && (
                    <p className="text-xs text-gray-400 mt-0.5">Holdings: {a.tickers.join(", ")}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-red-600 dark:text-red-400">
                    -₹{a.amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-xs text-gray-400">Reduce by {a.drift.toFixed(1)}%</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Buy list */}
      {buyActions.length > 0 && (
        <div className="p-4">
          <p className="text-xs font-medium text-green-600 dark:text-green-400 uppercase mb-2">Buy (Underallocated)</p>
          <div className="space-y-2">
            {buyActions.map((a, i) => (
              <div key={i} className="flex items-center justify-between bg-green-50 dark:bg-green-900/10 rounded-lg p-3">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{a.category}</p>
                  <p className="text-xs text-gray-500">
                    {a.targetPercent.toFixed(1)}% target vs {a.currentPercent.toFixed(1)}% current
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-green-600 dark:text-green-400">
                    +₹{a.amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-xs text-gray-400">Increase by {a.drift.toFixed(1)}%</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
