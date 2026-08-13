"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FOChainData, FOContract } from "@/lib/services/nse-fo-api";
import { FO_ELIGIBLE_SYMBOLS } from "@/lib/services/foSymbols";

interface OptionChainViewerProps {
  symbol: string;
  onSymbolChange: (symbol: string) => void;
}

/**
 * NSE option chain viewer — mirrors the NSE option-chain page layout:
 * "View Options Contracts for:" Select Symbol / Expiry Date / Strike Price.
 * CE | Strike | PE table with last price, OI, OI-change %, IV, volume, bid/ask,
 * plus per-side totals (total OI + total volume) from records.filtered.
 * Data comes from the server proxy /api/fo/chain (option-chain-v3, cached via nseFetch).
 */
export default function OptionChainViewer({ symbol, onSymbolChange }: OptionChainViewerProps) {
  const [chain, setChain] = useState<FOChainData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expiry, setExpiry] = useState<string>("");
  const [strikeFilter, setStrikeFilter] = useState<string>("");

  const loadChain = useCallback(async (sym: string, exp: string) => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ symbol: sym });
      if (exp) qs.set("expiry", exp);
      const res = await fetch(`/api/fo/chain?${qs.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch option chain");
      const data: FOChainData = await res.json();
      setChain(data);
      setExpiry((prev) => (prev && data.expiries.includes(prev) ? prev : data.expiries[0] || ""));
      setStrikeFilter("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch option chain");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChain(symbol, "");
  }, [symbol, loadChain]);

  const contracts = useMemo(() => {
    if (!chain) return [];
    const byExpiry = expiry ? chain.contracts.filter((c) => c.expiry === expiry) : chain.contracts;
    if (!strikeFilter) return byExpiry;
    const strike = Number(strikeFilter);
    return byExpiry.filter((c) => c.strike === strike);
  }, [chain, expiry, strikeFilter]);

  const strikes = useMemo(
    () => Array.from(new Set(contracts.map((c) => c.strike))).sort((a, b) => a - b),
    [contracts]
  );
  const spot = chain?.underlyingValue ?? 0;
  const filtered = chain?.filtered;
  const ceTot = filtered?.CE;
  const peTot = filtered?.PE;

  const atmIndex = strikes.findIndex((s) => s >= spot);

  const contractCell = (c: FOContract | undefined, spotDiff: number) => {
    if (!c) return <td className="px-3 py-2 text-center text-gray-300 dark:text-gray-600 text-xs">—</td>;
    const isITM = (c.type === "CE" && spotDiff < 0) || (c.type === "PE" && spotDiff > 0);
    const oiChange = c.changeinOpenInterest;
    const oiChangePct = c.pchangeinOpenInterest;
    return (
      <td className="px-3 py-2 text-right text-xs">
        <div className="font-semibold text-gray-900 dark:text-white">{c.lastPrice.toFixed(2)}</div>
        <div className={`text-[10px] ${isITM ? "text-indigo-500 dark:text-indigo-400" : "text-gray-400 dark:text-gray-500"}`}>
          OI {c.openInterest.toLocaleString("en-IN")} · IV {(c.impliedVolatility * 100).toFixed(1)}%
        </div>
        <div className="text-[10px] text-gray-400 dark:text-gray-500">
          {oiChange !== 0 || oiChangePct !== 0 ? (
            <span className={oiChange > 0 ? "text-emerald-500" : oiChange < 0 ? "text-rose-500" : ""}>
              ΔOI {oiChange > 0 ? "+" : ""}{oiChange.toLocaleString("en-IN")} ({oiChangePct > 0 ? "+" : ""}{oiChangePct.toFixed(1)}%)
            </span>
          ) : (
            <span>V {c.volume.toLocaleString("en-IN")}</span>
          )}
          {" · "}
          {c.bidPrice?.toFixed(2)}/{c.askPrice?.toFixed(2)}
        </div>
      </td>
    );
  };

  const totalsBar = ceTot && peTot ? (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-4 py-3 border-b border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/40">
      <div>
        <p className="text-[10px] font-medium uppercase text-gray-500 dark:text-gray-400">CE Total OI</p>
        <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{ceTot.totOI.toLocaleString("en-IN")}</p>
      </div>
      <div>
        <p className="text-[10px] font-medium uppercase text-gray-500 dark:text-gray-400">CE Volume</p>
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{ceTot.totVol.toLocaleString("en-IN")}</p>
      </div>
      <div>
        <p className="text-[10px] font-medium uppercase text-gray-500 dark:text-gray-400">PE Total OI</p>
        <p className="text-sm font-bold text-rose-600 dark:text-rose-400">{peTot.totOI.toLocaleString("en-IN")}</p>
      </div>
      <div>
        <p className="text-[10px] font-medium uppercase text-gray-500 dark:text-gray-400">PE Volume</p>
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{peTot.totVol.toLocaleString("en-IN")}</p>
      </div>
    </div>
  ) : null;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800">
      <div className="flex flex-col gap-3 px-4 py-3 border-b border-gray-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            View Options Contracts for:
          </span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <select
            value={symbol}
            onChange={(e) => onSymbolChange(e.target.value)}
            aria-label="Select Symbol"
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
          >
            {FO_ELIGIBLE_SYMBOLS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={expiry}
            onChange={(e) => {
              const next = e.target.value;
              setExpiry(next);
              setStrikeFilter("");
              if (next) loadChain(symbol, next);
            }}
            aria-label="Expiry Date"
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            disabled={!chain?.expiries?.length}
          >
            {(chain?.expiries || []).length === 0 ? (
              <option value="">No expiries</option>
            ) : (
              chain!.expiries.map((d) => (
                <option key={d} value={d}>{new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</option>
              ))
            )}
          </select>
          <select
            value={strikeFilter}
            onChange={(e) => setStrikeFilter(e.target.value)}
            aria-label="Strike Price"
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            disabled={strikes.length === 0}
          >
            <option value="">All Strikes</option>
            {strikes.map((s) => (
              <option key={s} value={s}>{s.toLocaleString("en-IN")}</option>
            ))}
          </select>
          <div className="text-sm text-gray-600 dark:text-gray-300 sm:ml-auto">
            Spot: <span className="font-semibold">₹{spot ? spot.toLocaleString("en-IN") : "—"}</span>
            {chain?.timestamp ? (
              <span className="text-xs text-gray-400 ml-2">as of {new Date(chain.timestamp).toLocaleTimeString("en-IN")}</span>
            ) : null}
          </div>
        </div>
      </div>

      {totalsBar}

      <div className="overflow-x-auto">
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 bg-gray-100 dark:bg-slate-800 rounded animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <p className="text-center py-12 text-gray-500">{error} — NSE may be unreachable right now.</p>
        ) : strikes.length === 0 ? (
          <p className="text-center py-12 text-gray-500">No option contracts available for {symbol}.</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-slate-800">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase" colSpan={2}>Call (CE)</th>
                <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-20">Strike</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase" colSpan={2}>Put (PE)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {strikes.map((strike, idx) => {
                const spotDiff = strike - spot;
                const ce = contracts.find((c) => c.strike === strike && c.type === "CE");
                const pe = contracts.find((c) => c.strike === strike && c.type === "PE");
                const isATM = idx === atmIndex;
                return (
                  <tr key={strike} className={isATM ? "bg-blue-50/50 dark:bg-blue-900/10" : "hover:bg-gray-50 dark:hover:bg-slate-800/50"}>
                    {contractCell(ce, spotDiff)}
                    <td className="px-3 py-2 text-center">
                      <span className={`text-xs font-bold ${isATM ? "text-blue-600 dark:text-blue-400" : "text-gray-700 dark:text-gray-300"}`}>
                        {strike.toLocaleString("en-IN")}
                      </span>
                    </td>
                    {contractCell(pe, spotDiff)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
