"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface SSEStats {
  connectedClients: number;
  symbolsTracked: number;
  cachedSymbols: number;
  activeSubscriptions: number;
  pollIntervalSeconds: number;
  isMarketOpen: boolean;
  uptimeSeconds: number;
  trackedSymbols: string[];
}

export default function AdminLivePricesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [stats, setStats] = useState<SSEStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    if (!session || !session.user || (session.user as any).role !== "admin") {
      router.push("/");
    }
  }, [session, status, router]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/sse");
      if (res.ok) setStats(await res.json());
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      fetchStats();
      const interval = setInterval(fetchStats, 10_000);
      return () => clearInterval(interval);
    }
  }, [status, fetchStats]);

  const handleRestart = async () => {
    setRestarting(true);
    try {
      await fetch("/api/admin/sse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restart" }),
      });
      await new Promise((r) => setTimeout(r, 1000));
      await fetchStats();
    } catch {
      // silent
    } finally {
      setRestarting(false);
    }
  };

  const formatUptime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  if (status === "loading" || !session || (session.user as any).role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-gray-500">Checking permissions...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Live Prices (SSE) Dashboard</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Monitor real-time price streaming infrastructure
          </p>
        </div>
        <button
          onClick={handleRestart}
          disabled={restarting}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {restarting ? "Restarting..." : "Restart Service"}
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {loading ? (
          [...Array(4)].map((_, i) => (
            <div key={i} className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-slate-700 animate-pulse">
              <div className="h-4 w-20 bg-gray-200 dark:bg-slate-600 rounded mb-3" />
              <div className="h-8 w-12 bg-gray-200 dark:bg-slate-600 rounded" />
            </div>
          ))
        ) : (
          <>
            <StatCard label="Connected Clients" value={stats?.connectedClients ?? 0} color="text-blue-600" />
            <StatCard label="Symbols Tracked" value={stats?.symbolsTracked ?? 0} color="text-green-600" />
            <StatCard label="Cached Prices" value={stats?.cachedSymbols ?? 0} color="text-purple-600" />
            <StatCard label="Uptime" value={stats ? formatUptime(stats.uptimeSeconds) : "—"} color="text-gray-600" />
            <StatCard label="Poll Interval" value={stats ? `${stats.pollIntervalSeconds}s` : "—"} color="text-orange-600" />
            <StatCard
              label="Market Status"
              value={stats?.isMarketOpen ? "Open" : "Closed"}
              color={stats?.isMarketOpen ? "text-green-600" : "text-red-600"}
            />
            <StatCard label="Active Subs" value={stats?.activeSubscriptions ?? 0} color="text-teal-600" />
            <StatCard label="Restart" value={restarting ? "..." : "Available"} color="text-gray-500" />
          </>
        )}
      </div>

      {/* Tracked symbols */}
      <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-gray-200 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Tracked Symbols</h3>
        {!stats || stats.trackedSymbols.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No symbols currently being tracked. Connect to the SSE endpoint to start tracking.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {stats.trackedSymbols.map((sym) => (
              <span
                key={sym}
                className="px-3 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs font-mono rounded-full"
              >
                {sym}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Connection info */}
      <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-gray-200 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">SSE Connection Info</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Clients connect to the SSE endpoint to receive live price updates.
        </p>
        <code className="block bg-gray-100 dark:bg-slate-700 rounded p-3 text-sm text-gray-800 dark:text-gray-200 font-mono">
          GET /api/prices/stream?symbols=RELIANCE,TCS,INFY
        </code>
        <div className="mt-4 text-xs text-gray-400 dark:text-gray-500 space-y-1">
          <p>• Prices update every {stats?.pollIntervalSeconds || 10} seconds during market hours</p>
          <p>• Default poll interval (fallback): 60s when market is closed</p>
          <p>• Max 50 symbols per SSE connection</p>
          <p>• Auto-reconnect with exponential backoff (1s → 30s max)</p>
          <p>• Falls back to REST polling when SSE is unavailable</p>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-slate-700">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}
