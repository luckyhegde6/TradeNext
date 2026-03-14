"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { 
  DocumentTextIcon, 
  TrashIcon, 
  ArrowDownTrayIcon,
  FolderIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon
} from "@heroicons/react/24/outline";

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
  const [activeTab, setActiveTab] = useState<"overview" | "nse-logs" | "nse-calls" | "http-logs" | "server-logs" | "anomalies" | "rate-limits">("overview");
  const [stats, setStats] = useState<APIStats | null>(null);
  const [httpStats, setHttpStats] = useState<any>(null);
  const [alerts, setAlerts] = useState<AnomalyAlert[]>([]);
  const [rateLimits, setRateLimits] = useState<RateLimitConfig[]>([]);
  const [nseLogs, setNseLogs] = useState<any[]>([]);
  const [nseCalls, setNseCalls] = useState<any[]>([]);
  const [httpLogs, setHttpLogs] = useState<any[]>([]);
  const [serverLogs, setServerLogs] = useState<{ date: string; path: string; size: number }[]>([]);
  const [selectedLogFile, setSelectedLogFile] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
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

      // Fetch NSE API calls (in-memory)
      const nseCallsRes = await fetch("/api/admin/monitoring?type=nse-calls");
      if (nseCallsRes.ok) {
        const data = await nseCallsRes.json();
        setNseCalls(data);
      }

      // Fetch HTTP request logs (in-memory)
      const httpLogsRes = await fetch("/api/admin/monitoring?type=http-logs&limit=100");
      if (httpLogsRes.ok) {
        const data = await httpLogsRes.json();
        setHttpLogs(data);
      }

      // Fetch HTTP stats
      const httpStatsRes = await fetch("/api/admin/monitoring?type=http-stats");
      if (httpStatsRes.ok) {
        const data = await httpStatsRes.json();
        setHttpStats(data);
      }

      // Fetch server log files
      const logsRes = await fetch("/api/admin/monitoring?type=server-logs&action=list");
      if (logsRes.ok) {
        const data = await logsRes.json();
        setServerLogs(data.files || []);
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
        <div className="flex gap-2 mb-6 border-b border-gray-200 dark:border-slate-800 overflow-x-auto">
          {(["overview", "nse-logs", "nse-calls", "http-logs", "server-logs", "anomalies", "rate-limits"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              {tab === "nse-logs" ? "NSE DB Logs" : 
               tab === "nse-calls" ? "NSE API Calls" : 
               tab === "http-logs" ? "HTTP Logs" :
               tab === "server-logs" ? "Server Logs" :
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
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
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
                  {httpStats && (
                    <div className={`rounded-lg p-6 border ${
                      (httpStats.statusCodes?.['401'] || 0) > 0 
                        ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' 
                        : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800'
                    }`}>
                      <div className={`text-3xl font-bold ${
                        (httpStats.statusCodes?.['401'] || 0) > 0 
                          ? 'text-red-600 dark:text-red-400' 
                          : 'text-gray-900 dark:text-white'
                      }`}>
                        {(httpStats.statusCodes?.['401'] || 0) + (httpStats.statusCodes?.['403'] || 0)}
                      </div>
                      <div className="text-sm text-gray-500">Unauthorized (401/403)</div>
                    </div>
                  )}
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

                {/* HTTP Stats Section */}
                {httpStats && httpStats.totalRequests > 0 && (
                  <div className="space-y-6">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">HTTP Performance</h2>
                    
                    {/* Latency & Throughput Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-gray-200 dark:border-slate-800">
                        <div className="text-2xl font-bold text-gray-900 dark:text-white">{httpStats.totalRequests}</div>
                        <div className="text-sm text-gray-500">Total Requests</div>
                      </div>
                      <div className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-gray-200 dark:border-slate-800">
                        <div className="text-2xl font-bold text-green-600">{httpStats.throughput?.rpm || 0}</div>
                        <div className="text-sm text-gray-500">Req/min (1m)</div>
                      </div>
                      <div className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-gray-200 dark:border-slate-800">
                        <div className="text-2xl font-bold text-blue-600">{httpStats.latency?.avg || 0}ms</div>
                        <div className="text-sm text-gray-500">Avg Latency</div>
                      </div>
                      <div className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-gray-200 dark:border-slate-800">
                        <div className={`text-2xl font-bold ${httpStats.errorRate > 5 ? 'text-red-600' : 'text-green-600'}`}>
                          {httpStats.errorRate}%
                        </div>
                        <div className="text-sm text-gray-500">Error Rate</div>
                      </div>
                    </div>

                    {/* Latency Percentiles */}
                    <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-gray-200 dark:border-slate-800">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Latency Percentiles</h3>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        <div className="text-center">
                          <div className="text-xl font-bold text-gray-900 dark:text-white">{httpStats.latency?.min || 0}ms</div>
                          <div className="text-xs text-gray-500">Min</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xl font-bold text-gray-900 dark:text-white">{httpStats.latency?.p50 || 0}ms</div>
                          <div className="text-xs text-gray-500">P50</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xl font-bold text-gray-900 dark:text-white">{httpStats.latency?.p90 || 0}ms</div>
                          <div className="text-xs text-gray-500">P90</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xl font-bold text-gray-900 dark:text-white">{httpStats.latency?.p95 || 0}ms</div>
                          <div className="text-xs text-gray-500">P95</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xl font-bold text-gray-900 dark:text-white">{httpStats.latency?.p99 || 0}ms</div>
                          <div className="text-xs text-gray-500">P99</div>
                        </div>
                      </div>
                    </div>

                    {/* Status Codes & Methods */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Status Codes */}
                      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-gray-200 dark:border-slate-800">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Status Codes</h3>
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <span className="w-16 text-sm text-gray-500">2xx:</span>
                            <div className="flex-1 bg-gray-200 dark:bg-slate-700 rounded-full h-4 overflow-hidden">
                              <div 
                                className="bg-green-500 h-full rounded-full" 
                                style={{ width: `${((httpStats.statusRanges?.['2xx'] || 0) / httpStats.totalRequests) * 100}%` }}
                              />
                            </div>
                            <span className="w-16 text-sm text-right text-gray-900 dark:text-white">{httpStats.statusRanges?.['2xx'] || 0}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-16 text-sm text-gray-500">3xx:</span>
                            <div className="flex-1 bg-gray-200 dark:bg-slate-700 rounded-full h-4 overflow-hidden">
                              <div 
                                className="bg-yellow-500 h-full rounded-full" 
                                style={{ width: `${((httpStats.statusRanges?.['3xx'] || 0) / httpStats.totalRequests) * 100}%` }}
                              />
                            </div>
                            <span className="w-16 text-sm text-right text-gray-900 dark:text-white">{httpStats.statusRanges?.['3xx'] || 0}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-16 text-sm text-gray-500">4xx:</span>
                            <div className="flex-1 bg-gray-200 dark:bg-slate-700 rounded-full h-4 overflow-hidden">
                              <div 
                                className="bg-orange-500 h-full rounded-full" 
                                style={{ width: `${((httpStats.statusRanges?.['4xx'] || 0) / httpStats.totalRequests) * 100}%` }}
                              />
                            </div>
                            <span className="w-16 text-sm text-right text-gray-900 dark:text-white">{httpStats.statusRanges?.['4xx'] || 0}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-16 text-sm text-gray-500">5xx:</span>
                            <div className="flex-1 bg-gray-200 dark:bg-slate-700 rounded-full h-4 overflow-hidden">
                              <div 
                                className="bg-red-500 h-full rounded-full" 
                                style={{ width: `${((httpStats.statusRanges?.['5xx'] || 0) / httpStats.totalRequests) * 100}%` }}
                              />
                            </div>
                            <span className="w-16 text-sm text-right text-gray-900 dark:text-white">{httpStats.statusRanges?.['5xx'] || 0}</span>
                          </div>
                        </div>
                      </div>

                      {/* Methods */}
                      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-gray-200 dark:border-slate-800">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Methods</h3>
                        <div className="space-y-2">
                          {Object.entries(httpStats.methods || {}).map(([method, count]) => (
                            <div key={method} className="flex items-center justify-between">
                              <span className={`px-2 py-1 text-xs font-medium rounded ${
                                method === 'GET' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                                method === 'POST' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                                method === 'PUT' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                                method === 'DELETE' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                                'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
                              }`}>{method}</span>
                              <span className="text-sm font-medium text-gray-900 dark:text-white">{count as number}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Top Endpoints */}
                    <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-gray-200 dark:border-slate-800">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Top Endpoints</h3>
                      <div className="space-y-2">
                        {(httpStats.topEndpoints || []).slice(0, 8).map((ep: any, i: number) => (
                          <div key={i} className="flex items-center justify-between">
                            <span className="text-sm text-gray-600 dark:text-gray-400 font-mono truncate max-w-md">{ep.path}</span>
                            <span className="text-sm font-medium text-gray-900 dark:text-white">{ep.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
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

            {/* NSE API Calls Tab - In-memory tracking */}
            {activeTab === "nse-calls" && (
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
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {nseCalls.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                            No NSE API calls recorded yet
                          </td>
                        </tr>
                      ) : (
                        nseCalls.map((call, idx) => (
                          <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                            <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                              {new Date(call.timestamp).toLocaleString()}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-900 dark:text-white font-mono">
                              {call.endpoint}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 py-1 text-xs font-medium rounded ${
                                call.method === 'GET' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                                call.method === 'POST' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                                'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                              }`}>
                                {call.method}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {call.status === 'success' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                  <CheckCircleIcon className="w-3 h-3" /> Success
                                </span>
                              ) : call.status === 'error' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                                  <XCircleIcon className="w-3 h-3" /> Error
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                                  <ClockIcon className="w-3 h-3" /> Pending
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                              {call.responseTime ? `${call.responseTime}ms` : '-'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* HTTP Logs Tab - In-memory tracking */}
            {activeTab === "http-logs" && (
              <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-slate-800">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Time</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Method</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">URL</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Response Time</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">IP</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {httpLogs.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                            No HTTP requests logged yet
                          </td>
                        </tr>
                      ) : (
                        httpLogs.map((log, idx) => {
                          // Check if this is an unauthorized access (401)
                          const isUnauthorized = log.status === 401;
                          const isAuthError = log.status === 401 || log.status === 403;
                          
                          return (
                            <tr 
                              key={idx} 
                              className={`hover:bg-gray-50 dark:hover:bg-slate-800/50 ${
                                isUnauthorized ? 'bg-red-50 dark:bg-red-900/20' : ''
                              }`}
                            >
                              <td className={`px-6 py-4 whitespace-nowrap text-xs ${isUnauthorized ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-500'}`}>
                                {new Date(log.timestamp).toLocaleString()}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className={`px-2 py-1 text-xs font-medium rounded ${
                                  log.method === 'GET' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                                  log.method === 'POST' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                                  log.method === 'PUT' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                                  log.method === 'DELETE' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                                  'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
                                }`}>
                                  {log.method}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-900 dark:text-white font-mono max-w-xs truncate">
                                {log.url}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                {isUnauthorized ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-bold rounded bg-red-600 text-white animate-pulse">
                                    401 Unauthorized
                                  </span>
                                ) : log.status === 403 ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-bold rounded bg-orange-600 text-white">
                                    403 Forbidden
                                  </span>
                                ) : (
                                  <span className={`px-2 py-1 text-xs font-medium rounded ${
                                    log.status >= 200 && log.status < 300 ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                                    log.status >= 300 && log.status < 400 ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                                    log.status >= 400 && log.status < 500 ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400' :
                                    log.status >= 500 ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                                    'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
                                  }`}>
                                    {log.status}
                                  </span>
                                )}
                              </td>
                              <td className={`px-6 py-4 whitespace-nowrap text-xs ${isAuthError ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-500'}`}>
                                {log.responseTime ? `${log.responseTime}ms` : '-'}
                              </td>
                              <td className={`px-6 py-4 whitespace-nowrap text-xs font-mono ${isAuthError ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-500'}`}>
                                {log.ip || '-'}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Server Logs Tab */}
            {activeTab === "server-logs" && (
              <div className="space-y-4">
                <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Server Log Files</h3>
                    <button
                      onClick={() => {
                        setSelectedLogFile(null);
                        setLogLines([]);
                        fetchData();
                      }}
                      className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2"
                    >
                      <FolderIcon className="w-4 h-4" />
                      Refresh
                    </button>
                  </div>
                  
                  {/* Log Files List */}
                  {!selectedLogFile ? (
                    <div className="space-y-2">
                      {serverLogs.length === 0 ? (
                        <p className="text-gray-500 text-center py-8">No log files found</p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {serverLogs.map((file) => (
                            <div 
                              key={file.path} 
                              className="flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700"
                            >
                              <div className="flex items-center gap-3">
                                <DocumentTextIcon className="w-5 h-5 text-blue-500" />
                                <div>
                                  <p className="text-sm font-medium text-gray-900 dark:text-white">{file.date}</p>
                                  <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={async () => {
                                    setSelectedLogFile(file.path);
                                    const res = await fetch(`/api/admin/monitoring?type=server-logs&filePath=${encodeURIComponent(file.path)}&limit=500`);
                                    if (res.ok) {
                                      const data = await res.json();
                                      setLogLines(data.lines || []);
                                    }
                                  }}
                                  className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
                                  title="View"
                                >
                                  <DocumentTextIcon className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={async () => {
                                    if (confirm(`Delete log file for ${file.date}?`)) {
                                      const res = await fetch(`/api/admin/monitoring?type=server-logs&filePath=${encodeURIComponent(file.path)}`, { method: 'DELETE' });
                                      if (res.ok) {
                                        fetchData();
                                      }
                                    }
                                  }}
                                  className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                                  title="Delete"
                                >
                                  <TrashIcon className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Log File Content */
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <button
                          onClick={() => {
                            setSelectedLogFile(null);
                            setLogLines([]);
                          }}
                          className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                        >
                          ← Back to files
                        </button>
                        <button
                          onClick={() => {
                            const content = logLines.join('\n');
                            const blob = new Blob([content], { type: 'text/plain' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `server-log-${selectedLogFile.split('/').pop()}`;
                            a.click();
                            URL.revokeObjectURL(url);
                          }}
                          className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center gap-2"
                        >
                          <ArrowDownTrayIcon className="w-4 h-4" />
                          Export
                        </button>
                      </div>
                      
                      <div className="bg-gray-900 dark:bg-black rounded-lg p-4 max-h-[500px] overflow-auto">
                        <pre className="text-xs font-mono text-green-400 whitespace-pre-wrap">
                          {logLines.length === 0 ? 'No log entries' : logLines.map(line => {
                            try {
                              const entry = JSON.parse(line);
                              const level = entry.level?.toUpperCase() || 'INFO';
                              const color = 
                                level === 'ERROR' ? 'text-red-400' :
                                level === 'WARN' ? 'text-yellow-400' :
                                level === 'DEBUG' ? 'text-blue-400' :
                                'text-green-400';
                              return `[${entry.timestamp}] \x1b[1m${level}\x1b[0m ${color ? '' : ''}${typeof entry.message === 'string' ? entry.message : JSON.stringify(entry.message)}`;
                            } catch {
                              return line;
                            }
                          }).join('\n')}
                        </pre>
                      </div>
                    </div>
                  )}
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
