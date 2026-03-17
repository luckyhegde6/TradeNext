"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

interface TaskEvent {
  id: string;
  taskId: string;
  eventType: string;
  message: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

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
  parentTaskId: string | null;
  triggeredBy: string | null;
  createdAt: string;
  events?: TaskEvent[];
}

interface CronJob {
  id: string;
  name: string;
  taskType: string;
  cronExpression: string;
  isActive: boolean;
  lastRun: string | null;
  nextRun: string | null;
  runCount: number;
  successCount: number;
  failureCount: number;
}

interface CategoryStats {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/50",
  running: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800/50",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800/50",
  failed: "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800/50",
  cancelled: "bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800/20 dark:text-gray-400 dark:border-gray-700",
};

const STATUS_ICONS: Record<string, string> = {
  pending: "⏳",
  running: "⟳",
  completed: "✓",
  failed: "✗",
  cancelled: "⊘",
};

const TASK_TYPE_LABELS: Record<string, { label: string; icon: string; description: string }> = {
  // Cron
  stock_sync: { label: "Stock Sync", icon: "📈", description: "Sync stocks from NSE" },
  corp_actions: { label: "Corp Actions", icon: "📋", description: "Sync corporate actions" },
  alert_check: { label: "Alert Check", icon: "🔔", description: "Check user price alerts against NSE" },
  screener: { label: "Screener", icon: "🔍", description: "Run stock screener filters" },
  recommendations: { label: "Recommendations", icon: "⭐", description: "Generate stock recommendations" },
  market_data: { label: "Market Data", icon: "📊", description: "Sync market data snapshots" },
  // Async
  csv_processing: { label: "CSV Processing", icon: "📄", description: "Process uploaded CSV files" },
  historical_sync: { label: "Historical Sync", icon: "📅", description: "Sync historical data from NSE" },
  data_sync: { label: "Data Sync", icon: "🔄", description: "Sync data from external sources" },
  // Regular
  cleanup: { label: "Cleanup", icon: "🧹", description: "Clean old data from tables" },
  maintenance: { label: "Maintenance", icon: "🔧", description: "System maintenance tasks" },
  password_reset: { label: "Password Reset", icon: "🔑", description: "Invalidate user sessions" },
  notification_broadcast: { label: "Notify Users", icon: "📣", description: "Broadcast notifications" },
  announcement_mgmt: { label: "Announcement", icon: "📢", description: "Manage admin announcements" },
  user_query: { label: "User Query", icon: "💬", description: "Respond to user queries" },
};

const CATEGORY_CONFIG = {
  cron: {
    label: "Cron Tasks",
    description: "Scheduled jobs — daily sync, alert checks against NSE stock prices, screener runs",
    icon: "⏰",
    gradient: "from-blue-500 to-indigo-600",
    lightBg: "bg-blue-50 dark:bg-blue-900/10",
    accentText: "text-blue-600 dark:text-blue-400",
    taskTypes: ["stock_sync", "corp_actions", "alert_check", "screener", "recommendations", "market_data"],
  },
  async: {
    label: "Async Tasks",
    description: "Background processing — CSV ingest on upload triggers worker → process → insert to DB → complete",
    icon: "⚡",
    gradient: "from-purple-500 to-fuchsia-600",
    lightBg: "bg-purple-50 dark:bg-purple-900/10",
    accentText: "text-purple-600 dark:text-purple-400",
    taskTypes: ["csv_processing", "historical_sync", "data_sync"],
  },
  regular: {
    label: "Regular Tasks",
    description: "On-demand operations — password resets, notification broadcasts, announcement management",
    icon: "🛠️",
    gradient: "from-slate-500 to-gray-600",
    lightBg: "bg-gray-50 dark:bg-gray-900/10",
    accentText: "text-gray-600 dark:text-gray-400",
    taskTypes: ["cleanup", "maintenance", "password_reset", "notification_broadcast", "announcement_mgmt", "user_query"],
  },
} as const;

type Category = keyof typeof CATEGORY_CONFIG;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function TasksContent() {
  const { data: session, status: authStatus } = useSession();
  const searchParams = useSearchParams();
  const [tasks, setTasks] = useState<WorkerTask[]>([]);
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<Category>(
    (searchParams.get("category") as Category) || "cron"
  );
  const [filter, setFilter] = useState<"all" | "pending" | "running" | "completed" | "failed">("all");
  const [showModal, setShowModal] = useState(false);
  const [showDetail, setShowDetail] = useState<WorkerTask | null>(null);
  const [detailEvents, setDetailEvents] = useState<TaskEvent[]>([]);
  const [detailCronJob, setDetailCronJob] = useState<CronJob | null>(null);
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [categoryStats, setCategoryStats] = useState<Record<string, CategoryStats>>({
    cron: { total: 0, pending: 0, running: 0, completed: 0, failed: 0 },
    async: { total: 0, pending: 0, running: 0, completed: 0, failed: 0 },
    regular: { total: 0, pending: 0, running: 0, completed: 0, failed: 0 },
  });

  const [formData, setFormData] = useState({
    name: "",
    taskType: "cleanup",
    priority: 5,
    maxRetries: 3,
    payload: {} as Record<string, unknown>,
    // Extra fields for specific types
    notificationTitle: "",
    notificationMessage: "",
    notificationTarget: "all",
    announcementAction: "create",
    userId: "",
  });

  // ---- Data fetching ----

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      const statusParam = filter === "all" ? "" : filter;
      const [tasksRes, cronRes] = await Promise.all([
        fetch(`/api/admin/workers?taskCategory=${activeCategory}&status=${statusParam}&limit=100`),
        activeCategory === "cron" ? fetch("/api/admin/cron") : Promise.resolve(null),
      ]);

      if (tasksRes.ok) {
        const data = await tasksRes.json();
        setTasks(data.tasks || []);
        if (data.taskStats?.stats) {
          setCategoryStats(data.taskStats.stats);
        }
      }

      if (cronRes && cronRes.ok) {
        const cronData = await cronRes.json();
        setCronJobs(cronData || []);
      }
    } catch (error) {
      console.error("Failed to fetch tasks:", error);
    } finally {
      setLoading(false);
    }
  }, [activeCategory, filter]);

  useEffect(() => {
    if (authStatus === "authenticated") {
      fetchTasks();
    }
  }, [authStatus, fetchTasks]);

  // Handle deep-link from URL query params (e.g. from Workers or Cron page)
  useEffect(() => {
    const taskIdParam = searchParams.get("taskId");
    if (taskIdParam && authStatus === "authenticated") {
      // Auto-open the detail drawer for a specific task
      fetch(`/api/admin/workers/trigger?taskId=${taskIdParam}`)
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (data?.task) {
            setShowDetail(data.task);
            setDetailEvents(data.task.events || []);
            setDetailCronJob(data.cronJob || null);
            // Switch to the correct category tab
            if (data.task.taskCategory) {
              setActiveCategory(data.task.taskCategory as Category);
            }
          }
        })
        .catch(console.error);
    }
  }, [searchParams, authStatus]);

  // ---- Task Detail ----

  const openDetail = async (task: WorkerTask) => {
    setShowDetail(task);
    setDetailEvents([]);
    setDetailCronJob(null);

    try {
      const res = await fetch(`/api/admin/workers/trigger?taskId=${task.id}`);
      if (res.ok) {
        const data = await res.json();
        setDetailEvents(data.task?.events || []);
        setDetailCronJob(data.cronJob || null);
      }
    } catch (error) {
      console.error("Failed to fetch task detail:", error);
    }
  };

  // ---- Actions ----

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      // Build payload based on task type
      let payload: Record<string, unknown> = { ...formData.payload };
      if (formData.taskType === "notification_broadcast") {
        payload = { title: formData.notificationTitle, message: formData.notificationMessage, target: formData.notificationTarget };
      } else if (formData.taskType === "announcement_mgmt") {
        payload = { action: formData.announcementAction, title: formData.notificationTitle, message: formData.notificationMessage };
      } else if (formData.taskType === "password_reset") {
        payload = formData.userId ? { userId: parseInt(formData.userId) } : {};
      }

      const res = await fetch("/api/admin/workers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          taskType: formData.taskType,
          taskCategory: activeCategory,
          priority: formData.priority,
          maxRetries: formData.maxRetries,
          payload,
        }),
      });

      if (res.ok) {
        fetchTasks();
        setShowModal(false);
        resetForm();
      }
    } catch (error) {
      console.error("Failed to create task:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleTriggerCron = async (cronJobId: string) => {
    setTriggering(cronJobId);
    try {
      const res = await fetch("/api/admin/workers/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cronJobId }),
      });
      if (res.ok) {
        fetchTasks();
      }
    } catch (error) {
      console.error("Failed to trigger cron job:", error);
    } finally {
      setTriggering(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this task?")) return;
    try {
      await fetch(`/api/admin/workers?id=${id}`, { method: "DELETE" });
      fetchTasks();
      if (showDetail?.id === id) setShowDetail(null);
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
          parentTaskId: task.id,
        }),
      });
      fetchTasks();
    } catch (error) {
      console.error("Failed to rerun task:", error);
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      taskType: CATEGORY_CONFIG[activeCategory].taskTypes[0],
      priority: 5,
      maxRetries: 3,
      payload: {},
      notificationTitle: "",
      notificationMessage: "",
      notificationTarget: "all",
      announcementAction: "create",
      userId: "",
    });
  };

  const getTypeInfo = (taskType: string) => TASK_TYPE_LABELS[taskType] || { label: taskType, icon: "📌", description: "" };

  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const duration = (start: string | null, end: string | null) => {
    if (!start) return "—";
    const s = new Date(start).getTime();
    const e = end ? new Date(end).getTime() : Date.now();
    const sec = Math.round((e - s) / 1000);
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  };

  // ---- Auth guards ----

  if (authStatus === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (authStatus === "unauthenticated" || session?.user?.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Access Denied</h2>
          <p className="text-gray-600 dark:text-gray-400">Please sign in as an admin to view this page.</p>
        </div>
      </div>
    );
  }

  const catConfig = CATEGORY_CONFIG[activeCategory];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Cross-navigation bar */}
        <div className="flex items-center gap-2 mb-6 p-3 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800">
          <span className="text-xs font-bold text-gray-400 dark:text-slate-600 uppercase tracking-wider mr-2">Task System:</span>
          <Link href="/admin/utils/cron" className="px-3 py-1.5 text-xs font-bold text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors">⏰ Cron Config</Link>
          <span className="px-3 py-1.5 text-xs font-bold bg-blue-600 text-white rounded-lg">📋 Tasks</span>
          <Link href="/admin/utils/workers" className="px-3 py-1.5 text-xs font-bold text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors">⚙️ Workers</Link>
        </div>

        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
              Task Manager
            </h1>
            <p className="text-gray-500 dark:text-slate-400 mt-1">
              Interconnected task system — cron schedules, async processing, and admin operations
            </p>
          </div>
          <button
            onClick={() => { resetForm(); setShowModal(true); }}
            className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-semibold shadow-lg shadow-blue-500/25 transition-all hover:shadow-xl hover:shadow-blue-500/30 hover:translate-y-[-1px]"
          >
            + Create Task
          </button>
        </div>

        {/* Summary Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {(["cron", "async", "regular"] as const).map((cat) => {
            const cfg = CATEGORY_CONFIG[cat];
            const s = categoryStats[cat] || { total: 0, pending: 0, running: 0, completed: 0, failed: 0 };
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`relative overflow-hidden rounded-2xl p-5 text-left transition-all duration-300 border-2 ${isActive
                  ? "border-transparent shadow-xl shadow-slate-200/50 dark:shadow-none scale-[1.02]"
                  : "border-transparent hover:border-gray-200 dark:hover:border-slate-700 hover:shadow-lg"
                  }`}
              >
                {isActive && (
                  <div className={`absolute inset-0 bg-gradient-to-br ${cfg.gradient} opacity-[0.07]`} />
                )}
                <div className="relative">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{cfg.icon}</span>
                      <h3 className={`text-sm font-black uppercase tracking-widest ${isActive ? cfg.accentText : "text-gray-400 dark:text-slate-500"}`}>
                        {cfg.label}
                      </h3>
                    </div>
                    <span className="text-3xl font-black text-gray-900 dark:text-white">{s.total}</span>
                  </div>
                  <div className="flex gap-3 text-[11px] font-bold">
                    {s.running > 0 && <span className="text-blue-600 dark:text-blue-400">● {s.running} running</span>}
                    {s.pending > 0 && <span className="text-amber-600 dark:text-amber-400">● {s.pending} pending</span>}
                    {s.failed > 0 && <span className="text-red-600 dark:text-red-400">● {s.failed} failed</span>}
                    {s.completed > 0 && <span className="text-emerald-600 dark:text-emerald-400">● {s.completed} done</span>}
                  </div>
                </div>
                <div className={`mt-3 text-xs ${isActive ? "text-gray-600 dark:text-slate-400" : "text-gray-400 dark:text-slate-600"}`}>
                  {cfg.description}
                </div>
              </button>
            );
          })}
        </div>

        {/* Status Filter Pills */}
        <div className="flex items-center gap-2 mb-6">
          <span className="text-xs font-bold text-gray-400 dark:text-slate-600 uppercase tracking-wider mr-2">Filter:</span>
          {(["all", "pending", "running", "completed", "failed"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${filter === s
                ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 shadow-md"
                : "bg-white dark:bg-slate-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700"
                }`}
            >
              {s === "all" ? "All" : `${STATUS_ICONS[s]} ${s.charAt(0).toUpperCase() + s.slice(1)}`}
            </button>
          ))}
          <div className="ml-auto">
            <button onClick={fetchTasks} className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline">
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Cron Jobs Panel (only on cron tab) */}
        {activeCategory === "cron" && cronJobs.length > 0 && (
          <div className="mb-6 bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 overflow-hidden">
            <div className="px-6 py-4 bg-blue-50/50 dark:bg-blue-900/10 border-b border-gray-200 dark:border-slate-800">
              <h3 className="text-sm font-black uppercase tracking-widest text-blue-600 dark:text-blue-400">
                ⏰ Configured Cron Jobs
              </h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-slate-800">
              {cronJobs.map((cj) => (
                <div key={cj.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-2 h-2 rounded-full ${cj.isActive ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]" : "bg-gray-400"}`} />
                      <span className="text-sm font-bold text-gray-900 dark:text-white">{cj.name}</span>
                      <code className="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-slate-800 rounded font-mono text-gray-500 dark:text-slate-400">
                        {cj.cronExpression}
                      </code>
                    </div>
                    <div className="flex gap-4 text-[11px] font-semibold text-gray-500 dark:text-slate-500">
                      <span>Type: {getTypeInfo(cj.taskType).label}</span>
                      <span>Runs: {cj.runCount}</span>
                      {cj.lastRun && <span>Last: {timeAgo(cj.lastRun)}</span>}
                      {cj.nextRun && <span>Next: {new Date(cj.nextRun).toLocaleString()}</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => handleTriggerCron(cj.id)}
                    disabled={triggering === cj.id}
                    className="px-3 py-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all disabled:opacity-50 shadow-sm hover:shadow-md"
                  >
                    {triggering === cj.id ? "Running..." : "▶ Run Now"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tasks List */}
        {loading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-white dark:bg-slate-900 rounded-xl p-5 animate-pulse border border-gray-100 dark:border-slate-800">
                <div className="h-4 bg-gray-200 dark:bg-slate-800 rounded w-1/3 mb-3"></div>
                <div className="h-3 bg-gray-200 dark:bg-slate-800 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-16 text-center border border-gray-100 dark:border-slate-800">
            <div className="text-5xl mb-4">{catConfig.icon}</div>
            <p className="text-gray-500 dark:text-gray-400 mb-2 font-semibold">
              No {catConfig.label.toLowerCase()} found
            </p>
            <p className="text-xs text-gray-400 dark:text-slate-600 mb-6">{catConfig.description}</p>
            <button
              onClick={() => { resetForm(); setShowModal(true); }}
              className={`px-5 py-2.5 bg-gradient-to-r ${catConfig.gradient} text-white rounded-xl font-semibold shadow-lg transition-all hover:shadow-xl hover:translate-y-[-1px]`}
            >
              Create First Task
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => {
              const typeInfo = getTypeInfo(task.taskType);
              return (
                <div
                  key={task.id}
                  onClick={() => openDetail(task)}
                  className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-gray-100 dark:border-slate-800 hover:border-gray-300 dark:hover:border-slate-600 transition-all cursor-pointer hover:shadow-md group"
                >
                  <div className="flex items-center gap-4">
                    {/* Status + Icon */}
                    <div className="flex-shrink-0 flex items-center gap-2">
                      <span className={`text-base ${task.status === "running" ? "animate-spin" : ""}`}>
                        {STATUS_ICONS[task.status] || "•"}
                      </span>
                      <span className="text-lg">{typeInfo.icon}</span>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold text-gray-900 dark:text-white truncate">
                          {task.name}
                        </span>
                        <span className={`px-2 py-0.5 text-[10px] font-black uppercase rounded-md border ${STATUS_COLORS[task.status]}`}>
                          {task.status}
                        </span>
                        {task.triggeredBy && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 rounded">
                            via {task.triggeredBy}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] font-semibold text-gray-500 dark:text-slate-500">
                        <span>{typeInfo.label}</span>
                        <span>P{task.priority}</span>
                        <span>Retries: {task.retryCount}/{task.maxRetries}</span>
                        {task.startedAt && <span>Duration: {duration(task.startedAt, task.completedAt)}</span>}
                        <span>{timeAgo(task.createdAt)}</span>
                      </div>
                      {task.error && (
                        <p className="text-[11px] text-red-500 mt-1 truncate font-medium">{task.error}</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {task.status === "pending" && (
                        <button onClick={(e) => { e.stopPropagation(); handleCancel(task.id); }}
                          className="px-2 py-1 text-[10px] font-bold text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg">
                          Cancel
                        </button>
                      )}
                      {(task.status === "completed" || task.status === "failed") && (
                        <button onClick={(e) => { e.stopPropagation(); handleRerun(task); }}
                          className="px-2 py-1 text-[10px] font-bold text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg">
                          Re-run
                        </button>
                      )}
                      {["completed", "failed", "cancelled"].includes(task.status) && (
                        <button onClick={(e) => { e.stopPropagation(); handleDelete(task.id); }}
                          className="px-2 py-1 text-[10px] font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg">
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ============ Task Detail Drawer ============ */}
        {showDetail && (
          <div className="fixed inset-0 z-50 flex justify-end">
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowDetail(null)} />
            <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-300">
              {/* Drawer Header */}
              <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 px-6 py-4 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">{showDetail.name}</h3>
                  <p className="text-xs text-gray-500 dark:text-slate-400 font-medium">{showDetail.id}</p>
                </div>
                <button onClick={() => setShowDetail(null)} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg">
                  <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-6 space-y-6">
                {/* Status & Meta */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Status", value: showDetail.status, icon: STATUS_ICONS[showDetail.status] },
                    { label: "Category", value: showDetail.taskCategory },
                    { label: "Type", value: getTypeInfo(showDetail.taskType).label },
                    { label: "Priority", value: `P${showDetail.priority}` },
                    { label: "Triggered By", value: showDetail.triggeredBy || "—" },
                    { label: "Retries", value: `${showDetail.retryCount}/${showDetail.maxRetries}` },
                  ].map((item) => (
                    <div key={item.label} className="bg-gray-50 dark:bg-slate-800/50 rounded-xl p-3">
                      <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-1">{item.label}</p>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">
                        {item.icon && <span className="mr-1">{item.icon}</span>}
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Timestamps */}
                <div className="bg-gray-50 dark:bg-slate-800/50 rounded-xl p-4 space-y-2">
                  <h4 className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">Timeline</h4>
                  <div className="text-xs font-medium text-gray-600 dark:text-slate-400 space-y-1">
                    <div className="flex justify-between"><span>Created</span><span>{new Date(showDetail.createdAt).toLocaleString()}</span></div>
                    {showDetail.startedAt && <div className="flex justify-between"><span>Started</span><span>{new Date(showDetail.startedAt).toLocaleString()}</span></div>}
                    {showDetail.completedAt && <div className="flex justify-between"><span>Finished</span><span>{new Date(showDetail.completedAt).toLocaleString()}</span></div>}
                    {showDetail.startedAt && <div className="flex justify-between font-bold"><span>Duration</span><span>{duration(showDetail.startedAt, showDetail.completedAt)}</span></div>}
                  </div>
                </div>

                {/* Linked CronJob (if any) */}
                {detailCronJob && (
                  <div className="bg-blue-50 dark:bg-blue-900/10 rounded-xl p-4 border border-blue-100 dark:border-blue-800/30">
                    <h4 className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest mb-2">Linked Cron Job</h4>
                    <div className="text-xs font-medium text-gray-700 dark:text-slate-300 space-y-1">
                      <div className="flex justify-between"><span>Name</span><span className="font-bold">{detailCronJob.name}</span></div>
                      <div className="flex justify-between"><span>Schedule</span><code className="font-mono text-blue-600">{detailCronJob.cronExpression}</code></div>
                      <div className="flex justify-between"><span>Total Runs</span><span>{detailCronJob.runCount}</span></div>
                    </div>
                    <Link
                      href="/admin/utils/cron"
                      className="inline-block mt-3 text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline"
                    >
                      Manage in Cron Config →
                    </Link>
                  </div>
                )}

                {/* Payload */}
                {showDetail.payload && Object.keys(showDetail.payload).length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-2">Payload</h4>
                    <pre className="bg-gray-900 dark:bg-slate-950 text-emerald-400 text-xs p-4 rounded-xl overflow-x-auto font-mono">
                      {JSON.stringify(showDetail.payload, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Result */}
                {showDetail.result && Object.keys(showDetail.result).length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-2">Result</h4>
                    <pre className="bg-gray-900 dark:bg-slate-950 text-cyan-400 text-xs p-4 rounded-xl overflow-x-auto font-mono">
                      {JSON.stringify(showDetail.result, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Error */}
                {showDetail.error && (
                  <div className="bg-red-50 dark:bg-red-900/10 rounded-xl p-4 border border-red-200 dark:border-red-800/30">
                    <h4 className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase tracking-widest mb-2">Error</h4>
                    <p className="text-xs text-red-700 dark:text-red-300 font-medium">{showDetail.error}</p>
                  </div>
                )}

                {/* Events Timeline */}
                {detailEvents.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-3">Events Timeline</h4>
                    <div className="space-y-0">
                      {detailEvents.map((event, idx) => (
                        <div key={event.id} className="flex gap-3">
                          {/* Timeline line */}
                          <div className="flex flex-col items-center">
                            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${event.eventType.includes("completed") ? "bg-emerald-500" :
                              event.eventType.includes("failed") ? "bg-red-500" :
                                event.eventType.includes("started") ? "bg-blue-500" :
                                  "bg-gray-400 dark:bg-slate-600"
                              }`} />
                            {idx < detailEvents.length - 1 && (
                              <div className="w-px h-full bg-gray-200 dark:bg-slate-700 min-h-[24px]" />
                            )}
                          </div>
                          {/* Event content */}
                          <div className="pb-4 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black uppercase text-gray-400 dark:text-slate-500">
                                {event.eventType.replace(/_/g, " ")}
                              </span>
                              <span className="text-[10px] text-gray-400 dark:text-slate-600">
                                {timeAgo(event.createdAt)}
                              </span>
                            </div>
                            {event.message && (
                              <p className="text-xs text-gray-600 dark:text-slate-400 mt-0.5">{event.message}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ============ Create Task Modal ============ */}
        {showModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex min-h-screen items-center justify-center p-4">
              <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowModal(false)}></div>
              <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-lg w-full border border-gray-200 dark:border-slate-800">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 flex items-center gap-3">
                  <span className="text-xl">{catConfig.icon}</span>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                    Create {catConfig.label.replace("Tasks", "Task")}
                  </h3>
                </div>
                <form onSubmit={handleSubmit}>
                  <div className="p-6 space-y-4">
                    {/* Name */}
                    <div>
                      <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                        Task Name
                      </label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        required
                        className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        placeholder="e.g., Daily Stock Sync"
                      />
                    </div>

                    {/* Task Type */}
                    <div>
                      <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                        Task Type
                      </label>
                      <select
                        value={formData.taskType}
                        onChange={(e) => setFormData({ ...formData, taskType: e.target.value })}
                        className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      >
                        {catConfig.taskTypes.map((type) => {
                          const info = getTypeInfo(type);
                          return (
                            <option key={type} value={type}>
                              {info.icon} {info.label} — {info.description}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    {/* Priority & Max Retries */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                          Priority (1-10)
                        </label>
                        <input
                          type="number" min="1" max="10"
                          value={formData.priority}
                          onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) })}
                          className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                          Max Retries
                        </label>
                        <input
                          type="number" min="0" max="10"
                          value={formData.maxRetries}
                          onChange={(e) => setFormData({ ...formData, maxRetries: parseInt(e.target.value) })}
                          className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        />
                      </div>
                    </div>

                    {/* Conditional fields for notification_broadcast */}
                    {formData.taskType === "notification_broadcast" && (
                      <div className="space-y-3 p-4 bg-purple-50 dark:bg-purple-900/10 rounded-xl border border-purple-100 dark:border-purple-800/30">
                        <h4 className="text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-widest">Notification Details</h4>
                        <input
                          type="text" placeholder="Notification title"
                          value={formData.notificationTitle}
                          onChange={(e) => setFormData({ ...formData, notificationTitle: e.target.value })}
                          className="w-full px-3 py-2 border border-purple-200 dark:border-purple-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
                        />
                        <textarea
                          placeholder="Notification message"
                          value={formData.notificationMessage}
                          onChange={(e) => setFormData({ ...formData, notificationMessage: e.target.value })}
                          className="w-full px-3 py-2 border border-purple-200 dark:border-purple-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
                          rows={2}
                        />
                        <select
                          value={formData.notificationTarget}
                          onChange={(e) => setFormData({ ...formData, notificationTarget: e.target.value })}
                          className="w-full px-3 py-2 border border-purple-200 dark:border-purple-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
                        >
                          <option value="all">All Users</option>
                        </select>
                      </div>
                    )}

                    {/* Conditional fields for password_reset */}
                    {formData.taskType === "password_reset" && (
                      <div className="space-y-3 p-4 bg-amber-50 dark:bg-amber-900/10 rounded-xl border border-amber-100 dark:border-amber-800/30">
                        <h4 className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest">Password Reset</h4>
                        <input
                          type="text" placeholder="User ID"
                          value={formData.userId}
                          onChange={(e) => setFormData({ ...formData, userId: e.target.value })}
                          className="w-full px-3 py-2 border border-amber-200 dark:border-amber-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
                        />
                      </div>
                    )}

                    {/* Conditional fields for announcement_mgmt */}
                    {formData.taskType === "announcement_mgmt" && (
                      <div className="space-y-3 p-4 bg-blue-50 dark:bg-blue-900/10 rounded-xl border border-blue-100 dark:border-blue-800/30">
                        <h4 className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest">Announcement</h4>
                        <input
                          type="text" placeholder="Title"
                          value={formData.notificationTitle}
                          onChange={(e) => setFormData({ ...formData, notificationTitle: e.target.value })}
                          className="w-full px-3 py-2 border border-blue-200 dark:border-blue-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
                        />
                        <textarea
                          placeholder="Message"
                          value={formData.notificationMessage}
                          onChange={(e) => setFormData({ ...formData, notificationMessage: e.target.value })}
                          className="w-full px-3 py-2 border border-blue-200 dark:border-blue-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
                          rows={2}
                        />
                      </div>
                    )}
                  </div>

                  {/* Modal Footer */}
                  <div className="px-6 py-4 border-t border-gray-200 dark:border-slate-800 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowModal(false)}
                      className="px-4 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-800 font-semibold text-sm transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className={`px-5 py-2.5 bg-gradient-to-r ${catConfig.gradient} text-white rounded-xl font-semibold text-sm shadow-lg transition-all disabled:opacity-50 hover:shadow-xl hover:translate-y-[-1px]`}
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

export default function TasksPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    }>
      <TasksContent />
    </Suspense>
  );
}
