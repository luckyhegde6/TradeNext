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
  ArrowDownTrayIcon,
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
  // v3.22.0: write-behind queue stats + leader election + SQLite liveness
  writeBehind: {
    pending: Record<string, number>;
    lastPromoted: Record<string, number>;
    lastRetained: Record<string, number>;
    lastFlushAt: string | null;
    lastFlushCounts: Record<string, number>;
  };
  leader: {
    self: string;
    worker: Record<string, unknown> | null;
    cronDaemon: Record<string, unknown> | null;
    sqliteSync: Record<string, unknown> | null;
  };
  liveness: Array<Record<string, unknown>>;
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

function safeStringify(value: unknown): string {
  if (value == null) return "--";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const s = JSON.stringify(value);
    return s && s.length > 80 ? `${s.slice(0, 80)}…` : (s ?? "--");
  } catch {
    return "--";
  }
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
  const [flushingLogs, setFlushingLogs] = useState(false);
  const [preppingDeploy, setPreppingDeploy] = useState(false);
  const [deployMsg, setDeployMsg] = useState<string | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);

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

  const triggerFlushLogs = async () => {
    setFlushingLogs(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/admin/db-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "flush_logs" }),
      });
      const body = await res.json();
      if (res.ok) {
        const counts = body.flushedCounts
          ? Object.entries(body.flushedCounts)
              .filter(([, n]) => (n as number) > 0)
              .map(([k, n]) => `${k}: ${n}`)
              .join(", ")
          : "";
        setSyncMsg(body.message ?? `Flushed write-behind logs (${counts})`);
        await fetchHealth();
      } else {
        setSyncMsg(`Flush failed: ${body.error}`);
      }
    } catch (e) {
      setSyncMsg(`Flush error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFlushingLogs(false);
    }
  };

  const triggerDeployPrep = async () => {
    setPreppingDeploy(true);
    setDeployMsg(null);
    try {
      const res = await fetch("/api/admin/db-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deploy_prep" }),
      });
      const body = await res.json();
      if (res.ok) {
        setDeployMsg(
          body.message ??
            `Deploy prep complete — flushed ${body.rowsFlushed} write-behind rows and refreshed the SQLite mirror`,
        );
        await fetchHealth();
      } else {
        setDeployMsg(`Deploy prep failed: ${body.error ?? body.detail}`);
      }
    } catch (e) {
      setDeployMsg(`Deploy prep error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPreppingDeploy(false);
    }
  };

  const triggerBackup = async () => {
    setBackingUp(true);
    setBackupMsg(null);
    try {
      const res = await fetch("/api/admin/db-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backup" }),
      });
      const body = await res.json();
      if (!res.ok || !body.data) {
        setBackupMsg(`Backup failed: ${body.error ?? "no data"}`);
        return;
      }
      const bin = atob(body.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: body.mime ?? "application/x-sqlite3" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = body.filename ?? "tradenext-sqlite-backup.sqlite";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setBackupMsg(`Backup downloaded (${body.size} bytes)`);
    } catch (e) {
      setBackupMsg(`Backup error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBackingUp(false);
    }
  };

  const triggerRestore = async () => {
    if (!restoreFile) {
      setBackupMsg("Select a backup file first.");
      return;
    }
    setRestoring(true);
    setBackupMsg(null);
    try {
      const fileBytes = new Uint8Array(await restoreFile.arrayBuffer());
      let b64 = "";
      for (const b of fileBytes) b64 += String.fromCharCode(b);
      b64 = btoa(b64);
      const res = await fetch("/api/admin/db-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", data: b64 }),
      });
      const body = await res.json();
      if (res.ok) {
        setBackupMsg(body.message ?? "SQLite backup restored");
        setRestoreFile(null);
        await fetchHealth();
      } else {
        setBackupMsg(`Restore failed: ${body.detail ?? body.error}`);
      }
    } catch (e) {
      setBackupMsg(`Restore error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRestoring(false);
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

  const { prisma, sqlite, dailyPriceCache, dbErrors, dbErrorSummary, writeBehind, leader, liveness } = data;
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
            onClick={triggerDeployPrep}
            disabled={preppingDeploy || !sqlite.ready}
            title="Before deploying: flush queued write-behind logs (APIRequestLog/ServerLog/AuditLog) from the in-memory SQLite queue into Prisma, then refresh the SQLite read-mirror from Prisma so no in-memory data is lost on restart."
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <ArrowPathIcon className={`w-4 h-4 ${preppingDeploy ? "animate-spin" : ""}`} />
            {preppingDeploy ? "Preparing..." : "Prepare for Deploy"}
          </button>
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
          <button
            onClick={triggerFlushLogs}
            disabled={flushingLogs}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <BoltIcon className={`w-4 h-4 ${flushingLogs ? "animate-spin" : ""}`} />
            {flushingLogs ? "Flushing..." : "Flush Logs"}
          </button>
        </div>
      </div>

      {syncMsg && (
        <div className="px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-700 dark:text-blue-300">
          {syncMsg}
        </div>
      )}

      {deployMsg && (
        <div className="px-4 py-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg text-sm text-emerald-700 dark:text-emerald-300">
          {deployMsg}
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

      {/* Write-Behind Queue + Leader Election + Liveness (v3.22.0) */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">
            Write-Behind Log Queue · Leader Election · Liveness
          </h3>
          <span className="text-xs text-gray-400 dark:text-slate-500 font-mono">
            self: {leader.self ?? "--"}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
          {([["api_request", "api"], ["server_log", "log"], ["audit_log", "audit"]] as const).map(([key, label]) => (
            <div key={key} className="bg-gray-50 dark:bg-slate-800/50 rounded-lg p-3">
              <p className="text-xs text-gray-500 dark:text-slate-400">{label}</p>
              <p className="text-lg font-bold text-gray-900 dark:text-white">
                {(writeBehind.pending[key] ?? 0).toLocaleString()}
              </p>
              <p className="text-xs text-gray-400 dark:text-slate-500">pending</p>
            </div>
          ))}
          <div className="bg-gray-50 dark:bg-slate-800/50 rounded-lg p-3">
            <p className="text-xs text-gray-500 dark:text-slate-400">Last Flush</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">
              {formatTimeAgo(writeBehind.lastFlushAt)}
            </p>
            <p className="text-xs text-gray-400 dark:text-slate-500">
              {writeBehind.lastFlushAt
                ? `api:${writeBehind.lastFlushCounts.api_request ?? 0} · log:${writeBehind.lastFlushCounts.server_log ?? 0} · audit:${writeBehind.lastFlushCounts.audit_log ?? 0}`
                : "never flushed"}
            </p>
            {writeBehind.lastFlushAt && (
              <p className="mt-1 text-[11px] text-gray-400 dark:text-slate-500">
                <span className="text-emerald-600 dark:text-emerald-400">promoted</span>
                {" api:"}
                {writeBehind.lastPromoted.api_request ?? 0} · log:
                {writeBehind.lastPromoted.server_log ?? 0} · audit:
                {writeBehind.lastPromoted.audit_log ?? 0}
                {" · "}
                <span className="text-amber-600 dark:text-amber-400">retained</span>
                {" api:"}
                {writeBehind.lastRetained.api_request ?? 0} · log:
                {writeBehind.lastRetained.server_log ?? 0} · audit:
                {writeBehind.lastRetained.audit_log ?? 0}
              </p>
            )}
          </div>
        </div>

        {/* Leader per role */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          {(["worker", "cronDaemon", "sqliteSync"] as const).map((role) => {
            const info = leader[role];
            const active = !!info;
            return (
              <div
                key={role}
                className={`rounded-lg border p-3 text-sm ${
                  active
                    ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20"
                    : "border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="font-medium text-gray-700 dark:text-slate-300">
                    {role === "cronDaemon" ? "cron-daemon" : role === "sqliteSync" ? "sqlite-sync" : "worker"}
                  </p>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${
                      active
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                        : "bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400"
                    }`}
                  >
                    {active ? "Leader" : "Standby"}
                  </span>
                </div>
                {active && (
                  <p className="text-xs text-gray-500 dark:text-slate-400 font-mono truncate" title={String(info.holder ?? "")}>
                    {String(info.holder ?? "")}
                  </p>
                )}
                {active && typeof info.updatedAt === "string" && (
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
                    {formatTimeAgo(info.updatedAt)}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Liveness heartbeats (SQLite) */}
        <div>
          <p className="text-xs text-gray-500 dark:text-slate-400 mb-2">
            Liveness Heartbeats (SQLite — not Prisma)
          </p>
          {liveness.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-slate-500">No heartbeats recorded.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-slate-700">
                    <th className="text-left py-1.5 px-2 text-gray-500 dark:text-slate-400 font-medium">Role</th>
                    <th className="text-left py-1.5 px-2 text-gray-500 dark:text-slate-400 font-medium">Holder</th>
                    <th className="text-left py-1.5 px-2 text-gray-500 dark:text-slate-400 font-medium">Snapshot</th>
                    <th className="text-left py-1.5 px-2 text-gray-500 dark:text-slate-400 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {liveness.map((row, i) => {
                    const role = String(row.role ?? "--");
                    const holder = String(row.holder ?? "--");
                    const snapshot = safeStringify(row.snapshot);
                    const updated = row.updatedAt ? formatTimeAgo(String(row.updatedAt)) : "--";
                    return (
                      <tr
                        key={`${role}-${i}`}
                        className="border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50"
                      >
                        <td className="py-1.5 px-2 font-medium text-gray-900 dark:text-white">{role}</td>
                        <td className="py-1.5 px-2 text-gray-600 dark:text-slate-400 font-mono text-xs">{holder}</td>
                        <td className="py-1.5 px-2 text-gray-500 dark:text-slate-500 text-xs max-w-xs truncate">{snapshot}</td>
                        <td className="py-1.5 px-2 text-gray-600 dark:text-slate-400">{updated}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
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

      {/* SQLite backup / restore */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1">
          SQLite Backup &amp; Restore
        </h3>
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">
          The SQLite backup layer is an in-memory sql.js database (no physical file). Download exports
          the current in-memory snapshot as a .sqlite blob; restore uploads a prior backup and swaps it
          in as the active fallback (validated for the core tables before apply).
        </p>

        {backupMsg && (
          <div className="mb-4 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-700 dark:text-blue-300">
            {backupMsg}
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-end gap-4">
          <div>
            <button
              onClick={triggerBackup}
              disabled={backingUp || !sqlite.ready}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <ArrowDownTrayIcon className={`w-4 h-4 ${backingUp ? "animate-pulse" : ""}`} />
              {backingUp ? "Exporting..." : "Download Latest Backup"}
            </button>
          </div>

          <div className="flex-1 min-w-0">
            <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">
              Restore from uploaded .sqlite file
            </label>
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept=".sqlite,.db,application/x-sqlite3,application/octet-stream"
                onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
                disabled={restoring}
                className="block w-full text-sm text-gray-600 dark:text-slate-300 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-slate-100 dark:file:bg-slate-800 file:text-gray-700 dark:file:text-slate-300 hover:file:bg-slate-200 dark:hover:file:bg-slate-700"
              />
              <button
                onClick={triggerRestore}
                disabled={restoring || !restoreFile}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
              >
                <ArrowPathIcon className={`w-4 h-4 ${restoring ? "animate-spin" : ""}`} />
                {restoring ? "Restoring..." : "Apply Restore"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Footer info */}
      <div className="text-xs text-gray-400 dark:text-slate-500">
        Auto-refresh every 30 seconds. Background recovery probe runs every 5 minutes when Prisma is unavailable.
        Price cache auto-flushes daily_prices after 4 PM IST.
      </div>
    </div>
  );
}
