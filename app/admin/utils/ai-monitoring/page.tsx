"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import logger from "@/lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────

interface AiCallEntry {
  timestamp: string;
  action: string;
  model: string;
  status: "success" | "error" | "timeout";
  tokensUsed: number;
  responseTimeMs: number;
  error?: string;
  analysisType?: string;
  userId?: number;
  prompt?: string;
  result?: string;
  userLabel?: string;
}

interface AiStats {
  totalCalls: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  avgTokens: number;
  avgResponseTimeMs: number;
  totalTokens: number;
  callsByModel: Record<string, number>;
  errorsByModel: Record<string, number>;
  callsByAction: Record<string, number>;
  recentErrors: AiCallEntry[];
  timeframeMinutes: number;
}

// ─── Stat Card ─────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: "green" | "red" | "blue" | "amber";
}) {
  const colors: Record<string, string> = {
    green: "text-green-600 dark:text-green-400",
    red: "text-red-600 dark:text-red-400",
    blue: "text-blue-600 dark:text-blue-400",
    amber: "text-amber-600 dark:text-amber-400",
  };
  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
      <div className="text-sm text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color ? colors[color] : "text-gray-900 dark:text-white"}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

// ─── Breakdonw Bar ─────────────────────────────────────────────────────────

function BreakdownBar({ data, label }: { data: Record<string, number>; label: string }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (entries.length === 0) return <div className="text-sm text-gray-400">No data</div>;

  return (
    <div className="space-y-2">
      {entries.slice(0, 10).map(([key, count]) => {
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <div key={key}>
            <div className="flex justify-between text-xs mb-0.5">
              <span className="text-gray-600 dark:text-gray-400 truncate max-w-[200px]">{key}</span>
              <span className="text-gray-500 dark:text-gray-500">{count} ({pct}%)</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-1.5">
              <div
                className="bg-blue-500 h-1.5 rounded-full transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Call Row ──────────────────────────────────────────────────────────────

function CallRow({ call }: { call: AiCallEntry }) {
  const [expanded, setExpanded] = useState(false);
  const time = new Date(call.timestamp).toLocaleString();
  const statusColor =
    call.status === "success"
      ? "text-green-600 dark:text-green-400"
      : call.status === "error"
      ? "text-red-600 dark:text-red-400"
      : "text-amber-600 dark:text-amber-400";

  return (
    <div className="border-b border-gray-100 dark:border-slate-800 last:border-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-800/50 flex items-start gap-3"
      >
        <span className={`text-xs font-mono whitespace-nowrap mt-0.5 ${statusColor}`}>
          {call.status.toUpperCase()}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {call.action}
            </span>
            {call.analysisType && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400">
                {call.analysisType}
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 space-x-2">
            <span>{time}</span>
            <span>·</span>
            <span>{call.model}</span>
            {call.userLabel && (
              <>
                <span>·</span>
                <span>{call.userLabel}</span>
              </>
            )}
            {call.userId && (
              <>
                <span>·</span>
                <span>UID:{call.userId}</span>
              </>
            )}
          </div>
        </div>
        <div className="text-right text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
          <div>{call.responseTimeMs}ms</div>
          {call.tokensUsed > 0 && <div>{call.tokensUsed} tokens</div>}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {call.error && (
            <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded">
              Error: {call.error}
            </div>
          )}
          {call.prompt && (
            <div>
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Prompt:</div>
              <pre className="text-xs bg-gray-50 dark:bg-slate-800 p-2 rounded overflow-x-auto max-h-24 whitespace-pre-wrap">
                {call.prompt}
              </pre>
            </div>
          )}
          {call.result && (
            <div>
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Result:</div>
              <pre className="text-xs bg-gray-50 dark:bg-slate-800 p-2 rounded overflow-x-auto max-h-40 whitespace-pre-wrap">
                {call.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function AiMonitoringPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [stats, setStats] = useState<AiStats | null>(null);
  const [calls, setCalls] = useState<AiCallEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState(60);
  const [viewTab, setViewTab] = useState<"stats" | "calls">("stats");
  const [actionFilter, setActionFilter] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, callsRes] = await Promise.all([
        fetch(`/api/admin/ai/monitoring?type=stats&timeframe=${timeframe}`),
        fetch(`/api/admin/ai/monitoring?type=calls&limit=100`),
      ]);

      if (!statsRes.ok || !callsRes.ok) {
        const e = !statsRes.ok ? await statsRes.text() : await callsRes.text();
        throw new Error(e || "Failed to fetch monitoring data");
      }

      const statsData = await statsRes.json();
      const callsData = await callsRes.json();

      setStats(statsData.stats);
      setCalls(callsData.calls || []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [timeframe]);

  useEffect(() => {
    if (status === "authenticated") fetchData();
  }, [status, fetchData]);

  // Auto-refresh every 30s
  useEffect(() => {
    if (status !== "authenticated") return;
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [status, fetchData]);

  const handleClear = async () => {
    if (!confirm("Clear the in-memory AI call buffer?")) return;
    try {
      const res = await fetch("/api/admin/ai/monitoring", { method: "DELETE" });
      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error("Failed to clear:", err);
    }
  };

  // Auth check
  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    router.push("/auth/signin");
    return null;
  }

  const isAdmin = (session?.user as any)?.role === "admin";
  if (!isAdmin) {
    router.push("/admin/access-denied");
    return null;
  }

  // Filtered calls
  const filteredCalls = actionFilter
    ? calls.filter((c) => c.action === actionFilter)
    : calls;

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">AI Monitoring</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Observability dashboard for AI calls via OpenRouter. Tracks latency, errors, and usage per model and action.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(Number(e.target.value))}
            className="text-sm border border-gray-300 dark:border-slate-600 rounded px-2 py-1.5 bg-white dark:bg-slate-800"
          >
            <option value={15}>Last 15 min</option>
            <option value={60}>Last hour</option>
            <option value={360}>Last 6 hours</option>
            <option value={1440}>Last 24 hours</option>
          </select>
          <button
            onClick={fetchData}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button
            onClick={handleClear}
            className="px-3 py-1.5 text-sm border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            Clear Buffer
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Stats cards */}
      {stats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <StatCard label="Total Calls" value={stats.totalCalls} color="blue" sub={`Last ${timeframe}m`} />
            <StatCard label="Success Rate" value={`${stats.successRate}%`} color={stats.successRate >= 80 ? "green" : "amber"} sub={`${stats.successCount} success, ${stats.errorCount} error`} />
            <StatCard label="Avg Latency" value={`${stats.avgResponseTimeMs}ms`} color={stats.avgResponseTimeMs < 3000 ? "green" : stats.avgResponseTimeMs < 10000 ? "amber" : "red"} />
            <StatCard label="Total Tokens" value={stats.totalTokens.toLocaleString()} color="blue" sub={`Avg ${stats.avgTokens}/call`} />
            <StatCard label="Calls by Model" value={Object.keys(stats.callsByModel).length} color="blue" sub="Unique models used" />
            <StatCard label="Recent Errors" value={stats.recentErrors.length} color={stats.recentErrors.length > 0 ? "red" : "green"} sub="Last hour" />
          </div>

          {/* Tabs */}
          <div className="border-b border-gray-200 dark:border-slate-700">
            <div className="flex gap-0 -mb-px">
              <button
                onClick={() => setViewTab("stats")}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  viewTab === "stats"
                    ? "border-blue-500 text-blue-600 dark:text-blue-400"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                }`}
              >
                Breakdown
              </button>
              <button
                onClick={() => setViewTab("calls")}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  viewTab === "calls"
                    ? "border-blue-500 text-blue-600 dark:text-blue-400"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                }`}
              >
                Recent Calls ({filteredCalls.length})
              </button>
            </div>
          </div>

          {/* Tab content */}
          {viewTab === "stats" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Calls by Model</h3>
                <BreakdownBar data={stats.callsByModel} label="Model" />
              </div>
              <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Calls by Action</h3>
                <BreakdownBar data={stats.callsByAction} label="Action" />
              </div>
              <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Errors by Model</h3>
                <BreakdownBar data={stats.errorsByModel} label="Model" />
              </div>
            </div>
          )}

          {viewTab === "calls" && (
            <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700">
              {/* Filters */}
              <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center gap-3">
                <label className="text-sm text-gray-500">Filter by action:</label>
                <select
                  value={actionFilter}
                  onChange={(e) => setActionFilter(e.target.value)}
                  className="text-sm border border-gray-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-800"
                >
                  <option value="">All actions</option>
                  {Object.keys(stats.callsByAction).map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
                <span className="text-xs text-gray-400">
                  {filteredCalls.length} of {calls.length} calls shown
                </span>
              </div>

              {filteredCalls.length === 0 ? (
                <div className="px-4 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                  No AI calls recorded yet. Use the AI features (screener, alerts, query) to generate calls.
                </div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-slate-800">
                  {filteredCalls.map((call, i) => (
                    <CallRow key={`${call.timestamp}-${i}`} call={call} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Loading state (no stats yet) */}
      {!stats && loading && (
        <div className="animate-pulse space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-gray-200 dark:bg-slate-800 h-24 rounded-lg" />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!stats && !loading && !error && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          No monitoring data available. AI features must be used to generate data.
        </div>
      )}
    </div>
  );
}
