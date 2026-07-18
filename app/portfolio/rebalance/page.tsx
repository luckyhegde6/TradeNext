"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import AllocationPieChart from "@/app/components/rebalancer/AllocationPieChart";
import AllocationTable from "@/app/components/rebalancer/AllocationTable";
import TradeSuggestionList from "@/app/components/rebalancer/TradeSuggestionList";
import TargetAllocationEditor from "@/app/components/rebalancer/TargetAllocationEditor";
import {
  AllocationCategory,
  RebalancerProfile,
  RebalancerResult,
  DEFAULT_SECTOR_TARGETS,
} from "@/lib/services/rebalancerService";

export default function RebalancePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [result, setResult] = useState<RebalancerResult | null>(null);
  const [profiles, setProfiles] = useState<RebalancerProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [editCategories, setEditCategories] = useState<AllocationCategory[]>(DEFAULT_SECTOR_TARGETS);
  const [driftThreshold, setDriftThreshold] = useState(5);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) router.push("/");
  }, [session, status, router]);

  // Fetch profiles
  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch("/api/portfolio/rebalancer/config");
      if (res.ok) {
        const data = await res.json();
        setProfiles(data.profiles || []);
      }
    } catch { /* silent */ }
  }, []);

  // Fetch rebalancer result
  const fetchResult = useCallback(async (profileId?: string) => {
    setLoading(true);
    setError("");
    try {
      let url = "/api/portfolio/rebalancer";
      if (profileId) url += `?profileId=${profileId}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.hasProfile) {
        setResult(data);
        setEditCategories(data.profile.categories);
        setDriftThreshold(data.profile.driftThreshold);
        setActiveProfileId(data.profile.id);
      } else {
        setResult(null);
        setActiveProfileId(null);
        setEditCategories(DEFAULT_SECTOR_TARGETS);
        setDriftThreshold(5);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load rebalancer data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      fetchProfiles().then(() => fetchResult());
    }
  }, [status, fetchProfiles, fetchResult]);

  const selectProfile = async (id: string) => {
    setActiveProfileId(id);
    await fetchResult(id);
  };

  // Save profile
  const saveProfile = async () => {
    setSaving(true);
    try {
      const body = { categories: editCategories, driftThreshold };
      const res = activeProfileId
        ? await fetch(`/api/portfolio/rebalancer/config?id=${activeProfileId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/portfolio/rebalancer/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to save");
        return;
      }
      setEditMode(false);
      await fetchProfiles();
      await fetchResult(activeProfileId || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  if (status === "loading" || !session) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Portfolio Rebalancer</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Compare your current portfolio allocation against targets and get actionable trade suggestions
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Profile selector */}
          {profiles.length > 0 && (
            <select
              value={activeProfileId || ""}
              onChange={(e) => e.target.value && selectProfile(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => { setEditMode(!editMode); if (!editMode) setEditCategories(result?.profile.categories || DEFAULT_SECTOR_TARGETS); }}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              editMode
                ? "bg-gray-200 dark:bg-slate-600 text-gray-700 dark:text-gray-200"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            {editMode ? "Cancel" : "Edit Targets"}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-sm text-red-700 dark:text-red-300">
          {error}
          <button onClick={() => fetchResult()} className="ml-3 underline hover:no-underline">Retry</button>
        </div>
      )}

      {/* Status banner */}
      {result && result.isBalanced && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 text-sm text-green-700 dark:text-green-300">
          Your portfolio is balanced! No rebalancing needed.
        </div>
      )}

      {result && !result.isBalanced && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 text-sm text-yellow-700 dark:text-yellow-300">
          Your portfolio has drifted from its targets. Review the suggestions below.
        </div>
      )}

      {/* No profile state */}
      {!loading && !result && !error && (
        <div className="bg-white dark:bg-slate-800 rounded-lg p-8 text-center border border-gray-200 dark:border-slate-700">
          <div className="text-4xl mb-3">🎯</div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">Set Your First Target Allocation</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Create an allocation profile to get rebalancing suggestions.
          </p>
          <button
            onClick={() => setEditMode(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            Create Profile
          </button>
        </div>
      )}

      {/* Edit mode */}
      {editMode && (
        <div className="space-y-4">
          <TargetAllocationEditor
            categories={editCategories}
            onChange={setEditCategories}
          />
          <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-slate-700">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Drift Threshold: {driftThreshold}%
            </label>
            <input
              type="range"
              min={1}
              max={20}
              value={driftThreshold}
              onChange={(e) => setDriftThreshold(Number(e.target.value))}
              className="w-full mt-2"
            />
            <p className="text-xs text-gray-400 mt-1">
              Trigger rebalancing when a category drifts more than {driftThreshold}% from target
            </p>
          </div>
          <button
            onClick={saveProfile}
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : activeProfileId ? "Update Profile" : "Create Profile"}
          </button>
        </div>
      )}

      {/* Results */}
      {result && !editMode && (
        <>
          {/* Pie charts */}
          <AllocationPieChart
            current={result.currentAllocations.map((a) => ({ name: a.name, percent: a.currentPercent, value: a.currentValue }))}
            target={result.targetAllocations.map((a) => ({ name: a.name, percent: a.targetPercent, value: (a.targetPercent / 100) * result.totalValue }))}
          />

          {/* Unallocated warning */}
          {result.unallocated.percent > 0 && (
            <div className="bg-gray-50 dark:bg-slate-800/50 rounded-lg p-3 border border-gray-200 dark:border-slate-700">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Unallocated: {result.unallocated.percent.toFixed(1)}% (₹{result.unallocated.value.toLocaleString("en-IN", { maximumFractionDigits: 0 })})
                — these funds are not assigned to any target category.
              </p>
            </div>
          )}

          {/* Allocation table */}
          <AllocationTable
            actions={result.actions}
            totalValue={result.totalValue}
            loading={loading}
          />

          {/* Trade suggestions */}
          <TradeSuggestionList
            actions={result.actions.filter((a) => a.type !== "HOLD")}
            loading={loading}
          />
        </>
      )}
    </div>
  );
}
