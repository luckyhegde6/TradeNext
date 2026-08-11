"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Types (mirror lib/services/recommendationPerformanceService) ─────────

interface PerformanceColumn {
  key: string;
  label: string;
  sortable?: boolean;
  filterable?: boolean;
  align?: "left" | "right" | "center";
  defaultValue?: boolean;
  hint?: string;
}

interface PerformanceItem {
  id: string;
  symbol: string;
  status: string;
  category: string | null;
  entryPrice: number;
  currentPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  returnPercent: number | null;
  daysTracked: number;
  aiRecommendation: string | null;
  confidence: number | null;
  reasoning: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
}

interface PerformanceResponse {
  success: boolean;
  items: PerformanceItem[];
  total: number;
  columns: PerformanceColumn[];
}

interface PerformanceTabProps {
  loading: boolean;
}

// localStorage key for column show/hide preferences
const COLUMNS_STORAGE_KEY = "tradenext:rec-perf-columns";

// Status badge styling
const statusConfig: Record<string, { label: string; cls: string }> = {
  tracking: { label: "Tracking", cls: "bg-blue-500/15 text-blue-300" },
  target_achieved: { label: "🎯 Target Hit", cls: "bg-emerald-500/15 text-emerald-300" },
  stop_loss_hit: { label: "🛑 SL Hit", cls: "bg-red-500/15 text-red-300" },
};

// Category chip styling
const categoryConfig: Record<string, { label: string; cls: string }> = {
  btst: { label: "BTST", cls: "bg-cyan-500/15 text-cyan-300" },
  short: { label: "Short Term", cls: "bg-blue-500/15 text-blue-300" },
  swing: { label: "Swing", cls: "bg-violet-500/15 text-violet-300" },
  medium: { label: "Medium", cls: "bg-gray-700 text-gray-300" },
  long: { label: "Long Term", cls: "bg-purple-500/15 text-purple-300" },
};

const recConfig: Record<string, { bg: string; text: string }> = {
  BUY: { bg: "bg-emerald-500/15", text: "text-emerald-300" },
  HOLD: { bg: "bg-amber-500/15", text: "text-amber-300" },
  SELL: { bg: "bg-red-500/15", text: "text-red-300" },
};

const PAGE_SIZE = 25;

export default function PerformanceTab({ loading: _initialLoading }: PerformanceTabProps) {
  const [items, setItems] = useState<PerformanceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [columns, setColumns] = useState<PerformanceColumn[]>([]);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [recFilter, setRecFilter] = useState("all");
  const [sortBy, setSortBy] = useState<
    "createdAt" | "returnPercent" | "symbol" | "confidence" | "entryPrice" | "currentPrice" | "targetPrice" | "stopLoss" | "daysTracked" | "lastCheckedAt"
  >("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

  // Column toggle popover
  const [showColMenu, setShowColMenu] = useState(false);
  // Expandable AI reasoning per row
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Load column preferences from localStorage once columns arrive
  useEffect(() => {
    if (columns.length === 0) return;
    try {
      const saved = localStorage.getItem(COLUMNS_STORAGE_KEY);
      if (saved) {
        const hidden: string[] = JSON.parse(saved);
        setHiddenColumns(new Set(hidden));
      }
    } catch {
      // Ignore corrupt localStorage
    }
  }, [columns]);

  // Persist column preferences
  const toggleColumn = (key: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  };

  const fetchPerformance = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
        sort: sortBy,
        order: sortOrder,
      });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      if (recFilter !== "all") params.set("recommendation", recFilter);

      const res = await fetch(`/api/recommendations/performance?${params}`);
      const data: PerformanceResponse = await res.json();
      if (data.success) {
        setItems(data.items);
        setTotal(data.total);
        if (data.columns.length > 0) setColumns(data.columns);
      } else {
        setError("Failed to load performance data");
      }
    } catch {
      setError("Failed to load performance data");
    } finally {
      setLoading(false);
    }
  }, [page, sortBy, sortOrder, statusFilter, categoryFilter, recFilter]);

  useEffect(() => {
    fetchPerformance();
  }, [fetchPerformance]);

  const handleSort = (key: string) => {
    if (key === sortBy) {
      setSortOrder((o) => (o === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(key as typeof sortBy);
      setSortOrder("desc");
    }
    setPage(0);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const visibleColumns = columns.filter((c) => !hiddenColumns.has(c.key));
  const hiddenCount = hiddenColumns.size;

  if (loading) {
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

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-3">⚠️</div>
        <h3 className="text-lg font-medium text-gray-300">Could not load performance data</h3>
        <p className="text-sm text-gray-500 mt-1">{error}</p>
        <button
          onClick={fetchPerformance}
          className="mt-4 px-4 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 rounded text-xs text-blue-300 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (items.length === 0 && total === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-3">🎯</div>
        <h3 className="text-lg font-medium text-gray-300">No tracked recommendations yet</h3>
        <p className="text-sm text-gray-500 mt-1">
          Recommendations settle here the day after they appear in Today&apos;s Picks
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* ── Controls ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Status filter */}
        <div className="flex gap-1.5">
          {(["all", "tracking", "target_achieved", "stop_loss_hit"] as const).map((f) => (
            <button
              key={f}
              onClick={() => { setStatusFilter(f); setPage(0); }}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                statusFilter === f
                  ? f === "target_achieved"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    : f === "stop_loss_hit"
                      ? "bg-red-500/20 text-red-300 border border-red-500/30"
                      : "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                  : "bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600"
              }`}
            >
              {f === "all" ? "All" : statusConfig[f].label}
            </button>
          ))}
        </div>

        <span className="w-px bg-gray-700 h-4" />

        {/* Category filter */}
        <select
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); setPage(0); }}
          className="bg-gray-800 text-gray-300 text-xs border border-gray-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
        >
          <option value="all">All Categories</option>
          <option value="btst">BTST</option>
          <option value="short">Short Term</option>
          <option value="swing">Swing</option>
          <option value="medium">Medium</option>
          <option value="long">Long Term</option>
        </select>

        {/* AI recommendation filter */}
        <select
          value={recFilter}
          onChange={(e) => { setRecFilter(e.target.value); setPage(0); }}
          className="bg-gray-800 text-gray-300 text-xs border border-gray-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
        >
          <option value="all">All AI Views</option>
          <option value="BUY">BUY</option>
          <option value="HOLD">HOLD</option>
          <option value="SELL">SELL</option>
        </select>

        <span className="text-xs text-gray-500 ml-auto">
          {total} total{hiddenCount > 0 ? ` · ${hiddenCount} columns hidden` : ""}
        </span>
      </div>

      {/* ── Column toggle ────────────────────────────────────── */}
      <div className="relative mb-3">
        <button
          onClick={() => setShowColMenu((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-800 text-gray-300 border border-gray-700 rounded-lg hover:border-gray-600 transition-colors"
        >
          ⚙️ Columns
          <span className="text-gray-500">({columns.length - hiddenCount}/{columns.length})</span>
        </button>
        {showColMenu && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setShowColMenu(false)}
            />
            <div className="absolute z-20 mt-1 w-56 bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-2 max-h-72 overflow-y-auto">
              {columns.map((col) => {
                const hidden = hiddenColumns.has(col.key);
                return (
                  <label
                    key={col.key}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-800 cursor-pointer text-xs text-gray-300"
                  >
                    <input
                      type="checkbox"
                      checked={!hidden}
                      onChange={() => toggleColumn(col.key)}
                      className="rounded border-gray-600 bg-gray-800 accent-blue-500"
                    />
                    <span className="flex-1">{col.label}</span>
                    {col.hint && <span className="text-[9px] text-gray-600">{col.hint}</span>}
                  </label>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ── Table ────────────────────────────────────────────── */}
      <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-gray-700 text-left">
              {visibleColumns.map((col) => (
                <th
                  key={col.key}
                  onClick={col.sortable ? () => handleSort(col.key) : undefined}
                  className={`px-3 py-2.5 text-xs font-semibold text-gray-400 whitespace-nowrap ${
                    col.align === "right" ? "text-right" : ""
                  } ${col.sortable ? "cursor-pointer hover:text-gray-200" : ""}`}
                >
                  {col.label}
                  {col.sortable && (
                    <span className="ml-1 text-gray-600">
                      {sortBy === col.key ? (sortOrder === "desc" ? "▼" : "▲") : "↕"}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const status = statusConfig[item.status] || statusConfig.tracking;
              const category = item.category
                ? categoryConfig[item.category] || categoryConfig.medium
                : null;
              const rec = recConfig[item.aiRecommendation || "HOLD"] || recConfig.HOLD;
              const returnColor =
                item.returnPercent == null
                  ? "text-gray-500"
                  : item.returnPercent >= 0
                    ? "text-emerald-400"
                    : "text-red-400";
              const expanded = expandedId === item.id;

              return (
                <FragmentRow
                  key={item.id}
                  item={item}
                  status={status}
                  category={category}
                  rec={rec}
                  returnColor={returnColor}
                  expanded={expanded}
                  visibleColumns={visibleColumns}
                  onToggleExpand={() => setExpandedId(expanded ? null : item.id)}
                />
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length} className="px-3 py-10 text-center text-sm text-gray-500">
                  No recommendations match the current filters
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ───────────────────────────────────────── */}
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

// ─── Row renderer (cell extraction) ───────────────────────────────────────

interface RowProps {
  item: PerformanceItem;
  status: { label: string; cls: string };
  category: { label: string; cls: string } | null;
  rec: { bg: string; text: string };
  returnColor: string;
  expanded: boolean;
  visibleColumns: PerformanceColumn[];
  onToggleExpand: () => void;
}

function FragmentRow({
  item,
  status,
  category,
  rec,
  returnColor,
  expanded,
  visibleColumns,
  onToggleExpand,
}: RowProps) {
  const renderCell = (key: string) => {
    switch (key) {
      case "symbol":
        return (
          <a
            href={`/company/${item.symbol}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 font-semibold whitespace-nowrap"
          >
            {item.symbol}
          </a>
        );
      case "status":
        return <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${status.cls}`}>{status.label}</span>;
      case "category":
        return category ? (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${category.cls}`}>{category.label}</span>
        ) : (
          <span className="text-gray-600">—</span>
        );
      case "entryPrice":
        return <span className="tabular-nums">₹{item.entryPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>;
      case "currentPrice":
        return item.currentPrice != null
          ? <span className="tabular-nums">₹{item.currentPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
          : <span className="text-gray-600">—</span>;
      case "targetPrice":
        return item.targetPrice != null
          ? <span className="text-emerald-400 tabular-nums">₹{item.targetPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
          : <span className="text-gray-600">—</span>;
      case "stopLoss":
        return item.stopLoss != null
          ? <span className="text-red-400 tabular-nums">₹{item.stopLoss.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
          : <span className="text-gray-600">—</span>;
      case "returnPercent":
        return item.returnPercent != null
          ? (
              <span className={`font-semibold tabular-nums ${returnColor}`}>
                {item.returnPercent >= 0 ? "+" : ""}{item.returnPercent.toFixed(2)}%
              </span>
            )
          : <span className="text-gray-600">—</span>;
      case "daysTracked":
        return <span className="tabular-nums">{item.daysTracked}d</span>;
      case "aiRecommendation":
        return (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${rec.bg} ${rec.text} whitespace-nowrap`}>
            {item.aiRecommendation || "HOLD"}
          </span>
        );
      case "confidence":
        return item.confidence != null
          ? (
              <span className={`tabular-nums ${
                item.confidence >= 70 ? "text-emerald-400" :
                item.confidence >= 50 ? "text-amber-400" : "text-red-400"
              }`}>
                {item.confidence}%
              </span>
            )
          : <span className="text-gray-600">—</span>;
      case "reasoning":
        return (
          <button
            onClick={onToggleExpand}
            className="text-blue-400 hover:text-blue-300 text-xs whitespace-nowrap"
          >
            {expanded ? "Hide" : "Show"}
          </button>
        );
      case "lastCheckedAt":
        return item.lastCheckedAt
          ? <span className="text-gray-400 text-xs whitespace-nowrap">{new Date(item.lastCheckedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
          : <span className="text-gray-600">—</span>;
      case "createdAt":
        return <span className="text-gray-400 text-xs whitespace-nowrap">{new Date(item.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>;
      default:
        return <span className="text-gray-600">—</span>;
    }
  };

  return (
    <>
      <tr className="border-b border-gray-700/50 hover:bg-gray-700/20 transition-colors align-top">
        {visibleColumns.map((col) => (
          <td
            key={col.key}
            className={`px-3 py-2.5 text-xs ${col.align === "right" ? "text-right" : "text-left"}`}
          >
            {renderCell(col.key)}
          </td>
        ))}
      </tr>
      {expanded && item.reasoning && (
        <tr className="border-b border-gray-700/50 bg-gray-800/40">
          <td colSpan={visibleColumns.length} className="px-3 py-2.5">
            <p className="text-xs text-gray-400 leading-relaxed">{item.reasoning}</p>
          </td>
        </tr>
      )}
    </>
  );
}
