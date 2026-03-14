"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";

interface WorkerTask {
  id: string;
  name: string;
  taskType: string;
  taskCategory: string;
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
  cronJobId: string | null;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  running: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-800",
};

const TASK_TYPE_LABELS: Record<string, { label: string; description: string }> = {
  // Cron tasks
  stock_sync: { label: "Stock Sync", description: "Sync stocks from NSE" },
  corp_actions: { label: "Corporate Actions", description: "Sync corporate actions" },
  alert_check: { label: "Alert Check", description: "Check user alerts" },
  screener: { label: "Screener", description: "Run stock screener" },
  recommendations: { label: "Recommendations", description: "Generate recommendations" },
  market_data: { label: "Market Data", description: "Sync market data" },
  // Async tasks
  csv_processing: { label: "CSV Processing", description: "Process uploaded CSV files" },
  historical_sync: { label: "Historical Sync", description: "Sync historical data from NSE" },
  data_sync: { label: "Data Sync", description: "Sync data from external sources" },
  // Regular tasks
  cleanup: { label: "Cleanup", description: "Clean old data" },
  password_reset: { label: "Password Reset", description: "Handle password reset requests" },
  user_query: { label: "User Query", description: "Respond to user queries" },
  maintenance: { label: "Maintenance", description: "System maintenance tasks" },
};

const CATEGORY_INFO = {
  cron: { label: "Cron Tasks", description: "Scheduled tasks from cron configuration", color: "blue" },
  async: { label: "Async Tasks", description: "Long-running background tasks (CSV, sync)", color: "purple" },
  regular: { label: "Regular Tasks", description: "Manual tasks, queries, maintenance", color: "gray" },
};

export default function TasksPage() {
  const { data: session, status } = useSession();
  const [tasks, setTasks] = useState<WorkerTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<"cron" | "async" | "regular">("regular");
  const [filter, setFilter] = useState<"all" | "pending" | "running" | "completed" | "failed">("all");
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    taskType: "cleanup",
    priority: 5,
    maxRetries: 3,
    payload: {},
  });

  useEffect(() => {
    if (status === "authenticated") {
      fetchTasks();
    }
  }, [status, activeCategory, filter]);

  const fetchTasks = async () => {
    try {
      setLoading(true);
      const statusParam = filter === "all" ? "" : filter;
      const res = await fetch(`/api/admin/workers?taskCategory=${activeCategory}&status=${statusParam}&limit=100`);
      
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
      }
    } catch (error) {
      console.error("Failed to fetch tasks:", error);
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
        body: JSON.stringify({
          ...formData,
          taskCategory: activeCategory,
        }),
      });

      if (res.ok) {
        fetchTasks();
        setShowModal(false);
        setFormData({
          name: "",
          taskType: "cleanup",
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
      fetchTasks();
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
      fetchTasks();
    } catch (error) {
      console.error("Failed to cancel task:", error);
    }
  };

  const handleRerun = async (task: WorkerTask) => {
    try {
      await fetch("/api/admin/workers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Re-run: ${task.name}`,
          taskType: task.taskType,
          taskCategory: task.taskCategory,
          priority: task.priority,
          maxRetries: task.maxRetries,
          payload: task.payload,
        }),
      });
      fetchTasks();
    } catch (error) {
      console.error("Failed to rerun task:", error);
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

  const getTaskTypeInfo = (taskType: string) => {
    return TASK_TYPE_LABELS[taskType] || { label: taskType, description: "" };
  };

  // Get available task types for current category
  const getAvailableTaskTypes = () => {
    switch (activeCategory) {
      case "cron":
        return ["stock_sync", "corp_actions", "alert_check", "screener", "recommendations", "market_data"];
      case "async":
        return ["csv_processing", "historical_sync", "data_sync"];
      case "regular":
        return ["cleanup", "password_reset", "user_query", "maintenance"];
      default:
        return Object.keys(TASK_TYPE_LABELS);
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
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Task Manager</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Manage all tasks: cron jobs, async processing, and regular operations
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
          >
            Create Task
          </button>
        </div>

        {/* Category Tabs */}
        <div className="flex gap-2 mb-6 border-b border-gray-200 dark:border-slate-800">
          {(["cron", "async", "regular"] as const).map((category) => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeCategory === category
                  ? `border-${CATEGORY_INFO[category].color}-600 text-${CATEGORY_INFO[category].color}-600`
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {CATEGORY_INFO[category].label}
            </button>
          ))}
        </div>

        {/* Description for active category */}
        <div className="mb-6 p-4 bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {CATEGORY_INFO[activeCategory].description}
          </p>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex gap-2 mb-6">
          {(["all", "pending", "running", "completed", "failed"] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                filter === status
                  ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                  : "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-gray-400 hover:bg-gray-200"
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
              {status !== "all" && ` (${tasks.filter(t => filter === "all" || t.status === filter).length})`}
            </button>
          ))}
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
            <p className="text-gray-500 dark:text-gray-400 mb-4">No {activeCategory} tasks found</p>
            <button
              onClick={() => setShowModal(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
            >
              Create First Task
            </button>
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
                      {getTaskTypeInfo(task.taskType).label}
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
                    <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                      {task.status === "pending" && (
                        <button
                          onClick={() => handleCancel(task.id)}
                          className="text-yellow-600 hover:text-yellow-800"
                        >
                          Cancel
                        </button>
                      )}
                      {(task.status === "completed" || task.status === "failed") && (
                        <button
                          onClick={() => handleRerun(task)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          Re-run
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Create Task Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex min-h-screen items-center justify-center p-4">
              <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setShowModal(false)}></div>
              <div className="relative bg-white dark:bg-slate-900 rounded-lg shadow-xl max-w-lg w-full">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Create {CATEGORY_INFO[activeCategory].label.slice(0, -1)} Task
                  </h3>
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
                        placeholder="e.g., Daily Stock Sync"
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
                        {getAvailableTaskTypes().map((type) => (
                          <option key={type} value={type}>
                            {TASK_TYPE_LABELS[type]?.label || type} - {TASK_TYPE_LABELS[type]?.description}
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
