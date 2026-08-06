"use client";

import { useState, useEffect } from "react";

interface TelegramSubscriber {
  id: string;
  userId: number;
  chatId: string;
  isActive: boolean;
  notifyOn: string;
  createdAt: string;
  updatedAt: string;
  user: { id: number; email: string; name: string | null } | null;
}

export default function TelegramSubscribersPage() {
  const [subscribers, setSubscribers] = useState<TelegramSubscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");

  useEffect(() => {
    fetchSubscribers();
  }, []);

  const fetchSubscribers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/alerts/telegram?section=subscribers&limit=200");
      if (res.ok) {
        const data = await res.json();
        setSubscribers(data.subscribers || []);
      }
    } catch (e) {
      console.error("Failed to fetch subscribers:", e);
    } finally {
      setLoading(false);
    }
  };

  const filtered = subscribers.filter((s) => {
    if (filter === "active") return s.isActive;
    if (filter === "inactive") return !s.isActive;
    return true;
  });

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500 dark:text-slate-400 text-sm font-medium">Loading subscribers...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-800/50 rounded-2xl border border-gray-200 dark:border-slate-700/50 p-4 text-center">
          <p className="text-2xl font-extrabold text-gray-900 dark:text-white">{subscribers.length}</p>
          <p className="text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mt-1">Total</p>
        </div>
        <div className="bg-white dark:bg-slate-800/50 rounded-2xl border border-gray-200 dark:border-slate-700/50 p-4 text-center">
          <p className="text-2xl font-extrabold text-green-600 dark:text-green-400">
            {subscribers.filter((s) => s.isActive).length}
          </p>
          <p className="text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mt-1">Active</p>
        </div>
        <div className="bg-white dark:bg-slate-800/50 rounded-2xl border border-gray-200 dark:border-slate-700/50 p-4 text-center">
          <p className="text-2xl font-extrabold text-red-500">
            {subscribers.filter((s) => !s.isActive).length}
          </p>
          <p className="text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mt-1">Inactive</p>
        </div>
      </div>

      {/* Filter + Table */}
      <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">All Telegram Subscribers</h3>
          <div className="flex items-center gap-2">
            <div className="flex gap-1 bg-gray-100 dark:bg-slate-800 p-1 rounded-lg">
              {(["all", "active", "inactive"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${
                    filter === f
                      ? "bg-white dark:bg-slate-700 text-blue-600 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <button
              onClick={fetchSubscribers}
              className="px-3 py-1.5 text-xs font-bold bg-gray-200 dark:bg-slate-700 rounded-lg hover:bg-gray-300 transition-all"
            >
              Refresh
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-slate-400 text-sm">
            No Telegram subscribers found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">User</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Chat ID</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Notify</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Created</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="border-t border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3">
                      <p className="font-bold text-gray-900 dark:text-white">{s.user?.name || "Unknown"}</p>
                      <p className="text-xs text-gray-500">{s.user?.email}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-300">{s.chatId}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 rounded-full text-[10px] font-bold uppercase">
                        {s.notifyOn}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        s.isActive ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                      }`}>
                        {s.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{new Date(s.createdAt).toLocaleString()}</td>
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
