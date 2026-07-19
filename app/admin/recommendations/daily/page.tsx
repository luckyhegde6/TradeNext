"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface RunStock {
  id: string;
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  screenerAttribution: string[];
  screenerCount: number;
  aiRecommendation: string;
  confidence: number;
  targetPrice: number | null;
  stopLoss: number | null;
  timeHorizon: string;
  reasoning: string | null;
  riskFactors: string[];
  createdAt: string;
}

interface Run {
  id: string;
  runDate: string;
  status: string;
  uniqueStocks: number;
  aiProcessed: number;
  executionTimeMs: number;
  stockCount: number;
}

interface RunDetail {
  run: Run & { error: string | null };
  stocks: RunStock[];
}

interface Stats {
  totalRuns: number;
  activeTrackers: number;
  statusBreakdown: Record<string, number>;
}

export default function AdminDailyRecommendationsPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();

  const [stats, setStats] = useState<Stats | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Run now state
  const [runningNow, setRunningNow] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);

  // Performance check state
  const [checkingPerformance, setCheckingPerformance] = useState(false);
  const [perfResult, setPerfResult] = useState<string | null>(null);

  // Expanded run detail
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Edit stock state
  const [editingStock, setEditingStock] = useState<RunStock | null>(null);
  const [editForm, setEditForm] = useState({
    aiRecommendation: "",
    confidence: 0,
    targetPrice: "",
    stopLoss: "",
    reasoning: "",
    timeHorizon: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);

  // Auth check
  useEffect(() => {
    if (authStatus === "loading") return;
    if (!session || !session.user || (session.user as any).role !== "admin") {
      router.push("/admin/access-denied");
    }
  }, [session, authStatus, router]);

  const fetchOverview = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/recommendations");
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
        setRuns(data.recentRuns || []);
      } else {
        setError(data.error || "Failed to load data");
      }
    } catch (e) {
      setError("Failed to load recommendations data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session?.user) fetchOverview();
  }, [session, fetchOverview]);

  const handleRunNow = async () => {
    setRunningNow(true);
    setRunResult(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_now" }),
      });
      const data = await res.json();
      if (data.success) {
        setRunResult(data.message || "Recommendation run started in background. Refresh in 60-90s to see results.");
        fetchOverview(); // refresh stats
      } else {
        setError(data.error || "Run failed");
      }
    } catch (e) {
      setError("Failed to trigger run");
    } finally {
      setRunningNow(false);
    }
  };

  const handleCheckPerformance = async () => {
    setCheckingPerformance(true);
    setPerfResult(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check_performance" }),
      });
      const data = await res.json();
      if (data.success) {
        setPerfResult(`Performance check: ${data.result?.checked || 0} trackers checked, ${data.result?.updated || 0} status changes`);
        fetchOverview();
      } else {
        setError(data.error || "Performance check failed");
      }
    } catch (e) {
      setError("Failed to check performance");
    } finally {
      setCheckingPerformance(false);
    }
  };

  const handleExpandRun = async (runId: string) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      setRunDetail(null);
      return;
    }

    setExpandedRunId(runId);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/admin/recommendations/runs/${runId}`);
      const data = await res.json();
      if (data.success) {
        setRunDetail(data);
      }
    } catch (e) {
      // ignore
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleDeleteRun = async (runId: string) => {
    if (!confirm("Delete this run and all its stocks?")) return;
    try {
      await fetch(`/api/admin/recommendations/runs/${runId}`, { method: "DELETE" });
      setRuns(runs.filter(r => r.id !== runId));
      if (expandedRunId === runId) {
        setExpandedRunId(null);
        setRunDetail(null);
      }
    } catch (e) {
      setError("Failed to delete run");
    }
  };

  const openEditStock = (stock: RunStock) => {
    setEditingStock(stock);
    setEditForm({
      aiRecommendation: stock.aiRecommendation,
      confidence: stock.confidence,
      targetPrice: stock.targetPrice?.toString() || "",
      stopLoss: stock.stopLoss?.toString() || "",
      reasoning: stock.reasoning || "",
      timeHorizon: stock.timeHorizon,
    });
  };

  const handleSaveStock = async () => {
    if (!editingStock || !expandedRunId) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/admin/recommendations/runs/${expandedRunId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stockId: editingStock.id,
          updates: {
            aiRecommendation: editForm.aiRecommendation,
            confidence: editForm.confidence,
            targetPrice: editForm.targetPrice ? parseFloat(editForm.targetPrice) : null,
            stopLoss: editForm.stopLoss ? parseFloat(editForm.stopLoss) : null,
            reasoning: editForm.reasoning || null,
            timeHorizon: editForm.timeHorizon,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        // Update the stock in local state
        if (runDetail?.stocks) {
          setRunDetail({
            ...runDetail,
            stocks: runDetail.stocks.map(s =>
              s.id === editingStock.id
                ? { ...s, ...data.stock }
                : s
            ),
          });
        }
        setEditingStock(null);
      } else {
        setError(data.error || "Failed to update stock");
      }
    } catch (e) {
      setError("Failed to update stock");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteStock = async (stockId: string) => {
    if (!expandedRunId || !confirm("Delete this stock from the run?")) return;
    try {
      const res = await fetch(`/api/admin/recommendations/runs/${expandedRunId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stockId }),
      });
      if (res.ok && runDetail?.stocks) {
        setRunDetail({
          ...runDetail,
          stocks: runDetail.stocks.filter(s => s.id !== stockId),
        });
      }
    } catch (e) {
      setError("Failed to delete stock");
    }
  };

  if (authStatus === "loading" || !session?.user || (session.user as any).role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-gray-500">Checking permissions...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-gray-800 pb-6 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white">Daily Recommendations Engine</h1>
            <p className="text-gray-400 mt-1 text-sm">
              Monitor runs, manage stocks, and trigger daily screener jobs
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleCheckPerformance}
              disabled={checkingPerformance}
              className="px-4 py-2 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/30 rounded-lg text-sm font-medium text-amber-300 transition-colors disabled:opacity-50"
            >
              {checkingPerformance ? "Checking..." : "Check Performance"}
            </button>
            <button
              onClick={handleRunNow}
              disabled={runningNow}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
            >
              {runningNow ? "Running..." : "Run Now"}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-300">
            {error}
            <button onClick={() => setError(null)} className="ml-3 underline">Dismiss</button>
          </div>
        )}

        {/* Success messages */}
        {runResult && (
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-sm text-emerald-300">
            ✓ {runResult}
          </div>
        )}
        {perfResult && (
          <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg text-sm text-blue-300">
            ✓ {perfResult}
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4">
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Total Runs</div>
              <div className="text-2xl font-bold text-white">{stats.totalRuns}</div>
            </div>
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4">
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Active Trackers</div>
              <div className="text-2xl font-bold text-emerald-400">{stats.activeTrackers}</div>
            </div>
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4">
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Target Achieved</div>
              <div className="text-2xl font-bold text-blue-400">{stats.statusBreakdown["target_achieved"] || 0}</div>
            </div>
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4">
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Stop Loss Hit</div>
              <div className="text-2xl font-bold text-red-400">{stats.statusBreakdown["stop_loss_hit"] || 0}</div>
            </div>
          </div>
        )}

        {/* Runs History */}
        <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-700/50 bg-gray-800/50">
            <h2 className="text-lg font-semibold text-white">Run History</h2>
          </div>

          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 bg-gray-700/50 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : runs.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              <p className="text-lg mb-2">No runs yet</p>
              <p className="text-sm">Click "Run Now" to trigger the first recommendation run</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-700/50">
              {runs.map(run => (
                <div key={run.id}>
                  <div
                    className="px-6 py-4 hover:bg-gray-700/20 transition-colors cursor-pointer"
                    onClick={() => handleExpandRun(run.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          run.status === "completed" ? "bg-emerald-500/20 text-emerald-300" :
                          run.status === "failed" ? "bg-red-500/20 text-red-300" :
                          run.status === "running" ? "bg-blue-500/20 text-blue-300" :
                          "bg-amber-500/20 text-amber-300"
                        }`}>
                          {run.status}
                        </span>
                        <span className="text-sm text-gray-300">
                          {new Date(run.runDate).toLocaleString("en-IN", {
                            day: "numeric", month: "short", year: "numeric",
                            hour: "2-digit", minute: "2-digit"
                          })}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-400">
                        <span>{run.uniqueStocks} stocks</span>
                        <span>{run.aiProcessed} AI-analyzed</span>
                        <span>{run.executionTimeMs ? `${(run.executionTimeMs / 1000).toFixed(1)}s` : "—"}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteRun(run.id); }}
                          className="text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10"
                        >
                          Delete
                        </button>
                        <span className="text-gray-600">{expandedRunId === run.id ? "▲" : "▼"}</span>
                      </div>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {expandedRunId === run.id && (
                    <div className="px-6 pb-4 bg-gray-900/50">
                      {loadingDetail ? (
                        <div className="py-4 text-center text-gray-500 animate-pulse">Loading stocks...</div>
                      ) : runDetail?.stocks ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-xs text-gray-400 uppercase tracking-wider border-b border-gray-700/50">
                                <th className="text-left py-2 px-3">Symbol</th>
                                <th className="text-right py-2 px-3">Price</th>
                                <th className="text-right py-2 px-3">Change</th>
                                <th className="text-center py-2 px-3">AI Rec</th>
                                <th className="text-right py-2 px-3">Confidence</th>
                                <th className="text-right py-2 px-3">Target</th>
                                <th className="text-right py-2 px-3">Stop Loss</th>
                                <th className="text-center py-2 px-3">Horizon</th>
                                <th className="text-center py-2 px-3">Screeners</th>
                                <th className="text-center py-2 px-3">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700/30">
                              {runDetail.stocks.map(stock => (
                                <tr key={stock.id} className="hover:bg-gray-800/30">
                                  <td className="py-2 px-3">
                                    <a href={`/company/${stock.symbol}`} className="text-blue-400 hover:underline font-medium" target="_blank">
                                      {stock.symbol}
                                    </a>
                                  </td>
                                  <td className="py-2 px-3 text-right text-white">
                                    {stock.price ? `₹${stock.price.toFixed(2)}` : "—"}
                                  </td>
                                  <td className={`py-2 px-3 text-right ${stock.changePercent && stock.changePercent > 0 ? "text-emerald-400" : stock.changePercent && stock.changePercent < 0 ? "text-red-400" : "text-gray-400"}`}>
                                    {stock.changePercent ? `${stock.changePercent > 0 ? "+" : ""}${stock.changePercent.toFixed(2)}%` : "—"}
                                  </td>
                                  <td className="py-2 px-3 text-center">
                                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                      stock.aiRecommendation === "BUY" ? "bg-emerald-500/20 text-emerald-300" :
                                      stock.aiRecommendation === "SELL" ? "bg-red-500/20 text-red-300" :
                                      "bg-amber-500/20 text-amber-300"
                                    }`}>
                                      {stock.aiRecommendation}
                                    </span>
                                  </td>
                                  <td className="py-2 px-3 text-right text-gray-300">
                                    {stock.confidence}%
                                  </td>
                                  <td className="py-2 px-3 text-right text-blue-400">
                                    {stock.targetPrice ? `₹${stock.targetPrice.toFixed(2)}` : "—"}
                                  </td>
                                  <td className="py-2 px-3 text-right text-red-400">
                                    {stock.stopLoss ? `₹${stock.stopLoss.toFixed(2)}` : "—"}
                                  </td>
                                  <td className="py-2 px-3 text-center text-gray-400 text-xs">
                                    {stock.timeHorizon}
                                  </td>
                                  <td className="py-2 px-3 text-center">
                                    <span className="text-xs text-gray-400">{stock.screenerCount} screeners</span>
                                  </td>
                                  <td className="py-2 px-3 text-center">
                                    <div className="flex items-center justify-center gap-1">
                                      <button
                                        onClick={(e) => { e.stopPropagation(); openEditStock(stock); }}
                                        className="px-2 py-1 text-xs font-medium text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteStock(stock.id); }}
                                        className="px-2 py-1 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          {/* Run error if any */}
                          {runDetail.run.error && (
                            <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-300">
                              Error: {runDetail.run.error}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="py-4 text-center text-gray-500 text-sm">No stock data available</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Info box */}
        <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-6">
          <h3 className="text-sm font-medium text-gray-300 mb-3">About the Daily Recommendations Engine</h3>
          <div className="text-xs text-gray-500 space-y-2">
            <p>• <strong className="text-gray-400">Daily Runs:</strong> Automatically runs at 10:00 AM IST (04:30 UTC) via cron job</p>
            <p>• <strong className="text-gray-400">Performance Tracking:</strong> Checks at 3:30 PM IST (10:00 UTC) to update status (active → target_achieved / stop_loss_hit)</p>
            <p>• <strong className="text-gray-400">Data Pipeline:</strong> 7 Chartink screeners → deduplication → AI analysis via OpenRouter → DB storage → Telegram broadcast</p>
            <p>• <strong className="text-gray-400">Run Now:</strong> Triggers an immediate run (takes 30-60 seconds depending on screener response)</p>
            <p>• <strong className="text-gray-400">Check Performance:</strong> Scans all active trackers against current prices to update status</p>
            <p>• <strong className="text-gray-400">Edit Stocks:</strong> Click "Edit" on any stock row to override AI recommendation, target, stop loss, or reasoning</p>
          </div>
        </div>

        {/* Edit Stock Modal */}
        {editingStock && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setEditingStock(null)} />
            <div className="relative bg-gray-800 border border-gray-700 rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">
                  Edit {editingStock.symbol}
                </h3>
                <button onClick={() => setEditingStock(null)} className="text-gray-400 hover:text-white">✕</button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 uppercase mb-1">AI Recommendation</label>
                  <select
                    value={editForm.aiRecommendation}
                    onChange={(e) => setEditForm({ ...editForm, aiRecommendation: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                  >
                    <option value="BUY">BUY</option>
                    <option value="HOLD">HOLD</option>
                    <option value="SELL">SELL</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 uppercase mb-1">Confidence (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={editForm.confidence}
                    onChange={(e) => setEditForm({ ...editForm, confidence: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 uppercase mb-1">Target Price (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.targetPrice}
                    onChange={(e) => setEditForm({ ...editForm, targetPrice: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 uppercase mb-1">Stop Loss (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.stopLoss}
                    onChange={(e) => setEditForm({ ...editForm, stopLoss: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 uppercase mb-1">Time Horizon</label>
                <select
                  value={editForm.timeHorizon}
                  onChange={(e) => setEditForm({ ...editForm, timeHorizon: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                >
                  <option value="short">Short Term</option>
                  <option value="medium">Medium Term</option>
                  <option value="long">Long Term</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-400 uppercase mb-1">Reasoning</label>
                <textarea
                  value={editForm.reasoning}
                  onChange={(e) => setEditForm({ ...editForm, reasoning: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm resize-none"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setEditingStock(null)}
                  className="flex-1 px-4 py-2 bg-gray-700 text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveStock}
                  disabled={savingEdit}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {savingEdit ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
