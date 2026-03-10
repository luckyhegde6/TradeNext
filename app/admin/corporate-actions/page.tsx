"use client";

import { useState, useEffect, useRef } from "react";

interface CorporateAction {
  id: number;
  symbol: string;
  companyName: string;
  series: string | null;
  subject: string;
  actionType: string;
  exDate: string | null;
  recordDate: string | null;
  faceValue: string | null;
  ratio: string | null;
  dividendPerShare: number | null;
  source: string;
  createdAt: string;
}

export default function AdminCorporateActionsPage() {
  const [actions, setActions] = useState<CorporateAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchActions(); }, []);

  const fetchActions = async () => {
    try {
      const res = await fetch("/api/admin/corporate-actions", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setActions(data);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true); setError(null);
    try {
      const formData = new FormData(); formData.append("csv", file);
      const res = await fetch("/api/admin/corporate-actions", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Upload failed"); }
      fetchActions(); if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); }
    finally { setUploading(false); }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} records?`)) return;
    try {
      const res = await fetch(`/api/admin/corporate-actions?ids=${Array.from(selectedIds).join(",")}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setSelectedIds(new Set()); fetchActions();
    } catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); }
  };

  const toggleSelect = (id: number) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === actions.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(actions.map(a => a.id)));
  };

  const exportToCSV = () => {
    const headers = ["Symbol", "Company", "Type", "Purpose", "Ex-Date", "Record Date", "Face Value", "Ratio", "Dividend", "Source"];
    const rows = actions.map(a => [a.symbol, a.companyName, a.actionType, a.subject || "", a.exDate ? new Date(a.exDate).toLocaleDateString() : "", a.recordDate ? new Date(a.recordDate).toLocaleDateString() : "", a.faceValue || "", a.ratio || "", a.dividendPerShare?.toString() || "", a.source]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `corporate-actions-${new Date().toISOString().split("T")[0]}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8 p-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-4xl font-extrabold text-gray-900 dark:text-white">Corporate Actions</h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1 font-medium">Upload and manage dividends, splits, bonus, rights, etc.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={exportToCSV} className="px-6 py-3 bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 rounded-xl font-bold hover:bg-gray-200 dark:hover:bg-slate-700 transition-all">Export CSV</button>
          <label className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all cursor-pointer flex items-center gap-2">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
            Upload CSV
            <input type="file" accept=".csv" onChange={handleUpload} className="hidden" disabled={uploading} />
          </label>
        </div>
      </div>

      {error && <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4"><p className="text-red-800 dark:text-red-400">{error}</p><button onClick={() => setError(null)} className="mt-2 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 text-sm">Dismiss</button></div>}

      <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/50 flex justify-between items-center">
          <h2 className="text-xl font-black text-gray-900 dark:text-white">All Actions ({actions.length})</h2>
          {selectedIds.size > 0 && <button onClick={handleBulkDelete} className="text-red-600 dark:text-red-400 hover:underline text-sm font-bold">Delete Selected ({selectedIds.size})</button>}
        </div>

        {loading ? <div className="p-8 text-center text-gray-500 dark:text-slate-400">Loading...</div> : actions.length === 0 ? <div className="p-8 text-center text-gray-500 dark:text-slate-400">No corporate actions found.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50/50 dark:bg-slate-800/30 text-gray-500 dark:text-slate-400 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 text-left"><input type="checkbox" checked={selectedIds.size === actions.length} onChange={toggleSelectAll} className="rounded accent-blue-600" /></th>
                  <th className="px-4 py-3 text-left">Symbol</th>
                  <th className="px-4 py-3 text-left">Company</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Purpose</th>
                  <th className="px-4 py-3 text-left">Ex-Date</th>
                  <th className="px-4 py-3 text-left">Record Date</th>
                  <th className="px-4 py-3 text-left">FV</th>
                  <th className="px-4 py-3 text-left">Dividend</th>
                  <th className="px-4 py-3 text-left">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {actions.map(action => (
                  <tr key={action.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/10">
                    <td className="px-4 py-3"><input type="checkbox" checked={selectedIds.has(action.id)} onChange={() => toggleSelect(action.id)} className="rounded accent-blue-600" /></td>
                    <td className="px-4 py-3 font-bold text-blue-600 dark:text-blue-400">{action.symbol}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-slate-300 max-w-xs truncate" title={action.companyName}>{action.companyName}</td>
                    <td className="px-4 py-3"><span className="px-2 py-1 rounded-full text-xs font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300">{action.actionType}</span></td>
                    <td className="px-4 py-3 text-gray-600 dark:text-slate-400 max-w-md truncate" title={action.subject}>{action.subject}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{action.exDate ? new Date(action.exDate).toLocaleDateString() : "-"}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{action.recordDate ? new Date(action.recordDate).toLocaleDateString() : "-"}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{action.faceValue || "-"}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{action.dividendPerShare ? `₹${action.dividendPerShare}` : "-"}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-bold ${action.source === "admin" ? "bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300" : "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300"}`}>{action.source}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}