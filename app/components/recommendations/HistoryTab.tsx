"use client";

import { useState, useEffect, useMemo } from "react";

interface TopStock {
  id: string;
  symbol: string;
  runId: string;
  screenerCount: number;
  screenerAttribution: string[];
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  aiRecommendation: string;
  confidence: number;
  targetPrice: number | null;
  stopLoss: number | null;
  timeHorizon: string;
  reasoning: string | null;
  riskFactors: string | null;
  aiSuccess: boolean | null;
  runDate: string;
  runStatus: string;
}

interface HistoryTabProps {
  loading: boolean;
}

type StockFilter = "all" | "BUY" | "HOLD" | "SELL";

const recConfig: Record<string, { bg: string; text: string; icon: string }> = {
  BUY: { bg: "bg-emerald-500/15", text: "text-emerald-300", icon: "🟢" },
  HOLD: { bg: "bg-amber-500/15", text: "text-amber-300", icon: "🟡" },
  SELL: { bg: "bg-red-500/15", text: "text-red-300", icon: "🔴" },
};

export default function HistoryTab({ loading }: HistoryTabProps) {
  const [stocks, setStocks] = useState<TopStock[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [sortBy, setSortBy] = useState<"confidence" | "screenerCount" | "date" | "price">("screenerCount");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  useEffect(() => {
    fetchStocks();
  }, [stockFilter, page]);

  const fetchStocks = async () => {
    setLoadingHistory(true);
    try {
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(page * pageSize),
      });
      if (stockFilter !== "all") params.set("filter", stockFilter);
      const res = await fetch(`/api/recommendations/top-stocks?${params}`);
      const data = await res.json();
      if (data.success) {
        setStocks(data.stocks);
        setTotal(data.total);
      }
    } catch {
      console.error("Failed to fetch top stocks");
    } finally {
      setLoadingHistory(false);
    }
  };

  const sortedStocks = useMemo(() => {
    const sorted = [...stocks];
    switch (sortBy) {
      case "confidence":
        return sorted.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
      case "screenerCount":
        return sorted.sort((a, b) => (b.screenerCount || 0) - (a.screenerCount || 0));
      case "date":
        return sorted.sort((a, b) => new Date(b.runDate).getTime() - new Date(a.runDate).getTime());
      case "price":
        return sorted.sort((a, b) => (b.price || 0) - (a.price || 0));
      default:
        return sorted;
    }
  }, [stocks, sortBy]);

  const totalPages = Math.ceil(total / pageSize);

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

  if (stocks.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-3">📜</div>
        <h3 className="text-lg font-medium text-gray-300">No recommendations yet</h3>
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
              onClick={() => { setStockFilter(f); setPage(0); }}
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
            { id: "screenerCount", label: "Screeners" },
            { id: "confidence", label: "Confidence" },
            { id: "date", label: "Date" },
            { id: "price", label: "Price" },
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

        <span className="text-xs text-gray-500 ml-auto">{total} total</span>
      </div>

      {/* ── Stock Cards ──────────────────────────────────────── */}
      <div className="space-y-2">
        {sortedStocks.map((stock) => {
          const rec = recConfig[stock.aiRecommendation] || recConfig.HOLD;
          const changeColor = stock.change >= 0 ? "text-emerald-400" : "text-red-400";
          const returnPct = stock.targetPrice && stock.price
            ? ((stock.targetPrice - stock.price) / stock.price * 100).toFixed(1)
            : null;

          return (
            <div
              key={stock.id}
              className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 hover:bg-gray-700/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                {/* Left: Symbol + metrics */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <a
                      href={`/company/${stock.symbol}`}
                      className="text-blue-400 hover:text-blue-300 font-bold text-sm"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {stock.symbol}
                    </a>
                    <span className={`${rec.bg} ${rec.text} px-1.5 py-0.5 rounded text-[10px] font-bold`}>
                      {rec.icon} {stock.aiRecommendation}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      stock.timeHorizon === "short"
                        ? "bg-blue-500/15 text-blue-300"
                        : stock.timeHorizon === "long"
                          ? "bg-purple-500/15 text-purple-300"
                          : "bg-gray-700 text-gray-300"
                    }`}>
                      {stock.timeHorizon}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span className="text-gray-300">
                      ₹{stock.price?.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </span>
                    <span className={changeColor}>
                      {stock.change >= 0 ? "+" : ""}{stock.change?.toFixed(2)} ({stock.changePercent?.toFixed(2)}%)
                    </span>
                    {stock.targetPrice && (
                      <span className="text-emerald-400">
                        Target: ₹{stock.targetPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        {returnPct && ` (+${returnPct}%)`}
                      </span>
                    )}
                    {stock.stopLoss && (
                      <span className="text-red-400">
                        SL: ₹{stock.stopLoss.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </span>
                    )}
                    <span className="text-gray-500">
                      {new Date(stock.runDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  </div>

                  {stock.reasoning && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 line-clamp-2">{stock.reasoning}</p>
                  )}
                </div>

                {/* Right: Confidence + Screeners */}
                <div className="text-right flex-shrink-0">
                  <div className={`text-lg font-bold ${
                    stock.confidence >= 70 ? "text-emerald-400" :
                    stock.confidence >= 50 ? "text-amber-400" :
                    "text-red-400"
                  }`}>
                    {stock.confidence}%
                  </div>
                  <div className="text-[10px] text-gray-500 mb-1">confidence</div>
                  <div className="flex flex-wrap gap-1 justify-end max-w-[140px]">
                    {(stock.screenerAttribution || []).slice(0, 2).map((name) => (
                      <span key={name} className="px-1.5 py-0.5 rounded bg-gray-700 text-gray-400 text-[9px]">
                        {name.length > 12 ? name.slice(0, 12) + "…" : name}
                      </span>
                    ))}
                    {(stock.screenerAttribution || []).length > 2 && (
                      <span className="px-1.5 py-0.5 rounded bg-gray-700 text-gray-500 text-[9px]">
                        +{(stock.screenerAttribution || []).length - 2}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Pagination ─────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="px-3 py-1 text-xs font-medium bg-gray-800 text-gray-300 rounded hover:bg-gray-700 disabled:opacity-30 transition-colors"
          >
            ← Prev
          </button>
          <span className="text-xs text-gray-500">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1 text-xs font-medium bg-gray-800 text-gray-300 rounded hover:bg-gray-700 disabled:opacity-30 transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
