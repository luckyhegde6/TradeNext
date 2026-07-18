"use client";

import { RebalancerAction } from "@/lib/services/rebalancerService";

interface Props {
  actions: RebalancerAction[];
  totalValue: number;
  loading?: boolean;
}

export default function AllocationTable({ actions, totalValue, loading }: Props) {
  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 animate-pulse p-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-10 bg-gray-200 dark:bg-slate-600 rounded mb-2" />
        ))}
      </div>
    );
  }

  if (actions.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg p-6 text-center border border-gray-200 dark:border-slate-700">
        <p className="text-gray-400 text-sm">No allocation data available.</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-200 dark:border-slate-600">
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Category</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Current %</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Target %</th>
              <th className="px-4 py-3 text-center font-medium text-gray-500 dark:text-gray-400">Drift</th>
              <th className="px-4 py-3 text-center font-medium text-gray-500 dark:text-gray-400">Drift Bar</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Action</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
            {actions.map((a, i) => {
              const barWidth = Math.min(Math.abs(a.drift) * 3, 100);
              const isOver = a.currentPercent > a.targetPercent;
              return (
                <tr key={i} className="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{a.category}</td>
                  <td className="px-4 py-3 text-right font-mono text-gray-600 dark:text-gray-400">
                    {a.currentPercent.toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-gray-600 dark:text-gray-400">
                    {a.targetPercent.toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-mono ${
                      a.drift <= 1
                        ? "text-green-600 dark:text-green-400"
                        : a.drift <= 5
                        ? "text-yellow-600 dark:text-yellow-400"
                        : "text-red-600 dark:text-red-400"
                    }`}>
                      {a.drift.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <div className="flex-1 bg-gray-200 dark:bg-slate-600 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            isOver ? "bg-red-400" : "bg-blue-400"
                          }`}
                          style={{ width: `${barWidth}%`, marginLeft: isOver ? `${100 - barWidth}%` : "0" }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      a.type === "BUY"
                        ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                        : a.type === "SELL"
                        ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"
                        : "bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400"
                    }`}>
                      {a.type}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-right font-mono font-medium ${
                    a.type === "BUY"
                      ? "text-green-600 dark:text-green-400"
                      : a.type === "SELL"
                      ? "text-red-600 dark:text-red-400"
                      : "text-gray-400"
                  }`}>
                    {a.type === "HOLD" ? "—" : `₹${a.amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
