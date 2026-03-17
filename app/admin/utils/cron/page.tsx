"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

interface CronJob {
  id: string;
  name: string;
  description: string | null;
  taskType: string;
  cronExpression: string;
  isActive: boolean;
  lastRun: string | null;
  nextRun: string | null;
  runCount: number;
  successCount: number;
  failureCount: number;
  config: Record<string, unknown> | null;
  createdAt: string;
}

const TASK_TYPES = [
  { value: "stock_sync", label: "Stock Sync", description: "Sync stocks from NSE" },
  { value: "corp_actions", label: "Corporate Actions", description: "Sync corporate actions" },
  { value: "alert_check", label: "Alert Check", description: "Check user alerts" },
  { value: "screener", label: "Screener", description: "Run stock screener" },
  { value: "recommendations", label: "Recommendations", description: "Generate recommendations" },
  { value: "market_data", label: "Market Data", description: "Sync market data" },
];

const CRON_PRESETS = [
  { label: "Every 5 minutes", value: "*/5 * * * *" },
  { label: "Every 15 minutes", value: "*/15 * * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Daily at 6 AM", value: "0 6 * * *" },
  { label: "Daily at 9 AM", value: "0 9 * * *" },
  { label: "Daily at 6 PM", value: "0 18 * * *" },
  { label: "Weekly (Monday)", value: "0 9 * * 1" },
  { label: "Monthly (1st)", value: "0 9 1 * *" },
];

export default function CronConfigPage() {
  const { data: session, status } = useSession();
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    taskType: "stock_sync",
    cronExpression: "0 6 * * *",
    isActive: true,
    config: {},
  });

  useEffect(() => {
    if (status === "authenticated") {
      fetchCronJobs();
    }
  }, [status]);

  const fetchCronJobs = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/cron");
      if (res.ok) {
        const data = await res.json();
        setCronJobs(data);
      }
    } catch (error) {
      console.error("Failed to fetch cron jobs:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const url = editingJob ? `/api/admin/cron?id=${editingJob.id}` : "/api/admin/cron";
      const method = editingJob ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        fetchCronJobs();
        setShowModal(false);
        resetForm();
      }
    } catch (error) {
      console.error("Failed to save cron job:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this cron job?")) return;

    try {
      await fetch(`/api/admin/cron?id=${id}`, { method: "DELETE" });
      fetchCronJobs();
    } catch (error) {
      console.error("Failed to delete cron job:", error);
    }
  };

  const handleToggle = async (job: CronJob) => {
    try {
      await fetch(`/api/admin/cron?id=${job.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !job.isActive }),
      });
      fetchCronJobs();
    } catch (error) {
      console.error("Failed to toggle cron job:", error);
    }
  };

  const handleRunNow = async (job: CronJob) => {
    if (!confirm(`Run "${job.name}" now?`)) return;

    try {
      const res = await fetch("/api/admin/workers/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cronJobId: job.id }),
      });
      if (res.ok) {
        const data = await res.json();
        fetchCronJobs();
        alert(`Task created: ${data.task.name}\nView it in Tasks → Cron tab`);
      } else {
        alert("Failed to trigger cron job");
      }
    } catch (error) {
      console.error("Failed to run cron job:", error);
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      taskType: "stock_sync",
      cronExpression: "0 6 * * *",
      isActive: true,
      config: {},
    });
    setEditingJob(null);
  };

  const openEdit = (job: CronJob) => {
    setEditingJob(job);
    setFormData({
      name: job.name,
      description: job.description || "",
      taskType: job.taskType,
      cronExpression: job.cronExpression,
      isActive: job.isActive,
      config: {},
    });
    setShowModal(true);
  };

  const getTaskTypeLabel = (type: string) => {
    return TASK_TYPES.find((t) => t.value === type)?.label || type;
  };

  const getCronDescription = (expression: string) => {
    const preset = CRON_PRESETS.find((p) => p.value === expression);
    return preset?.label || expression;
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
          <span className="px-3 py-1.5 text-xs font-bold bg-blue-600 text-white rounded-lg">⏰ Cron Config</span>
          <Link href="/admin/utils/tasks" className="px-3 py-1.5 text-xs font-bold text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors">📋 Tasks</Link>
          <Link href="/admin/utils/workers" className="px-3 py-1.5 text-xs font-bold text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors">⚙️ Workers</Link>
        </div>

        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Cron Configurations</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Manage scheduled tasks and automated jobs
            </p>
          </div>
          <button
            onClick={() => { resetForm(); setShowModal(true); }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
          >
            Add Cron Job
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-gray-200 dark:border-slate-800">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{cronJobs.length}</div>
            <div className="text-sm text-gray-500">Total Jobs</div>
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-gray-200 dark:border-slate-800">
            <div className="text-2xl font-bold text-green-600">{cronJobs.filter((j) => j.isActive).length}</div>
            <div className="text-sm text-gray-500">Active</div>
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-gray-200 dark:border-slate-800">
            <div className="text-2xl font-bold text-blue-600">
              {cronJobs.reduce((sum, j) => sum + j.runCount, 0)}
            </div>
            <div className="text-sm text-gray-500">Total Runs</div>
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-gray-200 dark:border-slate-800">
            <div className="text-2xl font-bold text-red-600">
              {cronJobs.reduce((sum, j) => sum + j.failureCount, 0)}
            </div>
            <div className="text-sm text-gray-500">Failures</div>
          </div>
        </div>

        {/* Cron Jobs List */}
        {loading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-white dark:bg-slate-900 rounded-lg p-6 animate-pulse">
                <div className="h-4 bg-gray-200 dark:bg-slate-800 rounded w-1/3 mb-4"></div>
                <div className="h-3 bg-gray-200 dark:bg-slate-800 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        ) : cronJobs.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-lg p-12 text-center">
            <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-gray-500 dark:text-gray-400">No cron jobs configured</p>
            <button
              onClick={() => { resetForm(); setShowModal(true); }}
              className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
            >
              Create First Cron Job
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {cronJobs.map((job) => (
              <div
                key={job.id}
                className={`bg-white dark:bg-slate-900 rounded-lg p-6 border ${job.isActive ? "border-l-4 border-l-green-500" : "border-l-4 border-l-gray-300"} border-gray-200 dark:border-slate-800`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{job.name}</h3>
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${job.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>
                        {job.isActive ? "Active" : "Inactive"}
                      </span>
                      <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                        {getTaskTypeLabel(job.taskType)}
                      </span>
                    </div>
                    {job.description && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{job.description}</p>
                    )}
                    <div className="flex flex-wrap gap-4 text-sm text-gray-500">
                      <span className="font-mono">{job.cronExpression}</span>
                      <span>({getCronDescription(job.cronExpression)})</span>
                      {job.nextRun && (
                        <span>Next: {new Date(job.nextRun).toLocaleString()}</span>
                      )}
                      {job.lastRun && (
                        <span>Last: {new Date(job.lastRun).toLocaleString()}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                      <span>Runs: {job.runCount}</span>
                      <span className="text-green-600">Success: {job.successCount}</span>
                      <span className="text-red-600">Failed: {job.failureCount}</span>
                      <Link
                        href={`/admin/utils/tasks?category=cron&cronJobId=${job.id}`}
                        className="text-blue-600 hover:text-blue-700 font-medium hover:underline"
                      >
                        View Tasks →
                      </Link>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleRunNow(job)}
                      className="px-3 py-1 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded border border-blue-200"
                    >
                      Run Now
                    </button>
                    <button
                      onClick={() => handleToggle(job)}
                      className={`px-3 py-1 text-sm font-medium rounded border ${job.isActive ? "text-yellow-600 hover:bg-yellow-50 border-yellow-200" : "text-green-600 hover:bg-green-50 border-green-200"}`}
                    >
                      {job.isActive ? "Disable" : "Enable"}
                    </button>
                    <button
                      onClick={() => openEdit(job)}
                      className="px-3 py-1 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded border border-gray-200"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(job.id)}
                      className="px-3 py-1 text-sm font-medium text-red-600 hover:bg-red-50 rounded border border-red-200"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex min-h-screen items-center justify-center p-4">
              <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setShowModal(false)}></div>
              <div className="relative bg-white dark:bg-slate-900 rounded-lg shadow-xl max-w-lg w-full">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    {editingJob ? "Edit Cron Job" : "Create Cron Job"}
                  </h3>
                </div>
                <form onSubmit={handleSubmit}>
                  <div className="p-6 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Name
                      </label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        required
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                        placeholder="Daily Stock Sync"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Description
                      </label>
                      <input
                        type="text"
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                        placeholder="Optional description"
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
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Cron Expression
                      </label>
                      <input
                        type="text"
                        value={formData.cronExpression}
                        onChange={(e) => setFormData({ ...formData, cronExpression: e.target.value })}
                        required
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white font-mono"
                        placeholder="0 6 * * *"
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        {CRON_PRESETS.map((preset) => (
                          <button
                            key={preset.value}
                            type="button"
                            onClick={() => setFormData({ ...formData, cronExpression: preset.value })}
                            className={`px-2 py-1 text-xs rounded-full ${formData.cronExpression === preset.value ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="isActive"
                        checked={formData.isActive}
                        onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                        className="w-4 h-4 text-blue-600"
                      />
                      <label htmlFor="isActive" className="text-sm text-gray-700 dark:text-gray-300">
                        Active (scheduled to run)
                      </label>
                    </div>
                  </div>
                  <div className="px-6 py-4 border-t border-gray-200 dark:border-slate-800 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => { setShowModal(false); resetForm(); }}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {saving ? "Saving..." : editingJob ? "Update" : "Create"}
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
