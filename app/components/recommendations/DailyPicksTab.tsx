"use client";

import { useState, useMemo } from "react";
import RecommendationCard from "./RecommendationCard";
import {
  classifyStock,
  getCategoryMeta,
  isNifty50,
  isBluechip,
  isLargeCap,
  isMidCap,
  type StockCategory,
} from "@/lib/services/marketCapClassification";

interface Stock {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  screenerAttribution: string[];
  screenerCount: number;
  aiRecommendation: string;
  confidence: number;
  targetPrice: number;
  stopLoss: number;
  timeHorizon: string;
  reasoning: string;
  riskFactors: string[];
  // Tracker status for highlighting
  trackerStatus?: string;
  entryPrice?: number;
  currentPrice?: number;
  createdAt?: string;
}

interface DailyPicksTabProps {
  stocks: Stock[];
  runDate: string | null;
  loading: boolean;
}

type SortKey = "screener" | "volume" | "price" | "confidence" | "marketCap";
type CapFilter = "all" | "nifty50" | "bluechip" | "large_cap" | "mid_cap";

const PAGE_SIZE = 20;

const sortOptions: { id: SortKey; label: string }[] = [
  { id: "screener", label: "Screener Score" },
  { id: "marketCap", label: "Market Cap" },
  { id: "volume", label: "Volume" },
  { id: "price", label: "Price" },
  { id: "confidence", label: "Confidence" },
];

const capFilters: { id: CapFilter; label: string; icon?: string }[] = [
  { id: "all", label: "All" },
  { id: "nifty50", label: "NIFTY 50", icon: "⭐" },
  { id: "bluechip", label: "Bluechip", icon: "💎" },
  { id: "large_cap", label: "Large Cap", icon: "🏛" },
  { id: "mid_cap", label: "Mid Cap", icon: "📊" },
];

export default function DailyPicksTab({ stocks, runDate, loading }: DailyPicksTabProps) {
  // ─── State ─────────────────────────────────────────────────────────
  const [recFilter, setRecFilter] = useState<string>("all");
  const [timeFilter, setTimeFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortKey>("screener");
  const [capFilter, setCapFilter] = useState<CapFilter>("all");
  const [highlightCaps, setHighlightCaps] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // ─── Filter + Sort ─────────────────────────────────────────────────
  const processedStocks = useMemo(() => {
    let result = [...stocks];

    // 1. Recommendation filter
    if (recFilter !== "all") {
      result = result.filter((s) => s.aiRecommendation === recFilter);
    }

    // 2. Time horizon filter
    if (timeFilter !== "all") {
      result = result.filter((s) => s.timeHorizon === timeFilter);
    }

    // 3. Market cap filter
    if (capFilter === "nifty50") {
      result = result.filter((s) => isNifty50(s.symbol));
    } else if (capFilter === "bluechip") {
      result = result.filter((s) => isBluechip(s.symbol));
    } else if (capFilter === "large_cap") {
      result = result.filter((s) => isLargeCap(s.symbol));
    } else if (capFilter === "mid_cap") {
      result = result.filter((s) => isMidCap(s.symbol));
    }

    // 4. Sort
    result.sort((a, b) => {
      // If highlight caps is on, primary sort by category
      if (highlightCaps && capFilter === "all") {
        const catA = getCategoryMeta(classifyStock(a.symbol));
        const catB = getCategoryMeta(classifyStock(b.symbol));
        if (catA.sortPriority !== catB.sortPriority) {
          return catA.sortPriority - catB.sortPriority;
        }
      }

      // Secondary sort by selected criterion
      switch (sortBy) {
        case "marketCap": {
          // Sort by category priority: NIFTY50 > Bluechip > LargeCap > MidCap > other
          const catA = getCategoryMeta(classifyStock(a.symbol));
          const catB = getCategoryMeta(classifyStock(b.symbol));
          return catA.sortPriority - catB.sortPriority || (Number(b.screenerCount) || 0) - (Number(a.screenerCount) || 0);
        }
        case "volume":
          return (Number(b.volume) || 0) - (Number(a.volume) || 0);
        case "price":
          return (Number(b.price) || 0) - (Number(a.price) || 0);
        case "confidence":
          return (Number(b.confidence) || 0) - (Number(a.confidence) || 0);
        case "screener":
        default:
          return (Number(b.screenerCount) || 0) - (Number(a.screenerCount) || 0);
      }
    });

    return result;
  }, [stocks, recFilter, timeFilter, sortBy, capFilter, highlightCaps]);

  const visibleStocks = processedStocks.slice(0, visibleCount);
  const hasMore = visibleCount < processedStocks.length;

  // ─── Stats ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const nifty50Count = stocks.filter((s) => isNifty50(s.symbol)).length;
    const bluechipCount = stocks.filter((s) => isBluechip(s.symbol)).length;
    const largeCapCount = stocks.filter((s) => isLargeCap(s.symbol)).length;
    const midCapCount = stocks.filter((s) => isMidCap(s.symbol)).length;
    return { nifty50Count, bluechipCount, largeCapCount, midCapCount };
  }, [stocks]);

  // ─── Loading ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-gray-800/50 rounded-xl p-5 animate-pulse">
            <div className="h-6 bg-gray-700 rounded w-1/4 mb-3" />
            <div className="h-8 bg-gray-700 rounded w-1/3 mb-3" />
            <div className="grid grid-cols-3 gap-2">
              <div className="h-12 bg-gray-700 rounded" />
              <div className="h-12 bg-gray-700 rounded" />
              <div className="h-12 bg-gray-700 rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ─── Empty ─────────────────────────────────────────────────────────
  if (stocks.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-3">📊</div>
        <h3 className="text-lg font-medium text-gray-300">No recommendations yet</h3>
        <p className="text-sm text-gray-500 mt-1">Next scan at 10:00 AM IST tomorrow</p>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <div>
      {/* Run info */}
      {runDate && (
        <div className="text-xs text-gray-500 mb-4">
          Last updated: {new Date(runDate).toLocaleString("en-IN")} &bull;{" "}
          {stocks.length} stocks total &bull; showing {processedStocks.length} after filters
        </div>
      )}

      {/* ── Row 1: Recommendation + Time Horizon Filters ───────────── */}
      <div className="flex flex-wrap gap-2 mb-3">
        {[
          { id: "all", label: "All" },
          { id: "BUY", label: "Buy" },
          { id: "HOLD", label: "Hold" },
          { id: "SELL", label: "Sell" },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setRecFilter(f.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              recFilter === f.id
                ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                : "bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600"
            }`}
          >
            {f.label}
          </button>
        ))}

        <span className="w-px bg-gray-700 mx-1" />

        {[
          { id: "all", label: "Any Term" },
          { id: "short", label: "Short" },
          { id: "medium", label: "Medium" },
          { id: "long", label: "Long" },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setTimeFilter(f.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              timeFilter === f.id
                ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                : "bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Row 2: Market Cap Filters + Stats ──────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {capFilters.map((f) => {
          const count =
            f.id === "nifty50"
              ? stats.nifty50Count
              : f.id === "bluechip"
                ? stats.bluechipCount
                : f.id === "large_cap"
                  ? stats.largeCapCount
                  : f.id === "mid_cap"
                    ? stats.midCapCount
                    : stocks.length;
          return (
            <button
              key={f.id}
              onClick={() => setCapFilter(f.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                capFilter === f.id
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600"
              }`}
            >
              {f.icon && `${f.icon} `}
              {f.label}
              {f.id !== "all" && (
                <span className="ml-1 text-[10px] opacity-60">({count})</span>
              )}
            </button>
          );
        })}

        <span className="w-px bg-gray-700 mx-1" />

        {/* Highlight toggle */}
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={highlightCaps}
            onChange={(e) => setHighlightCaps(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500/30"
          />
          <span className="text-xs text-gray-400">Large &amp; Mid Cap top</span>
        </label>
      </div>

      {/* ── Row 3: Sort + Count ────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-xs text-gray-500">Sort by:</span>
        {sortOptions.map((opt) => (
          <button
            key={opt.id}
            onClick={() => setSortBy(opt.id)}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
              sortBy === opt.id
                ? "bg-gray-700 text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {opt.label}
          </button>
        ))}

        <span className="ml-auto text-xs text-gray-500">
          Showing {visibleStocks.length} of {processedStocks.length}
        </span>
      </div>

      {/* ── Cards Grid ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {visibleStocks.map((stock) => {
          const category = classifyStock(stock.symbol);
          const catMeta = getCategoryMeta(category);
          const showBadge = highlightCaps && capFilter === "all" && category !== "other";

          // Tracker status styling
          const trackerBadge = stock.trackerStatus && stock.trackerStatus !== "active"
            ? {
                target_achieved: { bg: "bg-emerald-500/20", text: "text-emerald-300", label: "🎯 TARGET" },
                stop_loss_hit: { bg: "bg-red-500/20", text: "text-red-300", label: "🛑 SL HIT" },
                expired: { bg: "bg-gray-600/20", text: "text-gray-400", label: "⏰ EXPIRED" },
              }[stock.trackerStatus as "target_achieved" | "stop_loss_hit" | "expired"]
            : null;

          // Days since recommendation
          const daysSince = stock.createdAt
            ? Math.floor((Date.now() - new Date(stock.createdAt).getTime()) / (1000 * 60 * 60 * 24))
            : null;

          return (
            <div key={stock.symbol} className="relative">
              {/* Category badge */}
              {showBadge && (
                <div
                  className={`absolute -top-2 -right-2 z-10 px-2 py-0.5 rounded-full text-[10px] font-bold border ${catMeta.bgColor} ${catMeta.textColor} ${catMeta.borderColor}`}
                >
                  {catMeta.label}
                </div>
              )}
              {/* Tracker status badge */}
              {trackerBadge && (
                <div className={`absolute -top-2 left-2 z-10 px-2 py-0.5 rounded-full text-[10px] font-bold ${trackerBadge.bg} ${trackerBadge.text}`}>
                  {trackerBadge.label}
                </div>
              )}
              <RecommendationCard {...stock} />
              {/* Date stamp */}
              {daysSince !== null && (
                <div className="text-[10px] text-gray-500 mt-1 px-1">
                  {daysSince === 0 ? "Today" : daysSince === 1 ? "Yesterday" : `${daysSince}d ago`}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Load More ──────────────────────────────────────────────── */}
      {hasMore && (
        <div className="mt-6 text-center">
          <button
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            className="px-6 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded-lg border border-gray-700 hover:border-gray-600 transition-all"
          >
            Load More ({processedStocks.length - visibleCount} remaining)
          </button>
        </div>
      )}

      {/* ── All Shown ──────────────────────────────────────────────── */}
      {!hasMore && processedStocks.length > PAGE_SIZE && (
        <div className="mt-6 text-center text-xs text-gray-500">
          All {processedStocks.length} stocks shown
        </div>
      )}
    </div>
  );
}
