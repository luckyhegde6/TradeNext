"use client";

import { useState, useEffect } from "react";

interface BroadcastResult {
  sent: number;
  total: number;
  message: string;
}

interface SubscriberInfo {
  total: number;
  verified: number;
  blocked: number;
}

export default function TelegramBroadcastPage() {
  const [subscriberInfo, setSubscriberInfo] = useState<SubscriberInfo | null>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<BroadcastResult | null>(null);
  const [error, setError] = useState("");
  const [recentBroadcasts, setRecentBroadcasts] = useState<Array<{ title: string; message: string; sentAt: string; sent: number }>>([]);

  useEffect(() => {
    fetchSubscriberStats();
  }, []);

  const fetchSubscriberStats = async () => {
    try {
      const res = await fetch("/api/admin/telegram/subscribers");
      if (res.ok) setSubscriberInfo(await res.json());
    } catch {
      // Non-critical
    }
  };

  const handleBroadcast = async () => {
    if (!title.trim() || !message.trim()) {
      setError("Both title and message are required");
      return;
    }

    setSending(true);
    setError("");
    setResult(null);

    try {
      const res = await fetch("/api/admin/telegram/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), message: message.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to send broadcast");
        return;
      }

      setResult(data);
      setRecentBroadcasts((prev) => [
        { title: title.trim(), message: message.trim(), sentAt: new Date().toISOString(), sent: data.sent },
        ...prev.slice(0, 9),
      ]);
      setTitle("");
      setMessage("");
    } catch {
      setError("Network error — please try again");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Subscriber Stats */}
      {subscriberInfo && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white dark:bg-slate-800/50 rounded-2xl border border-gray-200 dark:border-slate-700/50 p-4 text-center">
            <p className="text-2xl font-extrabold text-indigo-600 dark:text-indigo-400">{subscriberInfo.total}</p>
            <p className="text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mt-1">Total Linked</p>
          </div>
          <div className="bg-white dark:bg-slate-800/50 rounded-2xl border border-gray-200 dark:border-slate-700/50 p-4 text-center">
            <p className="text-2xl font-extrabold text-green-600 dark:text-green-400">{subscriberInfo.verified}</p>
            <p className="text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mt-1">Verified</p>
          </div>
          <div className="bg-white dark:bg-slate-800/50 rounded-2xl border border-gray-200 dark:border-slate-700/50 p-4 text-center">
            <p className="text-2xl font-extrabold text-gray-400 dark:text-slate-500">{subscriberInfo.blocked}</p>
            <p className="text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mt-1">Blocked</p>
          </div>
        </div>
      )}

      {/* Compose Broadcast */}
      <div className="bg-white dark:bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-gray-200 dark:border-slate-700/50 p-6 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Compose Broadcast</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Market Update, New Feature, Maintenance Notice"
              className="w-full px-4 py-3 text-sm font-medium bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
              maxLength={100}
            />
            <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">{title.length}/100</p>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">
              Message
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write your announcement message here. Supports *bold* and _italic_ Markdown formatting."
              rows={6}
              className="w-full px-4 py-3 text-sm font-medium bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all resize-none"
              maxLength={4000}
            />
            <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">{message.length}/4000</p>
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
              <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {result && (
            <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl">
              <p className="text-sm font-medium text-green-600 dark:text-green-400">
                Broadcast sent successfully! Delivered to {result.sent} of {result.total} subscribers.
              </p>
            </div>
          )}

          <button
            onClick={handleBroadcast}
            disabled={sending || !title.trim() || !message.trim()}
            className="w-full px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 dark:disabled:bg-slate-700 text-white font-bold rounded-xl transition-all duration-200 disabled:cursor-not-allowed shadow-sm"
          >
            {sending ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Sending to subscribers...
              </span>
            ) : (
              `Send Broadcast to ${subscriberInfo?.verified || "?"} Subscribers`
            )}
          </button>
        </div>
      </div>

      {/* Recent Broadcasts */}
      {recentBroadcasts.length > 0 && (
        <div className="bg-white dark:bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-gray-200 dark:border-slate-700/50 p-6 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Recent Broadcasts</h2>
          <div className="space-y-3">
            {recentBroadcasts.map((bc, i) => (
              <div key={i} className="p-4 bg-gray-50 dark:bg-slate-900/50 rounded-xl border border-gray-100 dark:border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">{bc.title}</h3>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded-lg bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                      {bc.sent} sent
                    </span>
                    <span className="text-[10px] text-gray-400 dark:text-slate-500">
                      {new Date(bc.sentAt).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-gray-500 dark:text-slate-400 line-clamp-2">{bc.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
