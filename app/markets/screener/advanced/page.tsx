"use client";

import { useState, useCallback, useEffect } from "react";
import FilterBuilder from "@/app/components/screener/FilterBuilder";
import ScannedResultsTable from "@/app/components/screener/ScannedResultsTable";
import ScanConfigsManager from "@/app/components/screener/ScanConfigsManager";
import TemplatesPanel from "@/app/components/screener/TemplatesPanel";
import BacktestDialog from "@/app/components/screener/BacktestDialog";
import { createDefaultFilterGroup } from "@/lib/screener/condition-tree";
import type { FilterGroup, ScannedStock } from "@/lib/screener/condition-tree";
import { useSession } from "next-auth/react";
import { useModal } from "@/app/components/providers/ModalProvider";
import Link from "next/link";

interface ScanConfig {
  id: string;
  name: string;
  description: string | null;
  schedule: string | null;
  isPublic: boolean;
  lastRunAt: string | null;
  runCount: number;
  createdAt: string;
}

export default function AdvancedScreenerPage() {
  const [filterGroup, setFilterGroup] = useState<FilterGroup>(createDefaultFilterGroup());
  const [stocks, setStocks] = useState<ScannedStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [total, setTotal] = useState(0);
  const [executionMs, setExecutionMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Pagination & sort
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("market_cap_basic");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [totalPages, setTotalPages] = useState(1);

  // Panel visibility
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showConfigs, setShowConfigs] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showBacktest, setShowBacktest] = useState(false);
  const [backtestSymbol, setBacktestSymbol] = useState<string | null>(null);
  const [configName, setConfigName] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: session } = useSession();
  const { openLoginModal } = useModal();

  const limit = 50;

  // --- RUN SCAN ---
  const runScan = useCallback(async (offset = 0, sortField?: string, sortDir?: string) => {
    setLoading(true);
    setError(null);
    const startMs = Date.now();

    try {
      const res = await fetch("/api/screener/advanced", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filterGroup,
          limit,
          offset,
          sortBy: sortField || sortBy,
          sortOrder: sortDir || sortOrder,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Scan failed");
      }

      const data = await res.json();
      setStocks(data.stocks || []);
      setTotal(data.pagination?.total || 0);
      setTotalPages(data.pagination?.totalPages || 1);
      setExecutionMs(Date.now() - startMs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
      setStocks([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filterGroup, sortBy, sortOrder]);

  // --- SORT ---
  const handleSort = useCallback((field: string) => {
    setSortBy((prev) => {
      if (prev === field) {
        setSortOrder((o) => o === "asc" ? "desc" : "asc");
        return prev;
      }
      setSortOrder("desc");
      return field;
    });
    setTimeout(() => runScan(0, field, field === sortBy ? (sortOrder === "asc" ? "desc" : "asc") : "desc"), 0);
  }, [runScan, sortBy, sortOrder]);

  // --- PAGE ---
  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
    runScan((newPage - 1) * limit);
  }, [runScan]);

  // --- EXPORT ---
  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/screener/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stocks, filename: `screener-export-${Date.now()}.csv` }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `screener-export-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* */ }
    finally { setExporting(false); }
  };

  // --- CLEAR SCAN ---
  const handleClearScan = useCallback(() => {
    setFilterGroup(createDefaultFilterGroup());
    setStocks([]);
    setTotal(0);
    setTotalPages(1);
    setPage(1);
    setError(null);
  }, []);

  // --- SAVE CONFIG ---
  const handleSaveConfig = async () => {
    if (!configName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/screener/configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: configName, filters: filterGroup }),
      });
      if (res.ok) {
        setShowSaveDialog(false);
        setConfigName("");
      }
    } catch { /* */ }
    finally { setSaving(false); }
  };

  // --- LOAD TEMPLATE ---
  const handleApplyTemplate = (name: string, templateFilter: FilterGroup) => {
    setFilterGroup(templateFilter);
    setError(null);
    // Auto-run with the template
    setTimeout(() => {
      runScan(0);
    }, 100);
  };

  // --- LOAD SAVED CONFIG ---
  const handleLoadConfig = (config: ScanConfig) => {
    // We fetch the config's filterGroup and apply it
    fetch(`/api/screener/configs/${config.id}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.stocks) {
          setStocks(data.stocks);
          setTotal(data.pagination?.total || 0);
          setTotalPages(data.pagination?.totalPages || 1);
        }
      })
      .catch(() => {});
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Breadcrumb */}
      <nav className="mb-4 text-sm text-muted-foreground max-w-7xl mx-auto px-4 pt-6">
        <a href="/markets" className="hover:text-foreground transition-colors">Markets</a>
        <span className="mx-2">/</span>
        <a href="/markets/screener" className="hover:text-foreground transition-colors">Screener</a>
        <span className="mx-2">/</span>
        <span className="text-foreground font-medium">Advanced Screener</span>
      </nav>
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        {/* ======= HEADER ======= */}
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold">Advanced Screener</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Build multi-condition scans with AND/OR logic, technical indicators, and more.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowTemplates(true)}
              className="px-3 py-2 text-sm font-medium border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-400 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-950 transition-colors"
            >
              Templates
            </button>
            {session ? (
              <button
                onClick={() => setShowConfigs(true)}
                className="px-3 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors"
              >
                Saved Scans
              </button>
            ) : (
              <button
                onClick={openLoginModal}
                className="px-3 py-2 text-sm font-medium border border-dashed border-border rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                title="Sign in to view your saved scans"
              >
                🔒 Saved Scans
              </button>
            )}
            {session ? (
              <button
                onClick={() => setShowSaveDialog(true)}
                className="px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Save Config
              </button>
            ) : (
              <button
                onClick={openLoginModal}
                className="px-3 py-2 text-sm font-medium border border-dashed border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors"
                title="Sign in to save your scan configs"
              >
                🔒 Sign in to Save
              </button>
            )}
            <button
              onClick={() => runScan(0)}
              disabled={loading}
              className="px-6 py-2 text-sm font-bold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 shadow-lg shadow-emerald-500/20"
            >
              {loading ? "Scanning..." : "▶ Run Scan"}
            </button>
            {stocks.length > 0 && (
              <>
                <button
                  onClick={handleClearScan}
                  className="px-3 py-2 text-sm font-medium border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                >
                  ✕ Clear Scan
                </button>
                <button
                  onClick={() => {
                    // Pick the first stock to backtest, or user can change in dialog
                    const sym = stocks[0]?.symbol?.toString().replace("NSE:", "") || "";
                    setBacktestSymbol(sym);
                    setShowBacktest(true);
                  }}
                  className="px-3 py-2 text-sm font-medium border border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-400 rounded-lg hover:bg-orange-50 dark:hover:bg-orange-950 transition-colors"
                >
                  📊 Backtest
                </button>
              </>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* ======= MAIN LAYOUT ======= */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Filter Builder (sidebar) */}
          <div className="lg:col-span-2">
            <div className="bg-card border border-border rounded-lg p-4 sticky top-4">
              <h3 className="font-semibold text-sm mb-3">Filter Conditions</h3>
              <FilterBuilder
                value={filterGroup}
                onChange={setFilterGroup}
              />
            </div>
          </div>

          {/* Results (main area) */}
          <div className="lg:col-span-3">
            <ScannedResultsTable
              stocks={stocks}
              loading={loading}
              total={total}
              executionMs={executionMs}
              onSort={handleSort}
              sortBy={sortBy}
              sortOrder={sortOrder}
              page={page}
              totalPages={totalPages}
              onPageChange={handlePageChange}
              onExport={handleExport}
              exporting={exporting}
            />
          </div>
        </div>
      </div>

      {/* ======= SAVE DIALOG ======= */}
      {showSaveDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-card border border-border p-8 rounded-2xl w-[400px] shadow-2xl">
            <h3 className="text-xl font-bold mb-2">Save Scan Config</h3>
            <p className="text-sm text-muted-foreground mb-6">Save your filter conditions for later use.</p>
            <input
              type="text"
              placeholder="Config name (e.g. Oversold Bounce)"
              className="w-full p-3 border border-border rounded-xl mb-6 bg-slate-50/50 dark:bg-slate-900 focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm"
              value={configName}
              onChange={(e) => setConfigName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveConfig()}
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowSaveDialog(false)}
                className="px-6 py-2.5 font-medium text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveConfig}
                disabled={saving || !configName.trim()}
                className="px-8 py-2.5 bg-blue-600 text-white font-bold text-sm rounded-xl shadow-lg shadow-blue-500/20 hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======= TEMPLATES SIDEBAR ======= */}
      {showTemplates && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={() => setShowTemplates(false)} />
      )}
      {showTemplates && (
        <div className="fixed right-0 top-0 h-full w-[480px] max-w-[95vw] bg-card border-l border-border shadow-2xl z-50 overflow-y-auto">
          <div className="p-6">
            <TemplatesPanel
              onApply={handleApplyTemplate}
              onClose={() => setShowTemplates(false)}
            />
          </div>
        </div>
      )}

      {/* ======= BACKTEST SIDEBAR ======= */}
      {showBacktest && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={() => setShowBacktest(false)} />
      )}
      {showBacktest && backtestSymbol && (
        <div className="fixed right-0 top-0 h-full w-[520px] max-w-[95vw] bg-card border-l border-border shadow-2xl z-50 overflow-y-auto">
          <div className="p-6">
            <BacktestDialog
              symbol={backtestSymbol}
              entryFilter={filterGroup}
              onClose={() => { setShowBacktest(false); setBacktestSymbol(null); }}
            />
          </div>
        </div>
      )}

      {/* ======= CONFIGS SIDEBAR ======= */}
      {showConfigs && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={() => setShowConfigs(false)} />
      )}
      {showConfigs && (
        <div className="fixed right-0 top-0 h-full w-[480px] max-w-[95vw] bg-card border-l border-border shadow-2xl z-50 overflow-y-auto">
          <div className="p-6">
            <ScanConfigsManager
              onLoadConfig={handleLoadConfig}
              onClose={() => setShowConfigs(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
