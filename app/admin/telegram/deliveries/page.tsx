"use client";

import { useState, useEffect } from "react";

interface TelegramDelivery {
  id: string;
  action: string;
  userEmail: string | null;
  resource: string | null;
  metadata: Record<string, unknown> | null;
  responseStatus: number | null;
  errorMessage: string | null;
  createdAt: string;
}

const actionLabels: Record<string, string> = {
  TELEGRAM_SUBSCRIBE: "Subscribe",
  TELEGRAM_UNSUBSCRIBE: "Unsubscribe",
  TELEGRAM_COMMAND: "Command",
  TELEGRAM_BROADCAST: "Broadcast",
  AI_AGENT_TRIGGER: "AI Trigger",
  AI_AGENT_SUCCESS: "AI Success",
  AI_AGENT_FAILURE: "AI Failure",
  AI_AGENT_FALLBACK: "AI Fallback",
};

const actionColors: Record<string, string> = {
  TELEGRAM_SUBSCRIBE: "bg-green-100 text-green-800",
  TELEGRAM_UNSUBSCRIBE: "bg-red-100 text-red-800",
  TELEGRAM_COMMAND: "bg-blue-100 text-blue-800",
  TELEGRAM_BROADCAST: "bg-purple-100 text-purple-800",
  AI_AGENT_TRIGGER: "bg-cyan-100 text-cyan-800",
  AI_AGENT_SUCCESS: "bg-green-100 text-green-800",
  AI_AGENT_FAILURE: "bg-red-100 text-red-800",
  AI_AGENT_FALLBACK: "bg-yellow-100 text-yellow-800",
};

export default function TelegramDeliveriesPage() {
  const [deliveries, setDeliveries] = useState<TelegramDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    fetchDeliveries();
  }, []);

  const fetchDeliveries = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/alerts/telegram?section=deliveries&limit=200");
      if (res.ok) {
        const data = await res.json();
        setDeliveries(data.deliveries || []);
      }
    } catch (e) {
      console.error("Failed to fetch deliveries:", e);
    } finally {
      setLoading(false);
    }
  };

  const filtered = filter === "all" ? deliveries : deliveries.filter((d) => d.action === filter);

  const uniqueActions = [...new Set(deliveries.map((d) => d.action))];

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500 dark:text-slate-400 text-sm font-medium">Loading delivery logs...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filter */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter("all")}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            filter === "all"
              ? "bg-blue-600 text-white"
              : "bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700"
          }`}
        >
          All ({deliveries.length})
        </button>
        {uniqueActions.map((action) => (
          <button
            key={action}
            onClick={() => setFilter(action)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              filter === action
                ? "bg-blue-600 text-white"
                : "bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700"
            }`}
          >
            {actionLabels[action] || action} ({deliveries.filter((d) => d.action === action).length})
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">Telegram Delivery Events</h3>
          <button
            onClick={fetchDeliveries}
            className="px-3 py-1.5 text-xs font-bold bg-gray-200 dark:bg-slate-700 rounded-lg hover:bg-gray-300 transition-all"
          >
            Refresh
          </button>
        </div>

        {filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-slate-400 text-sm">
            No delivery events found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Action</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">User</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Resource</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Error</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <tr key={d.id} className="border-t border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{new Date(d.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${actionColors[d.action] || "bg-gray-100"}`}>
                        {actionLabels[d.action] || d.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300">{d.userEmail || "-"}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{d.resource || "-"}</td>
                    <td className="px-4 py-3">
                      {d.responseStatus ? (
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          d.responseStatus >= 200 && d.responseStatus < 300
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-800"
                        }`}>
                          {d.responseStatus}
                        </span>
                      ) : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-red-600 max-w-[200px] truncate">{d.errorMessage || "-"}</td>
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
