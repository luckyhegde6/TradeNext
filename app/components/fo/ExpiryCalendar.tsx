"use client";

import { useCallback, useEffect, useState } from "react";
import type { FOExpiry } from "@/lib/services/nse-fo-api";
import { FO_ELIGIBLE_SYMBOLS } from "@/lib/services/foSymbols";

/**
 * F&O expiry calendar — lists available contract expiries for the selected
 * symbol with a countdown to each (weekly flagged). Data from /api/fo/expiries.
 */
export default function ExpiryCalendar() {
  const [symbol, setSymbol] = useState("NIFTY");
  const [expiries, setExpiries] = useState<FOExpiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (sym: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/fo/expiries?symbol=${encodeURIComponent(sym)}`);
      if (!res.ok) throw new Error("Failed to fetch expiries");
      const data: FOExpiry[] = await res.json();
      setExpiries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch expiries");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(symbol);
  }, [symbol, load]);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Contract Expiries</h3>
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
        >
          {FO_ELIGIBLE_SYMBOLS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="p-4">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 bg-gray-100 dark:bg-slate-800 rounded animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <p className="text-center py-8 text-gray-500">{error} — NSE may be unreachable right now.</p>
        ) : expiries.length === 0 ? (
          <p className="text-center py-8 text-gray-500">No expiry data available for {symbol}.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {expiries.map((e) => (
              <div
                key={e.expiryDate}
                className="flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700"
              >
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    {new Date(e.expiryDate).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
                  </p>
                  <p className="text-xs text-gray-500">
                    {e.daysToExpiry === 0 ? "Today!" : `${e.daysToExpiry} day${e.daysToExpiry === 1 ? "" : "s"} to expiry`}
                  </p>
                </div>
                {e.weekly ? (
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                    Weekly
                  </span>
                ) : (
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300">
                    Monthly
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
