"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface DividendRecord {
  id: number;
  symbol: string;
  companyName: string;
  exDate: string | null;
  recordDate: string | null;
  dividendPerShare: number | null;
  dividendYield: number | null;
  faceValue: string | null;
  source: string;
  isin: string | null;
}

interface AdminDividendStats {
  totalDividends: number;
  missingPrice: number;
}

export default function AdminDividendsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [dividends, setDividends] = useState<DividendRecord[]>([]);
  const [stats, setStats] = useState<AdminDividendStats>({ totalDividends: 0, missingPrice: 0 });
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [year, setYear] = useState("");

  // Form state for manual entry
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    symbol: "",
    companyName: "",
    dividendPerShare: "",
    exDate: "",
    recordDate: "",
    faceValue: "",
    type: "Interim",
  });
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");

  useEffect(() => {
    if (status === "loading") return;
    if (!session || !session.user || (session.user as any).role !== "admin") {
      router.push("/");
    }
  }, [session, status, router]);

  const fetchDividends = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (search) params.set("search", search);
      if (year) params.set("year", year);

      const res = await fetch(`/api/admin/dividends?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDividends(data.data || []);
      setTotalPages(data.totalPages || 1);
      setStats(data.stats || { totalDividends: 0, missingPrice: 0 });
      setLastSyncAt(data.lastSyncAt);
    } catch (err) {
      console.error("Failed to fetch dividends:", err);
    } finally {
      setLoading(false);
    }
  }, [page, search, year]);

  useEffect(() => { if (status === "authenticated") fetchDividends(); }, [fetchDividends, status]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setFormSuccess("");

    if (!formData.symbol || !formData.dividendPerShare || !formData.exDate) {
      setFormError("Symbol, dividend amount, and ex-date are required");
      return;
    }

    try {
      const res = await fetch("/api/admin/dividends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create");
      }
      setFormSuccess(`Dividend for ${formData.symbol} created successfully`);
      setFormData({ symbol: "", companyName: "", dividendPerShare: "", exDate: "", recordDate: "", faceValue: "", type: "Interim" });
      setShowForm(false);
      fetchDividends();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create dividend");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this dividend record?")) return;
    try {
      const res = await fetch(`/api/admin/dividends?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      fetchDividends();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dividend Management</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage dividend records, view sync status, and add manual entries
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          {showForm ? "Cancel" : "+ Add Dividend"}
        </button>
      </div>

      {/* Sync status card */}
      <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-slate-700">
        <div className="flex items-center gap-6 text-sm">
          <div>
            <span className="text-gray-500 dark:text-gray-400">Total Dividends:</span>
            <span className="ml-2 font-semibold text-gray-900 dark:text-white">{stats.totalDividends}</span>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">Last NSE Sync:</span>
            <span className="ml-2 text-gray-900 dark:text-white">
              {lastSyncAt ? formatDate(lastSyncAt) : "Never"}
            </span>
          </div>
          <button
            onClick={fetchDividends}
            className="ml-auto text-blue-600 dark:text-blue-400 hover:underline text-sm"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Manual entry form */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-gray-200 dark:border-slate-700 space-y-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Add Dividend Record</h3>

          {formError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
              {formError}
            </div>
          )}
          {formSuccess && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 text-sm text-green-700 dark:text-green-300">
              {formSuccess}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Symbol *</label>
              <input
                type="text"
                value={formData.symbol}
                onChange={(e) => setFormData({ ...formData, symbol: e.target.value.toUpperCase() })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                placeholder="RELIANCE"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Company Name</label>
              <input
                type="text"
                value={formData.companyName}
                onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                placeholder="Reliance Industries Ltd"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Dividend Per Share (₹) *</label>
              <input
                type="number"
                step="0.01"
                value={formData.dividendPerShare}
                onChange={(e) => setFormData({ ...formData, dividendPerShare: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                placeholder="10.00"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ex-Date *</label>
              <input
                type="date"
                value={formData.exDate}
                onChange={(e) => setFormData({ ...formData, exDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Record Date</label>
              <input
                type="date"
                value={formData.recordDate}
                onChange={(e) => setFormData({ ...formData, recordDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
              >
                <option value="Interim">Interim</option>
                <option value="Final">Final</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Face Value</label>
              <input
                type="text"
                value={formData.faceValue}
                onChange={(e) => setFormData({ ...formData, faceValue: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                placeholder="10"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              Create Dividend
            </button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4">
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by symbol or company..."
          className="flex-1 max-w-xs px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white text-sm"
        />
        <select
          value={year}
          onChange={(e) => { setYear(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white text-sm"
        >
          <option value="">All Years</option>
          {[2026, 2025, 2024, 2023].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {/* Data table */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-200 dark:border-slate-600">
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Symbol</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Company</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Amount</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Yield</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Ex-Date</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Record Date</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Source</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : dividends.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                    No dividend records found
                  </td>
                </tr>
              ) : (
                dividends.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                    <td className="px-4 py-3 font-mono font-medium text-gray-900 dark:text-white">{d.symbol}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 max-w-[200px] truncate">{d.companyName}</td>
                    <td className="px-4 py-3 text-right text-green-600 dark:text-green-400 font-medium">
                      {d.dividendPerShare ? `₹${d.dividendPerShare.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">
                      {d.dividendYield !== null ? `${d.dividendYield.toFixed(2)}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{formatDate(d.exDate)}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{formatDate(d.recordDate)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        d.source === "nse"
                          ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                          : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                      }`}>
                        {d.source}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(d.id)}
                        className="text-red-600 dark:text-red-400 hover:underline text-xs"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-slate-600">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="px-3 py-1 text-sm text-gray-600 dark:text-gray-400 disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-slate-700 rounded"
            >
              Previous
            </button>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1 text-sm text-gray-600 dark:text-gray-400 disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-slate-700 rounded"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
