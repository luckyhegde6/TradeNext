"use client";

import { useState, useEffect } from "react";

interface SubscribeTabProps {
  isLoggedIn?: boolean;
}

export default function SubscribeTab({ isLoggedIn = false }: SubscribeTabProps) {
  const [subscribed, setSubscribed] = useState(false);
  const [chatId, setChatId] = useState("");
  const [notifyOn, setNotifyOn] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (isLoggedIn) {
      fetchSubscription();
    } else {
      setLoading(false);
    }
  }, [isLoggedIn]);

  const fetchSubscription = async () => {
    try {
      const res = await fetch("/api/user/recommendations/subscribe");
      const data = await res.json();
      if (data.success) {
        setSubscribed(data.subscribed);
        setChatId(data.chatId || "");
        setNotifyOn(data.notifyOn || "all");
      }
    } catch (e) {
      // Not logged in or error
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async () => {
    if (!chatId.trim()) {
      setMessage("Please enter your Telegram Chat ID");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/user/recommendations/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "subscribe", chatId: chatId.trim(), notifyOn }),
      });
      const data = await res.json();
      if (data.success) {
        setSubscribed(true);
        setMessage("Subscribed successfully!");
      } else {
        setMessage(data.error || "Failed to subscribe");
      }
    } catch (e) {
      setMessage("Failed to subscribe");
    } finally {
      setSaving(false);
    }
  };

  const handleUnsubscribe = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/user/recommendations/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unsubscribe" }),
      });
      const data = await res.json();
      if (data.success) {
        setSubscribed(false);
        setMessage("Unsubscribed successfully");
      }
    } catch (e) {
      setMessage("Failed to unsubscribe");
    } finally {
      setSaving(false);
    }
  };

  // Not logged in — show login prompt
  if (!isLoggedIn) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <div className="text-4xl mb-4">🔔</div>
        <h3 className="text-lg font-medium text-gray-200 mb-2">Get Recommendations via Telegram</h3>
        <p className="text-sm text-gray-400 mb-6">
          Receive daily stock recommendations and status alerts directly on Telegram.
        </p>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 mb-6">
          <p className="text-sm text-gray-300 mb-4">
            Sign in to subscribe to daily recommendations and manage your alert preferences.
          </p>
          <a
            href="/auth/signin"
            className="inline-block px-6 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium text-white transition-colors"
          >
            Sign In to Subscribe
          </a>
        </div>
        <div className="text-xs text-gray-500 space-y-1">
          <p>1. Start a chat with <a href="https://t.me/tradenext6Bot" target="_blank" className="text-blue-400 hover:underline">@tradenext6Bot</a></p>
          <p>2. Send <code className="bg-gray-800 px-1 rounded">/chatid</code> to get your Chat ID</p>
          <p>3. Sign in and paste it above to subscribe</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-center py-12 animate-pulse">
        <div className="h-8 bg-gray-700 rounded w-1/3 mx-auto mb-3" />
        <div className="h-4 bg-gray-700 rounded w-1/2 mx-auto" />
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto text-center py-8">
      <div className="text-4xl mb-4">🔔</div>
      <h3 className="text-lg font-medium text-gray-200 mb-2">Get Recommendations via Telegram</h3>
      <p className="text-sm text-gray-400 mb-6">
        Receive daily stock recommendations and status alerts directly on Telegram.
      </p>

      {!subscribed ? (
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1 text-left">Telegram Chat ID</label>
            <input
              type="text"
              value={chatId}
              onChange={e => setChatId(e.target.value)}
              placeholder="Get from @tradenext6Bot with /chatid"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1 text-left">Notify on</label>
            <select
              value={notifyOn}
              onChange={e => setNotifyOn(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="all">All recommendations</option>
              <option value="buy_only">Buy signals only</option>
              <option value="sell_only">Sell signals only</option>
              <option value="status_changes">Status changes only</option>
            </select>
          </div>
          <button
            onClick={handleSubscribe}
            disabled={saving}
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 rounded-lg text-sm font-medium text-white transition-colors"
          >
            {saving ? "Subscribing..." : "Subscribe"}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
            <p className="text-sm text-emerald-300">✓ Subscribed to recommendations</p>
            <p className="text-xs text-gray-400 mt-1">Chat ID: {chatId}</p>
            <p className="text-xs text-gray-400">Notify: {notifyOn}</p>
          </div>
          <button
            onClick={handleUnsubscribe}
            disabled={saving}
            className="w-full px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 rounded-lg text-sm font-medium text-red-300 transition-colors"
          >
            {saving ? "Unsubscribing..." : "Unsubscribe"}
          </button>
        </div>
      )}

      {message && (
        <p className={`text-sm mt-4 ${message.includes("success") ? "text-emerald-400" : "text-red-400"}`}>
          {message}
        </p>
      )}

      <div className="mt-6 text-xs text-gray-500 space-y-1">
        <p>1. Start a chat with <a href="https://t.me/tradenext6Bot" target="_blank" className="text-blue-400 hover:underline">@tradenext6Bot</a></p>
        <p>2. Send <code className="bg-gray-800 px-1 rounded">/chatid</code> to get your Chat ID</p>
        <p>3. Paste it above and subscribe</p>
      </div>
    </div>
  );
}
