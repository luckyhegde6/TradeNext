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

interface TemplatesPanelProps {
  onApply: (name: string, filterGroup: FilterGroup) => void;
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

export default function TemplatesPanel({ onApply, onClose }: TemplatesPanelProps) {
  const [templates, setTemplates] = React.useState<ScreenerTemplate[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [activeCategory, setActiveCategory] = React.useState<string | "all">("all");
  const [search, setSearch] = React.useState("");

  // Load templates on mount
  React.useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/screener/templates");
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
      }
    } catch { /* */ }
    finally { setLoading(false); }
  };

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

  const categories = Array.from(new Set(templates.map((t) => t.category)));
  const filtered = templates.filter((t) => {
    if (activeCategory !== "all" && t.category !== activeCategory) return false;
    if (search) {
      const q = search.toLowerCase();
      return t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
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
            Pre-built scans inspired by popular trading patterns
          </p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
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

      {/* Category pills */}
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
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
              activeCategory === cat
                ? "bg-blue-600 text-white"
                : "bg-muted hover:bg-muted/80 text-muted-foreground"
            }`}
          >
            {CATEGORY_ICONS[cat] || "📋"} {CATEGORY_LABELS[cat] || cat}
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

      {/* Templates grid */}
      {!loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-96 overflow-y-auto pr-1">
          {filtered.length === 0 ? (
            <div className="col-span-full py-6 text-center text-xs text-muted-foreground">
              No templates found
            </div>
          ) : (
            filtered.map((tpl) => (
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
          )}
        </div>
      )}
    </div>
  );
}
