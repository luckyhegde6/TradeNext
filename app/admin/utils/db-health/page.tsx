"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  ServerIcon,
  CircleStackIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  BoltIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

interface DbErrorEntry {
  at: string;
  model: string;
  operation: string;
  message: string;
}

interface DbHealthData {
  timestamp: string;
  prisma: {
    healthy: boolean;
    latencyMs: number;
    error: string | null;
    lastProbeAt: string | null;
    tableCounts: Record<string, number>;
    ops: {
      reads: number;
      writes: number;
      totalOperations: number;
      planLimit: number;
      planOperationsRemaining: number;
      writeBudget: number;
      writeBudgetExceeded: boolean;
      writeBudgetRemaining: number;
      dayKey: string;
    };
  };
  sqlite: {
    ready: boolean;
    syncing: boolean;
    lastSyncAt: string | null;
    tables: Record<string, number>;
    recentSyncs: Array<{
      at: string;
      rowsSynced: number;
      durationMs: number;
      error?: string;
    }>;
  };
  dailyPriceCache: {
    cachedSymbols: number;
    flushCount: number;
    lastFlushAt: string | null;
    lastFlushRows: number;
    totalRowsWritten: number;
    lastError: string | null;
    isAccumulationWindow: boolean;
    isPostMarket: boolean;
  };
  dbErrors: DbErrorEntry[];
  dbErrorSummary: {
    day: string;
    counts: {
      plan_limit: number;
      timeout: number;
      accelerate_proxy: number;
      connection: number;
      write_budget: number;
      other: number;
    };
  };
}

type DbErrorKey = keyof DbHealthData["dbErrorSummary"]["counts"];

const DB_ERROR_META: Record<DbErrorKey, { label: string; chip: string }> = {
  plan_limit: { label: "Plan Limit Hold", chip: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
  timeout: { label: "Timeout", chip: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" },
  accelerate_proxy: { label: "Accelerate Proxy", chip: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" },
  connection: { label: "Connection", chip: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
  write_budget: { label: "Write Budget", chip: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" },
  other: { label: "Other", chip: "bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300" },
};

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold ${
        ok
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
          : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
      }`}
    >
      {ok ? (
        <CheckCircleIcon className="w-4 h-4" />
      ) : (
        <XCircleIcon className="w-4 h-4" />
      )}
      {label}
    </span>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5">
      <div className="flex items-center gap-3">
        <div className={`p-2.5 rounded-lg ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-sm text-gray-500 dark:text-slate-400">{label}</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{value}</p>
          {sub && <p className="text-xs text-gray-400 dark:text-slate-500">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

export default function DbHealthPage() {
  const { status } = useSession();
  const [data, setData] = useState<DbHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [flushingPrices, setFlushingPrices] = useState(false);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/db-health");
      if (res.ok) {
        setData(await res.json());
      }
    } catch (e) {
      console.error("Failed to fetch DB health:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      fetchHealth();
      const interval = setInterval(fetchHealth, 30_000);
      return () => clearInterval(interval);
    }
  }, [status, fetchHealth]);

  const triggerSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/admin/db-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_sqlite" }),
      });
      const body = await res.json();
      if (res.ok) {
        setSyncMsg(`SQLite sync completed`);
        await fetchHealth();
      } else {
        setSyncMsg(`Sync failed: ${body.error}`);
      }
    } catch (e) {
      setSyncMsg(`Sync error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
    }
  };

  const triggerFlushPrices = async () => {
    setFlushingPrices(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/admin/db-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "flush_prices" }),
      });
      const body = await res.json();
      if (res.ok) {
        setSyncMsg(body.message ?? `Flushed ${body.rows} rows`);
        await fetchHealth();
      } else {
        setSyncMsg(`Flush failed: ${body.error}`);
      }
    } catch (e) {
      setSyncMsg(`Flush error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFlushingPrices(false);
    }
  };

  if (status === "loading" || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-slate-400">
        Failed to load DB health data.
      </div>
    );
  }

  const { prisma, sqlite, dailyPriceCache, dbErrors, dbErrorSummary } = data;
  const errorTotal = Object.values(dbErrorSummary.counts).reduce((a, b) => a + b, 0);
  const budgetPercent = prisma.ops.writeBudget > 0
    ? Math.round((prisma.ops.writes / prisma.ops.writeBudget) * 100)
    : 0;
  const planOpsPercent = prisma.ops.planLimit > 0
    ? Math.round((prisma.ops.totalOperations / prisma.ops.planLimit) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Database Health
          </h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            Prisma + SQLite backup status, ops monitoring, price cache, error log
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchHealth}
            className="px-4 py-2 bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 transition text-sm font-medium"
          >
            Refresh
          </button>
          <button
            onClick={triggerSync}
            disabled={syncing || !sqlite.ready}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <ArrowPathIcon className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Sync SQLite"}
          </button>
          <button
            onClick={triggerFlushPrices}
            disabled={flushingPrices}
            className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <BoltIcon className={`w-4 h-4 ${flushingPrices ? "animate-spin" : ""}`} />
            {flushingPrices ? "Flushing..." : "Flush Prices"}
          </button>
        </div>
      </div>

      {syncMsg && (
        <div className="px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-700 dark:text-blue-300">
          {syncMsg}
        </div>
      )}

      {/* Status badges */}
      <div className="flex flex-wrap gap-3">
        <StatusBadge ok={prisma.healthy} label={prisma.healthy ? "Prisma Online" : "Prisma Offline"} />
        <StatusBadge ok={sqlite.ready} label={sqlite.ready ? "SQLite Ready" : "SQLite Not Ready"} />
        <StatusBadge ok={!sqlite.syncing} label={sqlite.syncing ? "Syncing..." : "Idle"} />
        {prisma.ops.writeBudgetExceeded && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
            <ExclamationTriangleIcon className="w-4 h-4" />
            Write Budget Exceeded
          </span>
        )}
        {planOpsPercent > 80 && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
            <ExclamationTriangleIcon className="w-4 h-4" />
            Plan Ops {planOpsPercent}% Used
          </span>
        )}
        <StatusBadge
          ok={!dailyPriceCache.lastError}
          label={dailyPriceCache.lastError ? "Price Cache Error" : "Price Cache OK"}
        />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
        <StatCard
          label="Prisma Latency"
          value={prisma.healthy ? `${prisma.latencyMs}ms` : "N/A"}
          sub={prisma.error ? prisma.error.slice(0, 60) : "Healthy"}
          icon={ServerIcon}
          color={prisma.healthy ? "bg-emerald-500" : "bg-red-500"}
        />
        <StatCard
          label="DB Reads Today"
          value={prisma.ops.reads.toLocaleString()}
          sub={`${prisma.ops.writeBudget} budget`}
          icon={CircleStackIcon}
          color="bg-blue-500"
        />
        <StatCard
          label="DB Writes Today"
          value={prisma.ops.writes.toLocaleString()}
          sub={`${budgetPercent}% of budget used`}
          icon={CircleStackIcon}
          color={prisma.ops.writeBudgetExceeded ? "bg-red-500" : "bg-blue-500"}
        />
        <StatCard
          label="Total Ops Today"
          value={prisma.ops.totalOperations.toLocaleString()}
          sub={`${prisma.ops.planLimit.toLocaleString()} plan limit · ${planOpsPercent}%`}
          icon={CircleStackIcon}
          color={planOpsPercent > 90 ? "bg-red-500" : planOpsPercent > 70 ? "bg-amber-500" : "bg-indigo-500"}
        />
        <StatCard
          label="Cached Prices"
          value={dailyPriceCache.cachedSymbols}
          sub={dailyPriceCache.isAccumulationWindow ? "Market hours (accumulating)" : dailyPriceCache.isPostMarket ? "Post-market (ready to flush)" : "Outside hours"}
          icon={BoltIcon}
          color="bg-amber-500"
        />
        <StatCard
          label="SQLite Last Sync"
          value={formatTimeAgo(sqlite.lastSyncAt)}
          sub={`${Object.values(sqlite.tables).reduce((a, b) => a + b, 0)} total rows`}
          icon={ClockIcon}
          color="bg-purple-500"
        />
      </div>

      {/* Write budget bar */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-3">
          Write Budget Usage (IST Day — {prisma.ops.dayKey})
        </h3>
        <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-4 overflow-hidden">
          <div
            className={`h-4 rounded-full transition-all duration-500 ${
              budgetPercent > 90
                ? "bg-red-500"
                : budgetPercent > 70
                  ? "bg-amber-500"
                  : "bg-emerald-500"
            }`}
            style={{ width: `${Math.min(budgetPercent, 100)}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-500 dark:text-slate-400">
          <span>
            {prisma.ops.writes.toLocaleString()} / {prisma.ops.writeBudget.toLocaleString()} writes
          </span>
          <span>{prisma.ops.writeBudgetRemaining.toLocaleString()} remaining</span>
        </div>
      </div>

      {/* Plan ops bar — reads + writes vs Prisma plan limit */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-3">
          Plan Operations Usage (Reads + Writes — {prisma.ops.dayKey})
        </h3>
        <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-4 overflow-hidden">
          <div
            className={`h-4 rounded-full transition-all duration-500 ${
              planOpsPercent > 90
                ? "bg-red-500"
                : planOpsPercent > 70
                  ? "bg-amber-500"
                  : "bg-emerald-500"
            }`}
            style={{ width: `${Math.min(planOpsPercent, 100)}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-500 dark:text-slate-400">
          <span>
            {prisma.ops.totalOperations.toLocaleString()} / {prisma.ops.planLimit.toLocaleString()} ops
            <span className="ml-2 text-gray-400">({prisma.ops.reads.toLocaleString()} reads · {prisma.ops.writes.toLocaleString()} writes)</span>
          </span>
          <span>{prisma.ops.planOperationsRemaining.toLocaleString()} remaining</span>
        </div>
        <p className="mt-2 text-xs text-gray-400 dark:text-slate-500 italic">
          Prisma dashboard is authoritative. This counter is restored from a persisted SQLite snapshot on boot (60s interval) — resets on every deploy.
        </p>
      </div>

      {/* Daily Price Cache */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-4">
          Daily Price Cache (Batch Writer)
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-gray-500 dark:text-slate-400">Flushes</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{dailyPriceCache.flushCount}</p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-slate-400">Last Flush</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{formatTimeAgo(dailyPriceCache.lastFlushAt)}</p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-slate-400">Rows Written (Total)</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{dailyPriceCache.totalRowsWritten.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-slate-400">Last Flush Rows</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{dailyPriceCache.lastFlushRows}</p>
          </div>
        </div>
        {dailyPriceCache.lastError && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">
            Last error: {dailyPriceCache.lastError}
          </p>
        )}
      </div>

      {/* Recent DB Errors */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">
            Recent DB Errors ({dbErrors.length})
          </h3>
          {dbErrors.length > 0 && (
            <button
              onClick={() => setData({ ...data, dbErrors: [] })}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 flex items-center gap-1"
            >
              <TrashIcon className="w-3 h-3" /> Clear
            </button>
          )}
        </div>

        {/* Per-type day summary (v3.21.1) */}
        <div className="mb-4">
          <p className="text-xs text-gray-500 dark:text-slate-400 mb-2">
            Errors today ({dbErrorSummary.day}) — {errorTotal.toLocaleString()} total
          </p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(DB_ERROR_META) as DbErrorKey[]).map((key) => {
              const count = dbErrorSummary.counts[key] ?? 0;
              const meta = DB_ERROR_META[key];
              const highlighted = key === "plan_limit" || key === "connection";
              return (
                <span
                  key={key}
                  title={`${meta.label} DB failures today`}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold ${meta.chip} ${
                    count > 0 && highlighted ? "ring-2 ring-red-400 dark:ring-red-500" : ""
                  }`}
                >
                  {meta.label}
                  <span className={`px-1.5 py-0.5 rounded-full text-xs ${count > 0 ? "bg-white/70 dark:bg-slate-900/70" : ""}`}>
                    {count.toLocaleString()}
                  </span>
                </span>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-gray-400 dark:text-slate-500 italic">
            Day-scoped counts, persisted to the SQLite backup every 60s and restored on boot (IST day).
            Clearing the ring buffer below does not reset these counts.
          </p>
        </div>

        {dbErrors.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-slate-400">No DB errors recorded this session.</p>
        ) : (
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white dark:bg-slate-900">
                <tr className="border-b border-gray-200 dark:border-slate-700">
                  <th className="text-left py-2 px-3 text-gray-500 dark:text-slate-400 font-medium">Time</th>
                  <th className="text-left py-2 px-3 text-gray-500 dark:text-slate-400 font-medium">Model</th>
                  <th className="text-left py-2 px-3 text-gray-500 dark:text-slate-400 font-medium">Operation</th>
                  <th className="text-left py-2 px-3 text-gray-500 dark:text-slate-400 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {dbErrors.slice().reverse().map((err, i) => (
                  <tr
                    key={`${err.at}-${i}`}
                    className="border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50"
                  >
                    <td className="py-2 px-3 text-gray-900 dark:text-white whitespace-nowrap">
                      {formatTimeAgo(err.at)}
                    </td>
                    <td className="py-2 px-3 text-gray-600 dark:text-slate-400 font-mono text-xs">
                      {err.model}
                    </td>
                    <td className="py-2 px-3 text-gray-600 dark:text-slate-400">
                      {err.operation}
                    </td>
                    <td className="py-2 px-3 text-red-600 dark:text-red-400 text-xs max-w-xs truncate">
                      {err.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Table row counts — Prisma vs SQLite */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-4">
          Table Row Counts
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-slate-700">
                <th className="text-left py-2 px-3 text-gray-500 dark:text-slate-400 font-medium">Table</th>
                <th className="text-right py-2 px-3 text-gray-500 dark:text-slate-400 font-medium">Prisma</th>
                <th className="text-right py-2 px-3 text-gray-500 dark:text-slate-400 font-medium">SQLite</th>
                <th className="text-right py-2 px-3 text-gray-500 dark:text-slate-400 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(sqlite.tables).map((table) => {
                const prismaKey = table
                  .replace(/_/g, " ")
                  .replace(/\b\w/g, (c) => c.toUpperCase())
                  .replace(/ /g, "");
                const prismaCount = prisma.tableCounts[prismaKey] ?? prisma.tableCounts[table] ?? -1;
                const sqliteCount = sqlite.tables[table] ?? 0;
                const inSync = prismaCount === sqliteCount || prismaCount === -1;

                return (
                  <tr
                    key={table}
                    className="border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50"
                  >
                    <td className="py-2 px-3 font-medium text-gray-900 dark:text-white">{table}</td>
                    <td className="py-2 px-3 text-right text-gray-600 dark:text-slate-400">
                      {prismaCount === -1 ? (
                        <span className="text-gray-400">--</span>
                      ) : (
                        prismaCount.toLocaleString()
                      )}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-600 dark:text-slate-400">
                      {sqliteCount.toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {inSync ? (
                        <CheckCircleIcon className="w-4 h-4 text-emerald-500 inline" />
                      ) : (
                        <ExclamationTriangleIcon className="w-4 h-4 text-amber-500 inline" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent sync history */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-4">
          Recent Sync History
        </h3>
        {sqlite.recentSyncs.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-slate-400">No syncs recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-700">
                  <th className="text-left py-2 px-3 text-gray-500 dark:text-slate-400 font-medium">Time</th>
                  <th className="text-right py-2 px-3 text-gray-500 dark:text-slate-400 font-medium">Rows</th>
                  <th className="text-right py-2 px-3 text-gray-500 dark:text-slate-400 font-medium">Duration</th>
                  <th className="text-left py-2 px-3 text-gray-500 dark:text-slate-400 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {sqlite.recentSyncs.map((sync, i) => (
                  <tr
                    key={`${sync.at}-${i}`}
                    className="border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50"
                  >
                    <td className="py-2 px-3 text-gray-900 dark:text-white">
                      {formatTimeAgo(sync.at)}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-600 dark:text-slate-400">
                      {sync.rowsSynced.toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-600 dark:text-slate-400">
                      {sync.durationMs.toLocaleString()}ms
                    </td>
                    <td className="py-2 px-3">
                      {sync.error ? (
                        <span className="text-red-500 text-xs">{sync.error.slice(0, 80)}</span>
                      ) : (
                        <CheckCircleIcon className="w-4 h-4 text-emerald-500" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer info */}
      <div className="text-xs text-gray-400 dark:text-slate-500">
        Auto-refresh every 30 seconds. Background recovery probe runs every 5 minutes when Prisma is unavailable.
        Price cache auto-flushes daily_prices after 4 PM IST.
      </div>
    </div>
  );
}
