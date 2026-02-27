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
        return "bg-blue-100 text-blue-800";
      case "NSE_CALL":
        return "bg-purple-100 text-purple-800";
      case "USER_ACTION":
        return "bg-green-100 text-green-800";
      case "PORTFOLIO_ACTION":
        return "bg-yellow-100 text-yellow-800";
      case "LOGIN":
      case "LOGOUT":
        return "bg-gray-100 text-gray-800";
      case "RATE_LIMIT":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
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
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Audit Management</h1>
        <button
          onClick={handleClearOldLogs}
          className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
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

      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Action Type</label>
            <select
              value={filter.action}
              onChange={(e) => setFilter({ ...filter, action: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All</option>
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
            <input
              type="date"
              value={filter.startDate}
              onChange={(e) => setFilter({ ...filter, startDate: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
            <input
              type="date"
              value={filter.endDate}
              onChange={(e) => setFilter({ ...filter, endDate: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => {
                setFilter({ action: "", startDate: "", endDate: "" });
                setPagination((prev) => ({ ...prev, page: 1 }));
              }}
              className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors"
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
          <div className="flex justify-between items-center">
            <h3 className="text-lg leading-6 font-medium text-gray-900">
              Audit Logs ({pagination.total})
            </h3>
            <span className="text-sm text-gray-500">
              Page {pagination.page} of {pagination.totalPages}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="p-8">
            <div className="animate-pulse space-y-4">
              {[...Array(10)].map((_, i) => (
                <div key={i} className="bg-gray-200 h-12 rounded"></div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Resource</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Method</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Path</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Response Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-3 py-3 text-sm text-gray-500 whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-3 text-sm">
                        <div className="text-gray-900">{log.userEmail || "System"}</div>
                        {log.userId && <div className="text-gray-400 text-xs">ID: {log.userId}</div>}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getActionColor(log.action)}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-500">
                        {log.resource}
                        {log.resourceId && <span className="text-gray-400"> ({log.resourceId})</span>}
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-500">{log.method || "-"}</td>
                      <td className="px-3 py-3 text-sm text-gray-500 max-w-xs truncate" title={log.path || ""}>
                        {log.path || "-"}
                      </td>
                      <td className="px-3 py-3 text-sm font-medium">
                        <span className={getStatusColor(log.responseStatus)}>
                          {log.responseStatus || "-"}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-500">
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

            <div className="px-4 py-3 border-t border-gray-200 flex justify-between items-center">
              <button
                onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))}
                disabled={pagination.page === 1}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
                disabled={pagination.page >= pagination.totalPages}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
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
