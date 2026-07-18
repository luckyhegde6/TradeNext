"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface RebalanceOverview {
  totalConfigs: number;
  uniqueUsers: number;
  avgDriftThreshold: number;
  topCategories: { name: string; count: number }[];
  latestConfigs: {
    id: string;
    name: string;
    user: { id: number; name: string; email: string };
    numCategories: number;
    driftThreshold: number;
    updatedAt: string;
  }[];
}

export default function AdminRebalancePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [overview, setOverview] = useState<RebalanceOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "loading") return;
    if (!session || !session.user || (session.user as any).role !== "admin") {
      router.push("/");
    }
  }, [session, status, router]);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/rebalance");
      if (res.ok) setOverview(await res.json());
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") fetchOverview();
  }, [fetchOverview, status]);

  if (status === "loading" || !session || (session.user as any).role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-gray-500">Checking permissions...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Rebalancer Management</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Overview of rebalancer configuration usage across all users
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-slate-700 animate-pulse">
              <div className="h-4 w-24 bg-gray-200 dark:bg-slate-600 rounded mb-3" />
              <div className="h-8 w-16 bg-gray-200 dark:bg-slate-600 rounded" />
            </div>
          ))}
        </div>
      ) : overview ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-gray-200 dark:border-slate-700">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total Configs</p>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">{overview.totalConfigs}</p>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 border border-gray-200 dark:border-slate-700">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Users with Configs</p>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">{overview.uniqueUsers}</p>
            </div>
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 border border-gray-200 dark:border-slate-700">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Avg Drift Threshold</p>
              <p className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">{overview.avgDriftThreshold}%</p>
            </div>
            <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4 border border-gray-200 dark:border-slate-700">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Unique Categories Used</p>
              <p className="text-2xl font-bold text-orange-600 dark:text-orange-400 mt-1">{overview.topCategories.length}</p>
            </div>
          </div>

          {/* Top categories */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
            <div className="p-4 border-b border-gray-200 dark:border-slate-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Most Popular Allocation Categories</h3>
            </div>
            <div className="p-4">
              {overview.topCategories.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No categories used yet.</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {overview.topCategories.map((cat) => (
                    <div key={cat.name} className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-3 text-center">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{cat.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{cat.count} config{cat.count !== 1 ? "s" : ""}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Latest configs */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
            <div className="p-4 border-b border-gray-200 dark:border-slate-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Latest Configurations</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-200 dark:border-slate-600">
                    <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">User</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Profile Name</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-500 dark:text-gray-400">Categories</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-500 dark:text-gray-400">Threshold</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Last Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
                  {overview.latestConfigs.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 dark:text-white">{c.user.name || "—"}</p>
                        <p className="text-xs text-gray-500">{c.user.email}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{c.name}</td>
                      <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-400 font-mono">{c.numCategories}</td>
                      <td className="px-4 py-3 text-center font-mono text-gray-600 dark:text-gray-400">{c.driftThreshold}%</td>
                      <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">
                        {new Date(c.updatedAt).toLocaleDateString("en-IN")}
                      </td>
                    </tr>
                  ))}
                  {overview.latestConfigs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-400">No configurations yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-lg p-8 text-center border border-gray-200 dark:border-slate-700">
          <p className="text-gray-500">Could not load rebalancer data.</p>
          <button onClick={fetchOverview} className="mt-3 text-blue-600 hover:underline text-sm">Retry</button>
        </div>
      )}
    </div>
  );
}
