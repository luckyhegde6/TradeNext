"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface TelegramStats {
  totalSubscribers: number;
  activeSubscribers: number;
  inactiveSubscribers: number;
  totalTelegramEvents: number;
  totalAIEvents: number;
  recentSubscribers: { id: string; userId: number; chatId: string; isActive: boolean; createdAt: string }[];
}

interface BroadcastCount {
  total: number;
  verified: number;
  blocked: number;
}

export default function TelegramOverviewPage() {
  const [stats, setStats] = useState<TelegramStats | null>(null);
  const [subscriberInfo, setSubscriberInfo] = useState<BroadcastCount | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsRes, subsRes] = await Promise.all([
        fetch("/api/admin/alerts/telegram?section=stats"),
        fetch("/api/admin/telegram/subscribers"),
      ]);

      if (statsRes.ok) setStats(await statsRes.json());
      if (subsRes.ok) setSubscriberInfo(await subsRes.json());
    } catch (e) {
      console.error("Failed to fetch Telegram data:", e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500 dark:text-slate-400 text-sm font-medium">Loading Telegram data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <Link
          href="/admin/telegram/broadcast"
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-all shadow-sm"
        >
          📨 Send Broadcast
        </Link>
        <Link
          href="/admin/telegram/subscribers"
          className="px-4 py-2.5 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-300 text-sm font-bold rounded-xl border border-gray-200 dark:border-slate-700 transition-all"
        >
          👥 View Subscribers
        </Link>
        <Link
          href="/admin/telegram/settings"
          className="px-4 py-2.5 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-300 text-sm font-bold rounded-xl border border-gray-200 dark:border-slate-700 transition-all"
        >
          ⚙️ Bot Settings
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-5">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Total Linked</p>
          <p className="text-2xl font-black text-gray-900 dark:text-white mt-1">{subscriberInfo?.total || 0}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-5">
          <p className="text-xs font-bold text-green-600 uppercase tracking-widest">Verified</p>
          <p className="text-2xl font-black text-green-600 mt-1">{subscriberInfo?.verified || 0}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-5">
          <p className="text-xs font-bold text-blue-600 uppercase tracking-widest">Telegram Events</p>
          <p className="text-2xl font-black text-blue-600 mt-1">{stats?.totalTelegramEvents || 0}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-5">
          <p className="text-xs font-bold text-purple-600 uppercase tracking-widest">AI Agent Events</p>
          <p className="text-2xl font-black text-purple-600 mt-1">{stats?.totalAIEvents || 0}</p>
        </div>
      </div>

      {/* Recent Subscribers */}
      {stats && stats.recentSubscribers.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">Recent Subscribers</h3>
            <Link
              href="/admin/telegram/subscribers"
              className="text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400"
            >
              View all →
            </Link>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-800/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">User ID</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Chat ID</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Created</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentSubscribers.map((s) => (
                <tr key={s.id} className="border-t border-gray-100 dark:border-slate-800">
                  <td className="px-4 py-3 font-mono text-xs">{s.userId}</td>
                  <td className="px-4 py-3 font-mono text-xs">{s.chatId}</td>
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

      {/* Bot Commands Reference */}
      <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-6">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4">Bot Commands Reference</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { cmd: "/start", desc: "Get your Telegram Chat ID" },
            { cmd: "/chatid", desc: "Display your Chat ID" },
            { cmd: "/help", desc: "Show available commands" },
            { cmd: "/recommendations", desc: "View latest AI recommendations" },
            { cmd: "/daily-recommendations", desc: "Today's stock picks (public)" },
            { cmd: "/alerts", desc: "View your triggered alerts" },
            { cmd: "/updates", desc: "View system announcements" },
          ].map((c) => (
            <div key={c.cmd} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-slate-800/50 rounded-lg">
              <code className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs font-bold rounded">
                {c.cmd}
              </code>
              <span className="text-xs text-gray-600 dark:text-slate-400">{c.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
