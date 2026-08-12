"use client";

import { FOComputedPosition, OptionGreeks } from "@/lib/services/foPnlService";

interface FOPositionTableProps {
  positions: FOComputedPosition[];
  loading: boolean;
  onClose: (id: string, currentPrice: number) => void;
  onDelete: (id: string) => void;
}

const TYPE_BADGE: Record<string, string> = {
  FUTURES: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  CALL: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  PUT: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
};

/**
 * F&O positions table — symbol, type, direction, qty, entry, current, P&L,
 * Greeks (options with strike + expiry), status, and close/delete actions.
 */
export default function FOPositionTable({ positions, loading, onClose, onDelete }: FOPositionTableProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 bg-gray-100 dark:bg-slate-800 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800">
        <p className="text-4xl mb-3">📊</p>
        <p className="text-gray-600 dark:text-gray-300 font-medium">No F&O positions yet</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Add your first futures or options position to start tracking.</p>
      </div>
    );
  }

  const greekShort = (g: OptionGreeks | undefined): string => {
    if (!g) return "—";
    return `Δ ${g.delta.toFixed(2)} · Θ ${g.theta.toFixed(2)}`;
  };

  return (
    <div className="overflow-x-auto bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-slate-800">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Symbol</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Direction</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Qty</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Entry</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Current</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">P&L</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Greeks</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
          {positions.map((p) => (
            <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
              <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{p.symbol}</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-0.5 text-[10px] font-bold rounded ${TYPE_BADGE[p.type] || "bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-gray-300"}`}>
                  {p.type}
                </span>
                {p.strike ? <span className="text-xs text-gray-500 ml-1">{p.strike}</span> : null}
              </td>
              <td className="px-4 py-3">
                <span className={`text-xs font-semibold ${
                  p.direction === "LONG" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                }`}>
                  {p.direction === "LONG" ? "▲ Long" : "▼ Short"}
                </span>
              </td>
              <td className="px-4 py-3 text-right text-sm text-gray-700 dark:text-gray-300">{p.quantity}</td>
              <td className="px-4 py-3 text-right text-sm text-gray-700 dark:text-gray-300">₹{p.entryPrice.toLocaleString("en-IN")}</td>
              <td className="px-4 py-3 text-right text-sm text-gray-700 dark:text-gray-300">
                {p.currentPrice ? `₹${p.currentPrice.toLocaleString("en-IN")}` : "—"}
              </td>
              <td className={`px-4 py-3 text-right text-sm font-semibold ${
                p.pnl > 0 ? "text-green-600 dark:text-green-400" :
                p.pnl < 0 ? "text-red-600 dark:text-red-400" :
                "text-gray-500"
              }`}>
                {p.pnl > 0 ? "+" : ""}₹{p.pnl.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </td>
              <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-mono">{greekShort(p.greeks)}</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-0.5 text-[10px] font-bold rounded ${
                  p.status === "OPEN"
                    ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                    : "bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300"
                }`}>
                  {p.status}
                </span>
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                {p.status === "OPEN" && p.currentPrice != null ? (
                  <button
                    onClick={() => onClose(p.id, p.currentPrice as number)}
                    className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded mr-1"
                  >
                    Close
                  </button>
                ) : null}
                <button
                  onClick={() => onDelete(p.id)}
                  className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
