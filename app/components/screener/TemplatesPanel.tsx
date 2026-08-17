"use client";

import React from "react";
import type { FilterGroup } from "@/lib/screener/condition-tree";

interface ScreenerTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  popularity?: number;
}

/** A single Chartink registry template with DB run metadata. */
interface ChartinkTemplateItem {
  id: string;
  name: string;
  url: string;
  categoryId: string;
  categoryName: string;
  fetchable: boolean;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  resultCount: number;
  stale: boolean;
}

interface ChartinkCategory {
  id: string;
  name: string;
  count: number;
  fetchableCount: number;
}

/** Stock row returned by the Chartink run endpoint. */
interface ChartinkRunStock {
  symbol: string;
  name: string;
  close: number;
  changePercent: number;
  volume: number;
}

export interface ChartinkRunResult {
  templateId: string;
  templateName: string;
  source: "chartink_db" | "chartink_live" | "tradingview";
  stocks: ChartinkRunStock[];
}

interface TemplatesPanelProps {
  onApply: (name: string, filterGroup: FilterGroup) => void;
  onChartinkResult?: (result: ChartinkRunResult) => void;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  fundamental: "Fundamental",
  technical: "Technical",
  candlestick: "Candlestick",
  range_breakout: "Range Breakout",
  crossover: "Crossover",
  bullish: "Bullish",
  bearish: "Bearish",
  intraday: "Intraday",
};

const CATEGORY_ICONS: Record<string, string> = {
  fundamental: "📊",
  technical: "📈",
  candlestick: "🕯",
  range_breakout: "📐",
  crossover: "✚",
  bullish: "🟢",
  bearish: "🔴",
  intraday: "⚡",
};

/** Map chartink category ids (from the 117 registry) to display labels. */
const CHARTINK_CATEGORY_LABELS: Record<string, string> = {
  "top-loved": "Top Loved",
  "range-breakouts": "Range Breakout",
  "intraday-bullish": "Intraday Bullish",
  "intraday-bearish": "Intraday Bearish",
};

const CHARTINK_CATEGORY_ICONS: Record<string, string> = {
  "top-loved": "❤️",
  "range-breakouts": "📐",
  "intraday-bullish": "⚡",
  "intraday-bearish": "🔻",
};

type SourceMode = "tradingview" | "chartink";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export default function TemplatesPanel({ onApply, onChartinkResult, onClose }: TemplatesPanelProps) {
  const [mode, setMode] = React.useState<SourceMode>("chartink");
  const [templates, setTemplates] = React.useState<ScreenerTemplate[]>([]);
  const [chartinkTemplates, setChartinkTemplates] = React.useState<ChartinkTemplateItem[]>([]);
  const [chartinkCategories, setChartinkCategories] = React.useState<ChartinkCategory[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [runningId, setRunningId] = React.useState<string | null>(null);
  const [runError, setRunError] = React.useState<string | null>(null);
  const [runWarning, setRunWarning] = React.useState<string | null>(null);
  const [activeCategory, setActiveCategory] = React.useState<string | "all">("all");
  const [search, setSearch] = React.useState("");

  // Load templates on mount / mode switch
  React.useEffect(() => {
    setLoading(true);
    setRunError(null);
    if (mode === "tradingview") {
      fetch("/api/screener/templates")
        .then((r) => r.ok ? r.json() : { templates: [] })
        .then((d) => setTemplates(d.templates || []))
        .catch(() => setTemplates([]))
        .finally(() => setLoading(false));
    } else {
      fetch("/api/screener/chartink")
        .then((r) => r.ok ? r.json() : { templates: [], categories: [] })
        .then((d) => {
          setChartinkTemplates(d.templates || []);
          setChartinkCategories(d.categories || []);
        })
        .catch(() => { setChartinkTemplates([]); setChartinkCategories([]); })
        .finally(() => setLoading(false));
    }
  }, [mode]);

  const handleApply = async (tpl: ScreenerTemplate) => {
    try {
      const res = await fetch(`/api/screener/templates/${tpl.id}`);
      if (res.ok) {
        const data = await res.json();
        onApply(tpl.name, data.filterGroup);
        onClose();
      }
    } catch { /* */ }
  };

  const handleChartinkApply = async (tpl: ChartinkTemplateItem) => {
    setRunningId(tpl.id);
    setRunError(null);
    setRunWarning(null);
    try {
      const res = await fetch("/api/screener/chartink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: tpl.id, limit: 100 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRunError(data.error || "Run failed");
        return;
      }
      if (data.warning) {
        setRunWarning(data.warning);
      }
      onChartinkResult?.({
        templateId: tpl.id,
        templateName: tpl.name,
        source: data.source,
        stocks: data.stocks || [],
      });
    } catch {
      setRunError("Network error while running template");
    } finally {
      setRunningId(null);
    }
  };

  // ── TradingView mode filters (untouched legacy behavior) ──
  const tvCategories = Array.from(new Set(templates.map((t) => t.category)));
  const filteredTv = templates.filter((t) => {
    if (activeCategory !== "all" && t.category !== activeCategory) return false;
    if (search) {
      const q = search.toLowerCase();
      return t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
    }
    return true;
  });

  // ── Chartink mode filters ──
  const chartinkActive = activeCategory === "all" ? null : activeCategory;
  const filteredChartink = chartinkTemplates.filter((t) => {
    if (chartinkActive && t.categoryId !== chartinkActive) return false;
    if (search) {
      const q = search.toLowerCase();
      return t.name.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">Screener Templates</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {mode === "chartink"
              ? "Chartink scan clauses (primary) — captured results, live fetch, or TV fallback"
              : "Pre-built scans inspired by popular trading patterns (TradingView fallback)"}
          </p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Source toggle */}
      <div className="grid grid-cols-2 gap-1 p-1 bg-muted/60 rounded-lg">
        <button
          onClick={() => setMode("chartink")}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
            mode === "chartink"
              ? "bg-blue-600 text-white shadow"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Chartink · 117
        </button>
        <button
          onClick={() => setMode("tradingview")}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
            mode === "tradingview"
              ? "bg-blue-600 text-white shadow"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          TradingView · 98
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search templates..."
        className="w-full p-2 text-sm border border-border rounded-lg bg-background"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* Category pills — TV uses template.category, Chartink uses categoryId */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setActiveCategory("all")}
          className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
            activeCategory === "all"
              ? "bg-blue-600 text-white"
              : "bg-muted hover:bg-muted/80 text-muted-foreground"
          }`}
        >
          All
        </button>
        {(mode === "tradingview" ? tvCategories : chartinkCategories.map((c) => c.id)).map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(activeCategory === cat ? "all" : cat)}
            className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
              activeCategory === cat
                ? "bg-blue-600 text-white"
                : "bg-muted hover:bg-muted/80 text-muted-foreground"
            }`}
          >
            {mode === "tradingview"
              ? `${CATEGORY_ICONS[cat] || "📋"} ${CATEGORY_LABELS[cat] || cat}`
              : `${CHARTINK_CATEGORY_ICONS[cat] || CATEGORY_ICONS[cat] || "📋"} ${
                  CHARTINK_CATEGORY_LABELS[cat] || CATEGORY_LABELS[cat] || cat
                }`}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="py-8 text-center">
          <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent mb-2" />
          <p className="text-xs text-muted-foreground">Loading templates...</p>
        </div>
      )}

      {/* Run error */}
      {runError && (
        <div className="px-3 py-2 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-400">
          {runError}
        </div>
      )}

      {/* Run warning */}
      {runWarning && !runError && (
        <div className="px-3 py-2 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-700 dark:text-amber-400">
          {runWarning}
        </div>
      )}

      {/* Templates grid */}
      {!loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-96 overflow-y-auto pr-1">
          {mode === "tradingview" ? (
            filteredTv.length === 0 ? (
              <div className="col-span-full py-6 text-center text-xs text-muted-foreground">
                No templates found
              </div>
            ) : (
              filteredTv.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => handleApply(tpl)}
                  className="text-left p-3 border border-border rounded-lg hover:bg-muted/50 hover:border-blue-300 dark:hover:border-blue-700 transition-all group"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-base mt-0.5">{CATEGORY_ICONS[tpl.category] || "📋"}</span>
                    <div className="min-w-0">
                      <div className="font-semibold text-sm group-hover:text-blue-600 transition-colors truncate">
                        {tpl.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                        {tpl.description}
                      </div>
                      {tpl.popularity && (
                        <div className="text-[10px] text-amber-500 mt-1">
                          {"★".repeat(tpl.popularity)}{"☆".repeat(5 - tpl.popularity)}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )
          ) : filteredChartink.length === 0 ? (
            <div className="col-span-full py-6 text-center text-xs text-muted-foreground">
              No Chartink templates found
            </div>
          ) : (
            filteredChartink.map((tpl) => (
              <button
                key={tpl.id}
                onClick={() => handleChartinkApply(tpl)}
                disabled={runningId === tpl.id}
                className="text-left p-3 border border-border rounded-lg hover:bg-muted/50 hover:border-blue-300 dark:hover:border-blue-700 transition-all group disabled:opacity-60"
              >
                <div className="flex items-start gap-2">
                  <span className="text-base mt-0.5">
                    {runningId === tpl.id ? (
                      <span className="inline-block animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent align-middle" />
                    ) : (
                      CHARTINK_CATEGORY_ICONS[tpl.categoryId] || CATEGORY_ICONS[tpl.categoryId] || "📋"
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm group-hover:text-blue-600 transition-colors truncate">
                      {tpl.name}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {tpl.fetchable ? (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400">
                          clause ready
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400">
                          catalog only
                        </span>
                      )}
                      {tpl.resultCount > 0 && (
                        <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                          tpl.stale
                            ? "bg-gray-100 dark:bg-gray-800 text-gray-500"
                            : "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400"
                        }`}>
                          {tpl.resultCount} captured{tpl.stale ? " · stale" : ""}
                        </span>
                      )}
                      {!tpl.enabled && (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-gray-100 dark:bg-gray-800 text-gray-500">
                          disabled
                        </span>
                      )}
                    </div>
                    {tpl.lastRunAt && (
                      <div className="text-[10px] text-muted-foreground mt-1">
                        Last run: {formatDateTime(tpl.lastRunAt)}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}