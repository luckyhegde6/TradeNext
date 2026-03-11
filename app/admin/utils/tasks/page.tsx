"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  isAddressed: boolean;
  addressedAt: string | null;
  createdAt: string;
}

const NOTIFICATION_TYPES: Record<string, { label: string; color: string }> = {
  contact_message: { label: "Contact", color: "bg-blue-100 text-blue-800" },
  alert_triggered: { label: "Alert", color: "bg-yellow-100 text-yellow-800" },
  recommendation: { label: "Recommendation", color: "bg-green-100 text-green-800" },
  system: { label: "System", color: "bg-gray-100 text-gray-800" },
  watchlist: { label: "Watchlist", color: "bg-purple-100 text-purple-800" },
};

export default function AdminTasksPage() {
  const { data: session, status } = useSession();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "addressed">("all");
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);
  const [responseText, setResponseText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (status === "authenticated") {
      fetchNotifications();
    }
  }, [status, filter]);

  const fetchNotifications = async () => {
    try {
      setLoading(true);
      const addressed = filter === "all" ? undefined : filter === "addressed" ? "true" : "false";
      const res = await fetch(`/api/admin/notifications?addressed=${addressed}`);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
      }
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkRead = async (id: string) => {
    try {
      await fetch("/api/admin/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "markRead" }),
      });
      fetchNotifications();
    } catch (error) {
      console.error("Failed to mark read:", error);
    }
  };

  const handleAddress = async () => {
    if (!selectedNotification || !responseText.trim()) return;

    try {
      setSending(true);
      await fetch("/api/admin/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedNotification.id,
          action: "address",
          response: responseText
        }),
      });
      setSelectedNotification(null);
      setResponseText("");
      fetchNotifications();
    } catch (error) {
      console.error("Failed to address:", error);
    } finally {
      setSending(false);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await fetch("/api/admin/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "markAllRead" }),
      });
      fetchNotifications();
    } catch (error) {
      console.error("Failed to mark all read:", error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this notification?")) return;
    try {
      await fetch(`/api/admin/notifications?id=${id}`, { method: "DELETE" });
      fetchNotifications();
    } catch (error) {
      console.error("Failed to delete:", error);
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Access Denied</h2>
          <p className="text-gray-600 dark:text-gray-400">Please sign in as an admin to view this page.</p>
        </div>
      </div>
    );
  }

  const pendingCount = notifications.filter(n => !n.isAddressed).length;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Task Manager</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Manage contact messages and notifications from users
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleMarkAllRead}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-sm font-medium"
            >
              Mark All Read
            </button>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-6 border-b border-gray-200 dark:border-slate-800">
          <button
            onClick={() => setFilter("all")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              filter === "all"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            All Tasks
          </button>
          <button
            onClick={() => setFilter("pending")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              filter === "pending"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Pending ({pendingCount})
          </button>
          <button
            onClick={() => setFilter("addressed")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              filter === "addressed"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Addressed
          </button>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-white dark:bg-slate-900 rounded-lg p-6 animate-pulse">
                <div className="h-4 bg-gray-200 dark:bg-slate-800 rounded w-1/3 mb-4"></div>
                <div className="h-3 bg-gray-200 dark:bg-slate-800 rounded w-2/3"></div>
              </div>
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-lg p-12 text-center">
            <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-gray-500 dark:text-gray-400">No tasks found</p>
          </div>
        ) : (
          <div className="space-y-4">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={`bg-white dark:bg-slate-900 rounded-lg p-6 border ${
                  notification.isAddressed
                    ? "border-gray-200 dark:border-slate-800 opacity-75"
                    : notification.isRead
                    ? "border-l-4 border-l-blue-500 border-gray-200 dark:border-slate-800"
                    : "border-l-4 border-l-yellow-500 border-gray-200 dark:border-slate-800"
                }`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className={`text-xs font-bold px-2 py-1 rounded-full ${NOTIFICATION_TYPES[notification.type]?.color || "bg-gray-100 text-gray-800"}`}>
                        {NOTIFICATION_TYPES[notification.type]?.label || notification.type}
                      </span>
                      {notification.isAddressed && (
                        <span className="text-xs font-bold px-2 py-1 rounded-full bg-green-100 text-green-800">
                          Addressed
                        </span>
                      )}
                      {!notification.isRead && (
                        <span className="text-xs font-bold px-2 py-1 rounded-full bg-yellow-100 text-yellow-800">
                          New
                        </span>
                      )}
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                      {notification.title}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap mb-3">
                      {notification.message}
                    </p>
                    <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-500">
                      <span>{new Date(notification.createdAt).toLocaleString()}</span>
                      {notification.addressedAt && (
                        <span>Addressed: {new Date(notification.addressedAt).toLocaleString()}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4">
                    {!notification.isRead && (
                      <button
                        onClick={() => handleMarkRead(notification.id)}
                        className="px-3 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-300 rounded"
                      >
                        Mark Read
                      </button>
                    )}
                    {!notification.isAddressed && (
                      <button
                        onClick={() => setSelectedNotification(notification)}
                        className="px-3 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded"
                      >
                        Address
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(notification.id)}
                      className="px-3 py-1 text-xs font-medium text-red-600 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Address Modal */}
        {selectedNotification && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex min-h-screen items-center justify-center p-4">
              <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setSelectedNotification(null)}></div>
              <div className="relative bg-white dark:bg-slate-900 rounded-lg shadow-xl max-w-lg w-full">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Address Task</h3>
                </div>
                <div className="p-6">
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Subject
                    </label>
                    <p className="text-gray-900 dark:text-white">{selectedNotification.title}</p>
                  </div>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Message
                    </label>
                    <p className="text-gray-600 dark:text-gray-400 text-sm whitespace-pre-wrap">{selectedNotification.message}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Response / Notes
                    </label>
                    <textarea
                      value={responseText}
                      onChange={(e) => setResponseText(e.target.value)}
                      rows={4}
                      placeholder="Enter your response or notes about how this was addressed..."
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div className="px-6 py-4 border-t border-gray-200 dark:border-slate-800 flex justify-end gap-3">
                  <button
                    onClick={() => { setSelectedNotification(null); setResponseText(""); }}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddress}
                    disabled={sending || !responseText.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {sending ? "Saving..." : "Mark Addressed"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
