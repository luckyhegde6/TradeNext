"use client";

import { useState, useEffect } from "react";

interface AuditLog {
  id: string;
  userId: number | null;
  userEmail: string | null;
  action: string;
  resource: string | null;
  resourceId: string | null;
  method: string | null;
  path: string | null;
  responseStatus: number | null;
  responseTime: number | null;
  nseEndpoint: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export default function AdminAuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<{
    action: string;
    startDate: string;
    endDate: string;
  }>({
    action: "",
    startDate: "",
    endDate: "",
  });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  });

  useEffect(() => {
    fetchLogs();
  }, [filter, pagination.page]);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.append("page", pagination.page.toString());
      params.append("limit", pagination.limit.toString());
      if (filter.action) params.append("action", filter.action);
      if (filter.startDate) params.append("startDate", filter.startDate);
      if (filter.endDate) params.append("endDate", filter.endDate);

      const response = await fetch(`/api/admin/audit?${params}`);
      if (!response.ok) throw new Error("Failed to fetch audit logs");
      const data = await response.json();
      setLogs(data.logs);
      setPagination((prev) => ({ ...prev, ...data.pagination }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case "API_CALL":
        return "bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-400 border border-blue-200 dark:border-blue-800";
      case "NSE_CALL":
        return "bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-400 border border-purple-200 dark:border-purple-800";
      case "USER_ACTION":
        return "bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-400 border border-green-200 dark:border-green-800";
      case "PORTFOLIO_ACTION":
        return "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800";
      case "LOGIN":
      case "LOGOUT":
        return "bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700";
      case "RATE_LIMIT":
        return "bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-400 border border-red-200 dark:border-red-800";
      default:
        return "bg-gray-100 dark:bg-slate-800 text-gray-800 dark:text-slate-300 border border-gray-200 dark:border-slate-700";
    }
  };

  const getStatusColor = (status: number | null) => {
    if (!status) return "text-gray-500";
    if (status >= 200 && status < 300) return "text-green-600";
    if (status >= 400 && status < 500) return "text-yellow-600";
    if (status >= 500) return "text-red-600";
    return "text-gray-600";
  };

  const handleClearOldLogs = async () => {
    const days = prompt("Delete logs older than how many days?", "30");
    if (!days) return;

    try {
      const response = await fetch(
        `/api/admin/audit?olderThan=${new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000).toISOString()}`,
        { method: "DELETE" }
      );
      if (!response.ok) throw new Error("Failed to delete logs");
      fetchLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete logs");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center border-b dark:border-slate-800 pb-4">
        <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">Audit Management</h1>
        <button
          onClick={handleClearOldLogs}
          className="bg-red-600 text-white px-5 py-2.5 rounded-lg font-bold hover:bg-red-700 transition-all shadow-md active:scale-95"
        >
          Clear Old Logs
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
          <button onClick={() => setError(null)} className="mt-2 text-red-600 hover:text-red-800 text-sm">
            Dismiss
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-lg border border-gray-100 dark:border-slate-800">
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5 ml-1">Action Type</label>
            <select
              value={filter.action}
              onChange={(e) => setFilter({ ...filter, action: e.target.value })}
              className="px-4 py-2 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            >
              <option value="">All Actions</option>
              <option value="API_CALL">API Call</option>
              <option value="NSE_CALL">NSE Call</option>
              <option value="USER_ACTION">User Action</option>
              <option value="PORTFOLIO_ACTION">Portfolio Action</option>
              <option value="LOGIN">Login</option>
              <option value="LOGOUT">Logout</option>
              <option value="RATE_LIMIT">Rate Limit</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5 ml-1">Start Date</label>
            <input
              type="date"
              value={filter.startDate}
              onChange={(e) => setFilter({ ...filter, startDate: e.target.value })}
              className="px-4 py-2 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5 ml-1">End Date</label>
            <input
              type="date"
              value={filter.endDate}
              onChange={(e) => setFilter({ ...filter, endDate: e.target.value })}
              className="px-4 py-2 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => {
                setFilter({ action: "", startDate: "", endDate: "" });
                setPagination((prev) => ({ ...prev, page: 1 }));
              }}
              className="px-6 py-2 bg-gray-500 text-white rounded-lg font-bold hover:bg-gray-600 transition-all active:scale-95"
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 shadow-xl border border-gray-100 dark:border-slate-800 overflow-hidden rounded-xl">
        <div className="px-6 py-5 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/50">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              Audit Logs ({pagination.total})
            </h3>
            <span className="text-sm font-semibold text-gray-500 dark:text-slate-400">
              Page {pagination.page} of {pagination.totalPages}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="p-8">
            <div className="animate-pulse space-y-4">
              {[...Array(10)].map((_, i) => (
                <div key={i} className="bg-gray-100 dark:bg-slate-800 h-10 rounded-lg"></div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50/50 dark:bg-slate-800/50">
                  <tr>
                    <th className="px-4 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">Time</th>
                    <th className="px-4 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">User</th>
                    <th className="px-4 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">Action</th>
                    <th className="px-4 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">Resource</th>
                    <th className="px-4 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">Method</th>
                    <th className="px-4 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">Path</th>
                    <th className="px-4 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">Status</th>
                    <th className="px-4 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">Speed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-800">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-4 text-xs text-gray-500 dark:text-slate-500 whitespace-nowrap font-mono">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-sm">
                        <div className="font-bold text-gray-900 dark:text-white">{log.userEmail || "System"}</div>
                        {log.userId && <div className="text-gray-400 dark:text-slate-500 text-xs font-medium">ID: {log.userId}</div>}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`px-2.5 py-1 text-[10px] font-bold rounded-full uppercase tracking-tighter ${getActionColor(log.action)}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-600 dark:text-slate-300 font-medium">
                        {log.resource}
                        {log.resourceId && <span className="text-gray-400 dark:text-slate-500 font-normal"> ({log.resourceId})</span>}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-500 dark:text-slate-400 font-mono italic">{log.method || "-"}</td>
                      <td className="px-4 py-4 text-xs text-gray-500 dark:text-slate-500 max-w-xs truncate font-mono" title={log.path || ""}>
                        {log.path || "-"}
                      </td>
                      <td className="px-4 py-4 text-sm font-bold">
                        <span className={getStatusColor(log.responseStatus)}>
                          {log.responseStatus || "-"}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-500 dark:text-slate-400 font-medium">
                        {log.responseTime ? `${log.responseTime}ms` : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {logs.length === 0 && (
              <div className="px-4 py-8 text-center">
                <p className="text-gray-500">No audit logs found.</p>
              </div>
            )}

            <div className="px-6 py-4 border-t border-gray-200 dark:border-slate-800 flex justify-between items-center bg-gray-50/30 dark:bg-slate-800/20">
              <button
                onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))}
                disabled={pagination.page === 1}
                className="px-5 py-2 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 rounded-lg font-bold border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95 shadow-sm"
              >
                Previous
              </button>
              <button
                onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
                disabled={pagination.page >= pagination.totalPages}
                className="px-5 py-2 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 rounded-lg font-bold border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95 shadow-sm"
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
