"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

interface WorkerTask {
  id: string;
  name: string;
  taskType: string;
  status: string;
  priority: number;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  retryCount: number;
  maxRetries: number;
  assignedTo: string | null;
  createdAt: string;
}

interface WorkerStatus {
  workerId: string;
  workerName: string | null;
  status: string;
  currentTaskId: string | null;
  tasksCompleted: number;
  tasksFailed: number;
  lastHeartbeat: string;
  cpuUsage: number | null;
  memoryUsage: number | null;
}

const TASK_TYPES = [
  { value: "alert_check", label: "Alert Check", description: "Check user alerts against prices" },
  { value: "screener", label: "Screener", description: "Run stock screener filters" },
  { value: "recommendations", label: "Recommendations", description: "Generate recommendations" },
  { value: "data_sync", label: "Data Sync", description: "Sync data from external sources" },
  { value: "stock_sync", label: "Stock Sync", description: "Sync stock data from NSE" },
  { value: "corp_actions_fetch", label: "Corp Actions Fetch", description: "Fetch corporate actions from NSE" },
  { value: "events_fetch", label: "Events Fetch", description: "Fetch market events from NSE" },
  { value: "news_fetch", label: "News Fetch", description: "Fetch market news" },
  { value: "market_data_fetch", label: "Market Data Fetch", description: "Fetch live quotes and market data" },
  { value: "announcement_fetch", label: "Announcement Fetch", description: "Fetch corporate announcements" },
  { value: "screener_sync", label: "Screener Sync", description: "Daily TradingView snapshot" },
  { value: "cleanup", label: "Cleanup", description: "Clean old data" },
];

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  running: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-800",
};

export default function WorkersPage() {
  const { data: session, status } = useSession();
  const [tasks, setTasks] = useState<WorkerTask[]>([]);
  const [workers, setWorkers] = useState<WorkerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "running" | "completed" | "failed">("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | "cron" | "async" | "regular">("all");
  const [activeTab, setActiveTab] = useState<"tasks" | "workers" | "logs">("tasks");

  // Logs state
  const [logFiles, setLogFiles] = useState<{ taskId: string; path: string; size: number; created: Date }[]>([]);
  const [selectedLog, setSelectedLog] = useState<{ taskId: string; content: string } | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    taskType: "alert_check",
    priority: 5,
    maxRetries: 3,
    payload: {},
  });

  const [engineStatus, setEngineStatus] = useState({ isRunning: false, loading: false });

  useEffect(() => {
    if (status === "authenticated") {
      fetchData();
      checkEngineStatus();
      if (activeTab === "logs") {
        fetchLogs();
      }
      const interval = setInterval(() => {
        fetchData();
        if (activeTab === "logs") {
          fetchLogs();
        }
      }, 10000); // Refresh every 10 seconds
      return () => clearInterval(interval);
    }
  }, [status, filter, activeTab]);

  const checkEngineStatus = async () => {
    try {
      const res = await fetch("/api/admin/workers/engine");
      if (res.ok) {
        const data = await res.json();
        setEngineStatus(prev => ({ ...prev, isRunning: data.isRunning }));
      }
    } catch (error) {
      console.error("Failed to check engine status:", error);
    }
  };

  const handleToggleEngine = async () => {
    setEngineStatus(prev => ({ ...prev, loading: true }));
    try {
      const action = engineStatus.isRunning ? "stop" : "start";
      const res = await fetch("/api/admin/workers/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (res.ok) {
        setEngineStatus(prev => ({ ...prev, isRunning: !prev.isRunning }));
      }
    } catch (error) {
      console.error("Failed to toggle engine:", error);
    } finally {
      setEngineStatus(prev => ({ ...prev, loading: false }));
    }
  };

  const fetchLogs = async () => {
    try {
      setLoadingLogs(true);
      const res = await fetch("/api/admin/workers/logs");
      if (res.ok) {
        const data = await res.json();
        setLogFiles(data.files || []);
      }
    } catch (error) {
      console.error("Failed to fetch logs:", error);
    } finally {
      setLoadingLogs(false);
    }
  };

  const fetchLogContent = async (taskId: string) => {
    try {
      const res = await fetch(`/api/admin/workers/logs?taskId=${taskId}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedLog({ taskId, content: data.content });
      }
    } catch (error) {
      console.error("Failed to fetch log content:", error);
    }
  };

  const handleDeleteLog = async (taskId: string) => {
    if (!confirm("Are you sure you want to delete this log?")) return;
    try {
      await fetch(`/api/admin/workers/logs?taskId=${taskId}`, { method: "DELETE" });
      fetchLogs();
      if (selectedLog?.taskId === taskId) {
        setSelectedLog(null);
      }
    } catch (error) {
      console.error("Failed to delete log:", error);
    }
  };

  const fetchData = async () => {
    try {
      const statusParam = filter === "all" ? "" : filter;
      const categoryParam = categoryFilter === "all" ? "" : categoryFilter;
      const [tasksRes, workersRes] = await Promise.all([
        fetch(`/api/admin/workers?status=${statusParam}&taskCategory=${categoryParam}&limit=50`),
        fetch("/api/admin/workers/status"),
      ]);

      if (tasksRes.ok) {
        const tasksData = await tasksRes.json();
        setTasks(tasksData.tasks || tasksData);
      }

      if (workersRes.ok) {
        const workersData = await workersRes.json();
        setWorkers(workersData);
      }
    } catch (error) {
      console.error("Failed to fetch data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const res = await fetch("/api/admin/workers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        fetchData();
        setShowModal(false);
        setFormData({
          name: "",
          taskType: "alert_check",
          priority: 5,
          maxRetries: 3,
          payload: {},
        });
      }
    } catch (error) {
      console.error("Failed to create task:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this task?")) return;

    try {
      await fetch(`/api/admin/workers?id=${id}`, { method: "DELETE" });
      fetchData();
    } catch (error) {
      console.error("Failed to delete task:", error);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await fetch(`/api/admin/workers?id=${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      fetchData();
    } catch (error) {
      console.error("Failed to cancel task:", error);
    }
  };

  const getStatusIcon = (taskStatus: string) => {
    switch (taskStatus) {
      case "pending":
        return <span className="text-yellow-500">⏳</span>;
      case "running":
        return <span className="animate-spin text-blue-500">⟳</span>;
      case "completed":
        return <span className="text-green-500">✓</span>;
      case "failed":
        return <span className="text-red-500">✗</span>;
      default:
        return <span className="text-gray-500">-</span>;
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
        {/* Cross-navigation bar */}
        <div className="flex items-center gap-2 mb-6 p-3 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800">
          <span className="text-xs font-bold text-gray-400 dark:text-slate-600 uppercase tracking-wider mr-2">Task System:</span>
          <Link href="/admin/utils/cron" className="px-3 py-1.5 text-xs font-bold text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors">⏰ Cron Config</Link>
          <Link href="/admin/utils/tasks" className="px-3 py-1.5 text-xs font-bold text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors">📋 Tasks</Link>
          <span className="px-3 py-1.5 text-xs font-bold bg-blue-600 text-white rounded-lg">⚙️ Workers</span>
        </div>

        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Background Workers</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Monitor and manage async task queue
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleToggleEngine}
              disabled={engineStatus.loading}
              className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-all shadow-sm ${engineStatus.isRunning
                ? "bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"
                : "bg-green-50 text-green-600 border border-green-200 hover:bg-green-100"
                }`}
            >
              {engineStatus.loading ? (
                <span className="animate-spin text-sm px-4">⟳</span>
              ) : (
                <span>{engineStatus.isRunning ? "🛑 Stop Services" : "▶ Start Services"}</span>
              )}
            </button>
            <button
              onClick={() => setShowModal(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium shadow-sm transition-all active:scale-95"
            >
              Add Task
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-gray-200 dark:border-slate-800">
          <button
            onClick={() => setActiveTab("tasks")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "tasks"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
          >
            Tasks
          </button>
          <button
            onClick={() => setActiveTab("workers")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "workers"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
          >
            Workers
          </button>
          <button
            onClick={() => { setActiveTab("logs"); fetchLogs(); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "logs"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
          >
            Logs
          </button>
        </div>

        {/* Logs Tab Content */}
        {activeTab === "logs" && (
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Worker Logs</h2>

            {loadingLogs ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : logFiles.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400">No log files found</p>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Log files list */}
                <div>
                  <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Available Logs</h3>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {logFiles.map((file) => (
                      <div
                        key={file.taskId}
                        className={`p-3 rounded-lg border cursor-pointer ${selectedLog?.taskId === file.taskId
                          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                          : "border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800"
                          }`}
                        onClick={() => fetchLogContent(file.taskId)}
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-medium text-gray-900 dark:text-white">{file.taskId}</div>
                            <div className="text-xs text-gray-500">
                              {(file.size / 1024).toFixed(2)} KB • {new Date(file.created).toLocaleString()}
                            </div>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteLog(file.taskId); }}
                            className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Log content viewer */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Log Content</h3>
                    {selectedLog && (
                      <button
                        onClick={() => {
                          const blob = new Blob([selectedLog.content], { type: "text/plain" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `${selectedLog.taskId}.log`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="px-3 py-1 text-sm bg-green-600 hover:bg-green-700 text-white rounded"
                      >
                        Export
                      </button>
                    )}
                  </div>
                  <div className="bg-gray-900 dark:bg-black rounded-lg p-4 max-h-96 overflow-auto">
                    {selectedLog ? (
                      <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">
                        {selectedLog.content}
                      </pre>
                    ) : (
                      <p className="text-gray-500 text-sm">Select a log file to view its contents</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Worker Nodes - Show for tasks and workers tabs */}
        {(activeTab === "tasks" || activeTab === "workers") && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Active Workers</h2>
            {workers.length === 0 ? (
              <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-gray-200 dark:border-slate-800 text-center text-gray-500">
                No workers connected. Workers will appear here when they check in.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {workers.map((worker) => (
                  <div
                    key={worker.workerId}
                    className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-gray-200 dark:border-slate-800"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-gray-900 dark:text-white">
                        {worker.workerName || worker.workerId.slice(0, 8)}
                      </span>
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${worker.status === "idle" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
                        {worker.status}
                      </span>
                    </div>
                    <div className="text-sm text-gray-500">
                      <div>Completed: {worker.tasksCompleted}</div>
                      <div>Failed: {worker.tasksFailed}</div>
                      <div>Last heartbeat: {new Date(worker.lastHeartbeat).toLocaleTimeString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Category Filter */}
        <div className="flex gap-2 mb-6">
          {(["all", "cron", "async", "regular"] as const).map((category) => (
            <button
              key={category}
              onClick={() => setCategoryFilter(category)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${categoryFilter === category
                ? "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
                : "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-gray-400 hover:bg-gray-200"
                }`}
            >
              {category === "all" ? "All Categories" : category.charAt(0).toUpperCase() + category.slice(1)}
            </button>
          ))}
        </div>

        {/* Stats - Only show for tasks tab */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
          <button
            onClick={() => setFilter("all")}
            className={`bg-white dark:bg-slate-900 rounded-lg p-4 border ${filter === "all" ? "border-blue-500 ring-2 ring-blue-200" : "border-gray-200 dark:border-slate-800"}`}
          >
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{tasks.length}</div>
            <div className="text-sm text-gray-500">Total</div>
          </button>
          <button
            onClick={() => setFilter("pending")}
            className={`bg-white dark:bg-slate-900 rounded-lg p-4 border ${filter === "pending" ? "border-yellow-500 ring-2 ring-yellow-200" : "border-gray-200 dark:border-slate-800"}`}
          >
            <div className="text-2xl font-bold text-yellow-600">{tasks.filter((t) => t.status === "pending").length}</div>
            <div className="text-sm text-gray-500">Pending</div>
          </button>
          <button
            onClick={() => setFilter("running")}
            className={`bg-white dark:bg-slate-900 rounded-lg p-4 border ${filter === "running" ? "border-blue-500 ring-2 ring-blue-200" : "border-gray-200 dark:border-slate-800"}`}
          >
            <div className="text-2xl font-bold text-blue-600">{tasks.filter((t) => t.status === "running").length}</div>
            <div className="text-sm text-gray-500">Running</div>
          </button>
          <button
            onClick={() => setFilter("completed")}
            className={`bg-white dark:bg-slate-900 rounded-lg p-4 border ${filter === "completed" ? "border-green-500 ring-2 ring-green-200" : "border-gray-200 dark:border-slate-800"}`}
          >
            <div className="text-2xl font-bold text-green-600">{tasks.filter((t) => t.status === "completed").length}</div>
            <div className="text-sm text-gray-500">Completed</div>
          </button>
          <button
            onClick={() => setFilter("failed")}
            className={`bg-white dark:bg-slate-900 rounded-lg p-4 border ${filter === "failed" ? "border-red-500 ring-2 ring-red-200" : "border-gray-200 dark:border-slate-800"}`}
          >
            <div className="text-2xl font-bold text-red-600">{tasks.filter((t) => t.status === "failed").length}</div>
            <div className="text-sm text-gray-500">Failed</div>
          </button>
        </div>

        {/* Tasks List */}
        {loading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-white dark:bg-slate-900 rounded-lg p-6 animate-pulse">
                <div className="h-4 bg-gray-200 dark:bg-slate-800 rounded w-1/3 mb-4"></div>
                <div className="h-3 bg-gray-200 dark:bg-slate-800 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-lg p-12 text-center">
            <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-gray-500 dark:text-gray-400">No tasks in queue</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-slate-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Priority</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Retries</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Created</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {tasks.map((task) => (
                  <tr key={task.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[task.status]}`}>
                        {getStatusIcon(task.status)} {task.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white font-medium">
                      {task.name}
                      {task.error && (
                        <div className="text-xs text-red-500 truncate max-w-xs">{task.error}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {TASK_TYPES.find((t) => t.value === task.taskType)?.label || task.taskType}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {task.priority}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {task.retryCount}/{task.maxRetries}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(task.createdAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex items-center gap-2">
                        {task.status === "pending" && (
                          <button
                            onClick={() => handleCancel(task.id)}
                            className="text-yellow-600 hover:text-yellow-800"
                          >
                            Cancel
                          </button>
                        )}
                        {(task.status === "completed" || task.status === "failed" || task.status === "cancelled") && (
                          <button
                            onClick={() => handleDelete(task.id)}
                            className="text-red-600 hover:text-red-800"
                          >
                            Delete
                          </button>
                        )}
                        <Link
                          href={`/admin/utils/tasks?taskId=${task.id}`}
                          className="text-blue-600 hover:text-blue-700 font-medium hover:underline"
                        >
                          Detail →
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex min-h-screen items-center justify-center p-4">
              <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setShowModal(false)}></div>
              <div className="relative bg-white dark:bg-slate-900 rounded-lg shadow-xl max-w-lg w-full">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Create Task</h3>
                </div>
                <form onSubmit={handleSubmit}>
                  <div className="p-6 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Task Name
                      </label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        required
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                        placeholder="Alert Check Task"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Task Type
                      </label>
                      <select
                        value={formData.taskType}
                        onChange={(e) => setFormData({ ...formData, taskType: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                      >
                        {TASK_TYPES.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.label} - {type.description}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Priority (1-10)
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="10"
                          value={formData.priority}
                          onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Max Retries
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="10"
                          value={formData.maxRetries}
                          onChange={(e) => setFormData({ ...formData, maxRetries: parseInt(e.target.value) })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="px-6 py-4 border-t border-gray-200 dark:border-slate-800 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowModal(false)}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {saving ? "Creating..." : "Create Task"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
