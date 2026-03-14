"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";

interface APIStats {
  totalRequests: number;
  nseRequests: number;
  rateLimited: number;
  anomalies: number;
  topEndpoints: { path: string; count: number }[];
  topIPs: { ip: string; count: number }[];
}

interface AnomalyAlert {
  id: string;
  alertType: string;
  severity: string;
  title: string;
  description: string;
  identifier: string | null;
  identifierType: string | null;
  endpoint: string | null;
  isResolved: boolean;
  createdAt: string;
}

interface RateLimitConfig {
  id: string;
  identifier: string;
  identifierType: string;
  limit: number;
  currentCount: number;
  isBlocked: boolean;
  blockReason: string | null;
  updatedAt: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-gray-100 text-gray-800",
  medium: "bg-yellow-100 text-yellow-800",
  high: "bg-orange-100 text-orange-800",
  critical: "bg-red-100 text-red-800",
};

export default function MonitoringPage() {
  const { data: session, status } = useSession();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "nse-logs" | "anomalies" | "rate-limits">("overview");
  const [stats, setStats] = useState<APIStats | null>(null);
  const [alerts, setAlerts] = useState<AnomalyAlert[]>([]);
  const [rateLimits, setRateLimits] = useState<RateLimitConfig[]>([]);
  const [nseLogs, setNseLogs] = useState<any[]>([]);
  const [hours, setHours] = useState(24);

  useEffect(() => {
    if (status === "authenticated") {
      fetchData();
      const interval = setInterval(fetchData, 30000); // Refresh every 30 seconds
      return () => clearInterval(interval);
    }
  }, [status, hours]);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Fetch overview stats
      const statsRes = await fetch(`/api/admin/monitoring?type=stats&hours=${hours}`);
      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data.apiStats);
      }

      // Fetch alerts
      const alertsRes = await fetch("/api/admin/monitoring?type=alerts");
      if (alertsRes.ok) {
        const data = await alertsRes.json();
        setAlerts(data);
      }

      // Fetch rate limits
      const rateRes = await fetch("/api/admin/monitoring?type=rate-limits");
      if (rateRes.ok) {
        const data = await rateRes.json();
        setRateLimits(data);
      }

      // Fetch NSE logs
      const nseRes = await fetch("/api/admin/monitoring?type=nse-logs");
      if (nseRes.ok) {
        const data = await nseRes.json();
        setNseLogs(data);
      }
    } catch (error) {
      console.error("Failed to fetch monitoring data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (action: string, identifier?: string, alertId?: string) => {
    try {
      const res = await fetch("/api/admin/monitoring", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, identifier, alertId })
      });
      
      if (res.ok) {
        fetchData();
      }
    } catch (error) {
      console.error("Action failed:", error);
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (status === "unauthenticated" || session?.user?.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Access Denied</h2>
          <p className="text-gray-600 dark:text-gray-400">Please sign in as an admin to view this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">API Monitoring</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Track API usage, NSE calls, and security anomalies
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={hours}
              onChange={(e) => setHours(parseInt(e.target.value))}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            >
              <option value={1}>Last 1 hour</option>
              <option value={6}>Last 6 hours</option>
              <option value={24}>Last 24 hours</option>
              <option value={72}>Last 3 days</option>
            </select>
            <button
              onClick={fetchData}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-gray-200 dark:border-slate-800">
          {(["overview", "nse-logs", "anomalies", "rate-limits"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab === "nse-logs" ? "NSE Logs" : 
               tab === "rate-limits" ? "Rate Limits" : 
               tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-white dark:bg-slate-900 rounded-lg p-6 animate-pulse">
                <div className="h-4 bg-gray-200 dark:bg-slate-800 rounded w-1/3 mb-4"></div>
                <div className="h-3 bg-gray-200 dark:bg-slate-800 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Overview Tab */}
            {activeTab === "overview" && stats && (
              <div className="space-y-6">
                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-gray-200 dark:border-slate-800">
                    <div className="text-3xl font-bold text-gray-900 dark:text-white">{stats.totalRequests.toLocaleString()}</div>
                    <div className="text-sm text-gray-500">Total API Requests</div>
                  </div>
                  <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-gray-200 dark:border-slate-800">
                    <div className="text-3xl font-bold text-blue-600">{stats.nseRequests.toLocaleString()}</div>
                    <div className="text-sm text-gray-500">NSE API Calls</div>
                  </div>
                  <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-gray-200 dark:border-slate-800">
                    <div className="text-3xl font-bold text-yellow-600">{stats.rateLimited.toLocaleString()}</div>
                    <div className="text-sm text-gray-500">Rate Limited</div>
                  </div>
                  <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-gray-200 dark:border-slate-800">
                    <div className="text-3xl font-bold text-red-600">{stats.anomalies}</div>
                    <div className="text-sm text-gray-500">Active Anomalies</div>
                  </div>
                </div>

                {/* Top Endpoints and IPs */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-gray-200 dark:border-slate-800">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Top Endpoints</h3>
                    <div className="space-y-3">
                      {stats.topEndpoints.map((ep, i) => (
                        <div key={i} className="flex justify-between items-center">
                          <span className="text-sm text-gray-600 dark:text-gray-400 truncate max-w-[200px]">{ep.path}</span>
                          <span className="text-sm font-medium text-gray-900 dark:text-white">{ep.count.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-gray-200 dark:border-slate-800">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Top IPs</h3>
                    <div className="space-y-3">
                      {stats.topIPs.map((item, i) => (
                        <div key={i} className="flex justify-between items-center">
                          <span className="text-sm text-gray-600 dark:text-gray-400 font-mono">{item.ip}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900 dark:text-white">{item.count.toLocaleString()}</span>
                            {item.count > 1000 && (
                              <button
                                onClick={() => handleAction("block", item.ip)}
                                className="text-xs px-2 py-1 bg-red-100 text-red-800 rounded hover:bg-red-200"
                              >
                                Block
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Recent Alerts */}
                <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-gray-200 dark:border-slate-800">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Recent Anomalies</h3>
                  <div className="space-y-3">
                    {alerts.length === 0 ? (
                      <p className="text-gray-500">No anomalies detected</p>
                    ) : (
                      alerts.slice(0, 5).map((alert) => (
                        <div key={alert.id} className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-slate-800 rounded-lg">
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${SEVERITY_COLORS[alert.severity]}`}>
                            {alert.severity}
                          </span>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900 dark:text-white">{alert.title}</p>
                            <p className="text-xs text-gray-500">{alert.description}</p>
                          </div>
                          <span className="text-xs text-gray-400">
                            {new Date(alert.createdAt).toLocaleString()}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* NSE Logs Tab */}
            {activeTab === "nse-logs" && (
              <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-slate-800">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Time</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Endpoint</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Method</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Response Time</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">IP</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Rate Limited</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {nseLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                          <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                            {new Date(log.createdAt).toLocaleString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-900 dark:text-white font-mono">
                            {log.path}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 py-1 text-xs font-medium rounded ${
                              log.method === 'GET' ? 'bg-green-100 text-green-800' :
                              log.method === 'POST' ? 'bg-blue-100 text-blue-800' :
                              'bg-yellow-100 text-yellow-800'
                            }`}>
                              {log.method}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 py-1 text-xs font-medium rounded ${
                              log.statusCode < 300 ? 'bg-green-100 text-green-800' :
                              log.statusCode < 400 ? 'bg-yellow-100 text-yellow-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {log.statusCode}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                            {log.responseTime}ms
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500 font-mono">
                            {log.ipAddress}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {log.isRateLimited ? (
                              <span className="px-2 py-1 text-xs font-medium rounded bg-red-100 text-red-800">Yes</span>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Anomalies Tab */}
            {activeTab === "anomalies" && (
              <div className="space-y-4">
                {alerts.length === 0 ? (
                  <div className="bg-white dark:bg-slate-900 rounded-lg p-12 text-center">
                    <svg className="w-16 h-16 text-green-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-gray-500 dark:text-gray-400">No anomalies detected</p>
                  </div>
                ) : (
                  alerts.map((alert) => (
                    <div key={alert.id} className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-gray-200 dark:border-slate-800">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${SEVERITY_COLORS[alert.severity]}`}>
                            {alert.severity}
                          </span>
                          <div>
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{alert.title}</h3>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{alert.description}</p>
                            <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                              {alert.identifier && (
                                <span>Identifier: <code className="bg-gray-100 dark:bg-slate-800 px-1 rounded">{alert.identifier}</code></span>
                              )}
                              {alert.endpoint && (
                                <span>Endpoint: <code className="bg-gray-100 dark:bg-slate-800 px-1 rounded">{alert.endpoint}</code></span>
                              )}
                              <span>{new Date(alert.createdAt).toLocaleString()}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {alert.identifier && (
                            <button
                              onClick={() => handleAction("block", alert.identifier!)}
                              className="px-3 py-1 text-sm bg-red-100 text-red-800 rounded hover:bg-red-200"
                            >
                              Block IP
                            </button>
                          )}
                          <button
                            onClick={() => handleAction("resolve-alert", undefined, alert.id)}
                            className="px-3 py-1 text-sm bg-green-100 text-green-800 rounded hover:bg-green-200"
                          >
                            Resolve
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Rate Limits Tab */}
            {activeTab === "rate-limits" && (
              <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-slate-800">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Identifier</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Usage</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Last Updated</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {rateLimits.map((config) => (
                        <tr key={config.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white font-mono">
                            {config.identifier}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {config.identifierType}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <div className="w-24 bg-gray-200 dark:bg-slate-700 rounded-full h-2">
                                <div 
                                  className={`h-2 rounded-full ${config.currentCount / config.limit > 0.8 ? 'bg-red-500' : 'bg-blue-500'}`}
                                  style={{ width: `${Math.min(100, (config.currentCount / config.limit) * 100)}%` }}
                                ></div>
                              </div>
                              <span className="text-xs text-gray-500">
                                {config.currentCount}/{config.limit}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {config.isBlocked ? (
                              <span className="px-2 py-1 text-xs font-medium rounded bg-red-100 text-red-800">Blocked</span>
                            ) : (
                              <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800">Active</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                            {new Date(config.updatedAt).toLocaleString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {config.isBlocked ? (
                              <button
                                onClick={() => handleAction("unblock", config.identifier)}
                                className="text-sm text-blue-600 hover:text-blue-800"
                              >
                                Unblock
                              </button>
                            ) : (
                              <button
                                onClick={() => handleAction("block", config.identifier)}
                                className="text-sm text-red-600 hover:text-red-800"
                              >
                                Block
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
