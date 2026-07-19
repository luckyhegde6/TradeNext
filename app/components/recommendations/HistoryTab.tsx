"use client";

import { useState, useEffect, useMemo } from "react";

interface HistoryStock {
  id: string;
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  screenerAttribution: string[];
  screenerCount: number;
  aiRecommendation: string;
  confidence: number;
  targetPrice: number | null;
  stopLoss: number | null;
  timeHorizon: string;
  reasoning: string | null;
  riskFactors: string | null;
  aiSuccess: boolean | null;
}

interface HistoryRun {
  id: string;
  runDate: string;
  status: string;
  uniqueStocks: number;
  aiProcessed: number;
  executionTimeMs: number;
  stockCount: number;
  stocks: HistoryStock[];
}

interface HistoryTabProps {
  loading: boolean;
}

type StockFilter = "all" | "BUY" | "HOLD" | "SELL";

const statusConfig: Record<string, { bg: string; text: string; label: string; icon: string }> = {
  completed: { bg: "bg-emerald-500/20", text: "text-emerald-300", label: "Completed", icon: "✅" },
  failed: { bg: "bg-red-500/20", text: "text-red-300", label: "Failed", icon: "❌" },
  running: { bg: "bg-amber-500/20", text: "text-amber-300", label: "Running", icon: "⏳" },
};

const recConfig: Record<string, { bg: string; text: string; icon: string }> = {
  BUY: { bg: "bg-emerald-500/15", text: "text-emerald-300", icon: "🟢" },
  HOLD: { bg: "bg-amber-500/15", text: "text-amber-300", icon: "🟡" },
  SELL: { bg: "bg-red-500/15", text: "text-red-300", icon: "🔴" },
};

export default function HistoryTab({ loading }: HistoryTabProps) {
  const [runs, setRuns] = useState<HistoryRun[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [sortBy, setSortBy] = useState<"date" | "stocks" | "confidence">("date");

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await fetch("/api/recommendations/history?limit=30");
      const data = await res.json();
      if (data.success) setRuns(data.runs);
    } catch {
      console.error("Failed to fetch history");
    } finally {
      setLoadingHistory(false);
    }
  };

  const sortedRuns = useMemo(() => {
    const sorted = [...runs];
    switch (sortBy) {
      case "stocks":
        return sorted.sort((a, b) => (b.uniqueStocks || 0) - (a.uniqueStocks || 0));
      case "confidence":
        return sorted.sort((a, b) => {
          const avgA = a.stocks?.length ? a.stocks.reduce((sum, s) => sum + (s.confidence || 0), 0) / a.stocks.length : 0;
          const avgB = b.stocks?.length ? b.stocks.reduce((sum, s) => sum + (s.confidence || 0), 0) / b.stocks.length : 0;
          return avgB - avgA;
        });
      case "date":
      default:
        return sorted.sort((a, b) => new Date(b.runDate).getTime() - new Date(a.runDate).getTime());
    }
  }, [runs, sortBy]);

  const filterStocks = (stocks: HistoryStock[]) => {
    if (stockFilter === "all") return stocks;
    return stocks.filter((s) => s.aiRecommendation === stockFilter);
  };

  if (loadingHistory) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="bg-gray-800/50 rounded-lg p-4 animate-pulse">
            <div className="h-5 bg-gray-700 rounded w-1/3 mb-2" />
            <div className="h-4 bg-gray-700 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-3">📜</div>
        <h3 className="text-lg font-medium text-gray-300">No history yet</h3>
        <p className="text-sm text-gray-500 mt-1">Past recommendations will appear here</p>
      </div>
    );
  }

  return (
    <div>
      {/* ── Controls ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Stock filter pills */}
        <div className="flex gap-1.5">
          {(["all", "BUY", "HOLD", "SELL"] as StockFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setStockFilter(f)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                stockFilter === f
                  ? f === "BUY"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    : f === "SELL"
                      ? "bg-red-500/20 text-red-300 border border-red-500/30"
                      : f === "HOLD"
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                        : "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                  : "bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600"
              }`}
            >
              {f === "all" ? "All" : f}
            </button>
          ))}
        </div>

        <span className="w-px bg-gray-700 h-4" />

        {/* Sort */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">Sort:</span>
          {([
            { id: "date", label: "Date" },
            { id: "stocks", label: "Stocks" },
            { id: "confidence", label: "Confidence" },
          ] as const).map((opt) => (
            <button
              key={opt.id}
              onClick={() => setSortBy(opt.id)}
              className={`px-2 py-0.5 rounded text-xs font-medium transition-all ${
                sortBy === opt.id
                  ? "bg-gray-700 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Run Cards ──────────────────────────────────────── */}
      <div className="space-y-3">
        {sortedRuns.map((run) => {
          const isExpanded = expandedRun === run.id;
          const filteredStocks = filterStocks(run.stocks || []);
          const status = statusConfig[run.status] || statusConfig.running;
          const buyCount = (run.stocks || []).filter((s) => s.aiRecommendation === "BUY").length;
          const holdCount = (run.stocks || []).filter((s) => s.aiRecommendation === "HOLD").length;
          const sellCount = (run.stocks || []).filter((s) => s.aiRecommendation === "SELL").length;
          const avgConfidence = (run.stocks || []).length
            ? Math.round((run.stocks || []).reduce((sum, s) => sum + (s.confidence || 0), 0) / (run.stocks || []).length)
            : 0;

          return (
            <div key={run.id} className="bg-gray-800/50 border border-gray-700/50 rounded-lg overflow-hidden">
              {/* Run header — clickable */}
              <button
                onClick={() => setExpandedRun(isExpanded ? null : run.id)}
                className="w-full text-left p-4 hover:bg-gray-700/30 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`${status.bg} ${status.text} px-2 py-0.5 rounded text-xs font-medium`}>
                      {status.icon} {status.label}
                    </span>
                    <span className="text-sm text-gray-300 font-medium">
                      {new Date(run.runDate).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(run.runDate).toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">
                      {run.executionTimeMs ? `${(run.executionTimeMs / 1000).toFixed(1)}s` : "—"}
                    </span>
                    <span className="text-xs text-gray-400">
                      {isExpanded ? "▲" : "▼"}
                    </span>
                  </div>
                </div>

                <div className="flex gap-3 text-xs text-gray-400">
                  <span>{run.uniqueStocks} stocks</span>
                  <span>{run.aiProcessed} AI analyzed</span>
                  <span className="text-blue-400">🎯 Avg {avgConfidence}%</span>
                  {buyCount > 0 && <span className="text-emerald-400">🟢 {buyCount} BUY</span>}
                  {holdCount > 0 && <span className="text-amber-400">🟡 {holdCount} HOLD</span>}
                  {sellCount > 0 && <span className="text-red-400">🔴 {sellCount} SELL</span>}
                </div>
              </button>

              {/* Expanded: individual stocks */}
              {isExpanded && filteredStocks.length > 0 && (
                <div className="border-t border-gray-700/50 p-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-500 border-b border-gray-700/50">
                          <th className="text-left py-2 px-2 font-medium">Symbol</th>
                          <th className="text-right py-2 px-2 font-medium">Price</th>
                          <th className="text-right py-2 px-2 font-medium">Change</th>
                          <th className="text-center py-2 px-2 font-medium">Rec</th>
                          <th className="text-right py-2 px-2 font-medium">Confidence</th>
                          <th className="text-right py-2 px-2 font-medium">Target</th>
                          <th className="text-right py-2 px-2 font-medium">Stop Loss</th>
                          <th className="text-center py-2 px-2 font-medium">Term</th>
                          <th className="text-left py-2 px-2 font-medium">Screeners</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredStocks.map((stock) => {
                          const rec = recConfig[stock.aiRecommendation] || recConfig.HOLD;
                          const changeColor = stock.change >= 0 ? "text-emerald-400" : "text-red-400";
                          const returnPct = stock.targetPrice && stock.price
                            ? ((stock.targetPrice - stock.price) / stock.price * 100).toFixed(1)
                            : null;

                          return (
                            <tr
                              key={stock.id}
                              className="border-b border-gray-700/30 hover:bg-gray-700/20 transition-colors"
                            >
                              <td className="py-2 px-2">
                                <a
                                  href={`/company/${stock.symbol}`}
                                  className="text-blue-400 hover:text-blue-300 font-medium"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {stock.symbol}
                                </a>
                              </td>
                              <td className="py-2 px-2 text-right text-gray-300">
                                ₹{stock.price?.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                              </td>
                              <td className={`py-2 px-2 text-right ${changeColor}`}>
                                {stock.change >= 0 ? "+" : ""}
                                {stock.change?.toFixed(2)}
                              </td>
                              <td className="py-2 px-2 text-center">
                                <span className={`${rec.bg} ${rec.text} px-1.5 py-0.5 rounded font-medium`}>
                                  {rec.icon} {stock.aiRecommendation}
                                </span>
                              </td>
                              <td className="py-2 px-2 text-right">
                                <span className={`font-medium ${
                                  stock.confidence >= 70 ? "text-emerald-400" :
                                  stock.confidence >= 50 ? "text-amber-400" :
                                  "text-red-400"
                                }`}>
                                  {stock.confidence}%
                                </span>
                              </td>
                              <td className="py-2 px-2 text-right text-gray-300">
                                {stock.targetPrice
                                  ? `₹${stock.targetPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
                                  : "—"}
                                {returnPct && (
                                  <span className="text-emerald-400 ml-1">+{returnPct}%</span>
                                )}
                              </td>
                              <td className="py-2 px-2 text-right text-gray-300">
                                {stock.stopLoss
                                  ? `₹${stock.stopLoss.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
                                  : "—"}
                              </td>
                              <td className="py-2 px-2 text-center">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                  stock.timeHorizon === "short"
                                    ? "bg-blue-500/15 text-blue-300"
                                    : stock.timeHorizon === "long"
                                      ? "bg-purple-500/15 text-purple-300"
                                      : "bg-gray-700 text-gray-300"
                                }`}>
                                  {stock.timeHorizon}
                                </span>
                              </td>
                              <td className="py-2 px-2">
                                <div className="flex flex-wrap gap-1">
                                  {(stock.screenerAttribution || []).slice(0, 2).map((name) => (
                                    <span key={name} className="px-1.5 py-0.5 rounded bg-gray-700 text-gray-400 text-[10px]">
                                      {name.length > 15 ? name.slice(0, 15) + "…" : name}
                                    </span>
                                  ))}
                                  {(stock.screenerAttribution || []).length > 2 && (
                                    <span className="px-1.5 py-0.5 rounded bg-gray-700 text-gray-500 text-[10px]">
                                      +{(stock.screenerAttribution || []).length - 2}
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {filteredStocks.length === 0 && (
                    <div className="text-center py-4 text-sm text-gray-500">
                      No {stockFilter} recommendations in this run
                    </div>
                  )}
                </div>
              )}

              {isExpanded && (!run.stocks || run.stocks.length === 0) && (
                <div className="border-t border-gray-700/50 p-4 text-center text-sm text-gray-500">
                  No stock data available for this run
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
