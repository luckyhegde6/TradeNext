"use client";

import { useState, useEffect } from "react";

// ============================================================
// Types
// ============================================================

interface Alert {
  id: string;
  type: string;
  symbol: string | null;
  condition: Record<string, unknown>;
  triggered: boolean;
  triggeredAt: string | null;
  seen: boolean;
  createdAt: string;
  user: { id: number; email: string; name: string | null } | null;
}

interface AlertStats {
  total: number;
  active: number;
  triggered: number;
  byType: { type: string; _count: number }[];
}

interface AlertChannel {
  id: string;
  userId: number;
  type: string;
  name: string;
  config: Record<string, unknown>;
  isActive: boolean;
  lastTestedAt: string | null;
  lastUsedAt: string | null;
  failureCount: number;
  createdAt: string;
}

interface Secret {
  id: string;
  name: string;
  type: string;
  value: string;
  hint: string;
  metadata: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
}

interface AlertEvent {
  id: string;
  ruleId: string;
  channelId: string | null;
  channelType: string;
  status: string;
  error: string | null;
  metadata: Record<string, unknown> | null;
  deliveredAt: string | null;
  attemptedAt: string;
  acknowledgedAt: string | null;
  rule?: { name: string; userId: number; user?: { email: string; name: string | null } | null };
}

// ============================================================
// Tab Components
// ============================================================

function UserAlertsTab() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [stats, setStats] = useState<AlertStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "triggered">("all");

  useEffect(() => { fetchAlerts(); }, []);

  const fetchAlerts = async () => {
    try {
      const res = await fetch("/api/admin/alerts");
      const data = await res.json();
      if (data.alerts) { setAlerts(data.alerts); setStats(data.stats); }
    } catch (e) { console.error("Failed to fetch alerts:", e); }
    finally { setLoading(false); }
  };

  const deleteAlert = async (id: string) => {
    if (!confirm("Are you sure?")) return;
    try {
      await fetch(`/api/admin/alerts?id=${id}`, { method: "DELETE" });
      fetchAlerts();
    } catch (e) { console.error("Failed to delete:", e); }
  };

  const filteredAlerts = alerts.filter((a) => {
    if (filter === "active") return !a.triggered;
    if (filter === "triggered") return a.triggered;
    return true;
  });

  const getAlertTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      price_above: "Price Above", price_below: "Price Below",
      price_jump: "Price Jump", volume_spike: "Volume Spike",
      piotroski_score: "Piotroski Score", portfolio_value: "Portfolio Value",
    };
    return labels[type] || type;
  };

  if (loading) return <div className="flex justify-center p-12"><p>Loading...</p></div>;

  return (
    <div className="space-y-6">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-5">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Total</p>
            <p className="text-2xl font-black text-gray-900 dark:text-white">{stats.total}</p>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-5">
            <p className="text-xs font-bold text-green-600 uppercase tracking-widest">Active</p>
            <p className="text-2xl font-black text-green-600">{stats.active}</p>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-5">
            <p className="text-xs font-bold text-yellow-600 uppercase tracking-widest">Triggered</p>
            <p className="text-2xl font-black text-yellow-600">{stats.triggered}</p>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-5">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">By Type</p>
            <div className="text-xs space-y-0.5">
              {stats.byType.map((t) => (
                <div key={t.type} className="flex justify-between">
                  <span className="text-gray-600 dark:text-slate-400">{getAlertTypeLabel(t.type)}</span>
                  <span className="font-bold">{t._count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Filter + Table */}
      <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">User Alerts</h3>
          <div className="flex bg-gray-100 dark:bg-slate-800 p-0.5 rounded-lg">
            {(["all", "active", "triggered"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                  filter === f
                    ? "bg-white dark:bg-slate-700 text-blue-600 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {filteredAlerts.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No alerts found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">User</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">Symbol</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">Condition</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">Created</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-widest">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAlerts.map((alert) => (
                  <tr key={alert.id} className="border-t border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3">
                      <p className="font-bold text-gray-900 dark:text-white">{alert.user?.name || "Unknown"}</p>
                      <p className="text-xs text-gray-500">{alert.user?.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-400 rounded-full text-[10px] font-bold uppercase">
                        {getAlertTypeLabel(alert.type)}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-bold text-blue-600">{alert.symbol || "-"}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-slate-300">
                      {alert.condition?.threshold ? `₹${alert.condition.threshold}` : ""}
                      {alert.condition?.changePercent ? `${alert.condition.changePercent}%` : ""}
                    </td>
                    <td className="px-4 py-3">
                      {alert.triggered ? (
                        <span className="px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 rounded-full text-[10px] font-bold uppercase">Triggered</span>
                      ) : (
                        <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-800 rounded-full text-[10px] font-bold uppercase">Active</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{new Date(alert.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => deleteAlert(alert.id)} className="text-red-500 hover:text-red-700 text-xs font-bold">Delete</button>
                    </td>
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

// ============================================================
// Delivery Channels Tab
// ============================================================

function DeliveryChannelsTab() {
  const [channels, setChannels] = useState<AlertChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [stats, setStats] = useState<Record<string, number> | null>(null);

  // Telegram env status
  const [tgStatus, setTgStatus] = useState<{
    configured: boolean;
    chatId: string;
    hasBotToken: boolean;
    hasMessageId: boolean;
    botUsername?: string;
    lastVerified?: string;
    error?: string;
  } | null>(null);
  const [tgVerifying, setTgVerifying] = useState(false);

  const [form, setForm] = useState({ name: "", type: "email", config: "", isActive: true });

  useEffect(() => { fetchChannels(); fetchTelegramStatus(); }, []);

  const fetchTelegramStatus = async () => {
    try {
      const res = await fetch("/api/admin/alerts/telegram-status");
      if (res.ok) {
        const data = await res.json();
        setTgStatus(data);
      }
    } catch (e) {
      console.error("Failed to fetch Telegram status:", e);
    }
  };

  const verifyTelegram = async () => {
    setTgVerifying(true);
    try {
      const res = await fetch("/api/admin/alerts/telegram-status?verify=true");
      if (res.ok) {
        const data = await res.json();
        setTgStatus(data);
      }
    } catch (e) {
      console.error("Failed to verify Telegram:", e);
    } finally {
      setTgVerifying(false);
    }
  };

  const fetchChannels = async () => {
    try {
      const res = await fetch("/api/admin/alerts/channels");
      const data = await res.json();
      if (data.channels) { setChannels(data.channels); setStats(data.stats); }
    } catch (e) { console.error("Failed to fetch channels:", e); }
    finally { setLoading(false); }
  };

  const createChannel = async () => {
    try {
      let configObj: Record<string, unknown>;
      try { configObj = JSON.parse(form.config); }
      catch { alert("Invalid JSON in config"); return; }

      const res = await fetch("/api/admin/alerts/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, type: form.type, config: configObj, isActive: form.isActive }),
      });
      if (!res.ok) { const d = await res.json(); alert(d.error); return; }
      setShowForm(false);
      setForm({ name: "", type: "email", config: "", isActive: true });
      fetchChannels();
    } catch (e) { console.error("Failed to create channel:", e); }
  };

  const toggleActive = async (channel: AlertChannel) => {
    try {
      await fetch(`/api/admin/alerts/channels?id=${channel.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !channel.isActive }),
      });
      fetchChannels();
    } catch (e) { console.error("Failed to toggle:", e); }
  };

  const testChannel = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/alerts/channels/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: id }),
      });
      const data = await res.json();
      alert(data.success ? "Test sent successfully!" : `Test failed: ${data.error}`);
      fetchChannels();
    } catch (e) { console.error("Failed to test:", e); }
  };

  const deleteChannel = async (id: string) => {
    if (!confirm("Delete this channel?")) return;
    try {
      await fetch(`/api/admin/alerts/channels?id=${id}`, { method: "DELETE" });
      fetchChannels();
    } catch (e) { console.error("Failed to delete:", e); }
  };

  const channelTypeLabels: Record<string, string> = {
    email: "Email", webhook: "Webhook", telegram: "Telegram", push: "Push", in_app: "In-App",
  };

  if (loading) return <div className="flex justify-center p-12"><p>Loading...</p></div>;

  return (
    <div className="space-y-6">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-4">
            <p className="text-xs font-bold text-gray-500 uppercase">Total</p>
            <p className="text-2xl font-black">{channels.length}</p>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-4">
            <p className="text-xs font-bold text-green-600 uppercase">Active</p>
            <p className="text-2xl font-black text-green-600">{stats.active || 0}</p>
          </div>
          {/* Only render numeric stat entries (filter out objects like byType) */}
          {Object.entries(stats).filter(([k, v]) => typeof v === "number" && k !== "total" && k !== "active" && k !== "systemChannels").map(([type, count]) => (
            <div key={type} className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-4">
              <p className="text-xs font-bold text-gray-500 uppercase">{channelTypeLabels[type] || type}</p>
              <p className="text-2xl font-black">{count}</p>
            </div>
          ))}
        </div>
      )}

      {/* System Telegram Config (from env vars) */}
      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-lg">
              ✈️
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">System Telegram (Env Config)</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Configured via <code className="text-blue-600 dark:text-blue-400 text-[10px] bg-blue-50 dark:bg-blue-900/20 px-1 rounded">TELEGRAM_SECRET</code>, <code className="text-blue-600 dark:text-blue-400 text-[10px] bg-blue-50 dark:bg-blue-900/20 px-1 rounded">TELEGRAM_CHATID</code>{tgStatus?.hasMessageId ? `, ` : ``}{tgStatus?.hasMessageId && <code className="text-blue-600 dark:text-blue-400 text-[10px] bg-blue-50 dark:bg-blue-900/20 px-1 rounded">TELEGRAM_MESSAGEID</code>}
              </p>
            </div>
          </div>
          <button
            onClick={verifyTelegram}
            disabled={tgVerifying}
            className="px-3 py-1.5 text-xs font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {tgVerifying ? "Verifying..." : "Verify & Test"}
          </button>
        </div>

        {tgStatus && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Status</p>
              <p className={`text-sm font-bold mt-0.5 ${
                tgStatus.configured
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              }`}>
                {tgStatus.configured ? "Configured" : "Not Configured"}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Chat ID</p>
              <p className="text-sm font-mono mt-0.5 text-gray-900 dark:text-white">
                {tgStatus.chatId}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Bot Token</p>
              <p className="text-sm font-mono mt-0.5 text-gray-900 dark:text-white">
                {tgStatus.hasBotToken ? "✓ Configured (masked)" : "✗ Missing"}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Message ID</p>
              <p className="text-sm font-mono mt-0.5 text-gray-900 dark:text-white">
                {tgStatus.hasMessageId ? "✓ Set (edit mode)" : "— (send mode)"}
              </p>
            </div>
          </div>
        )}

        {tgStatus?.botUsername && (
          <div className="mt-3 flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
            <span>✓ Bot @{tgStatus.botUsername} verified</span>
            {tgStatus.lastVerified && (
              <span className="text-gray-400">
                at {new Date(tgStatus.lastVerified).toLocaleTimeString()}
              </span>
            )}
          </div>
        )}

        {tgStatus?.error && !tgStatus.configured && (
          <div className="mt-3 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-lg">
            {tgStatus.error}
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Set <code className="text-blue-600 text-[10px]">TELEGRAM_SECRET</code> (bot token) and{' '}
              <code className="text-blue-600 text-[10px]">TELEGRAM_CHATID</code> in your .env file to enable Telegram alerts.
            </p>
          </div>
        )}

        {tgStatus?.error && tgStatus.configured && (
          <div className="mt-3 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
            Verification failed: {tgStatus.error}
          </div>
        )}

        {tgStatus?.configured && !tgStatus.error && (
          <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            This Telegram channel is auto-configured from environment variables and will be used
            as fallback for alert delivery when no explicit Telegram channel is set on a rule.
          </div>
        )}
      </div>

      {/* Add Channel Button */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors"
        >
          {showForm ? "Cancel" : "+ Add Channel"}
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-bold">New Delivery Channel</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm" placeholder="e.g. Admin Email" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm">
                <option value="email">Email (SMTP)</option>
                <option value="webhook">Webhook (Slack/Discord/Generic)</option>
                <option value="telegram">Telegram Bot</option>
                <option value="in_app">In-App Notification</option>
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="rounded border-gray-300" />
                <span className="text-sm font-medium">Active</span>
              </label>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
              Config (JSON)
              <span className="ml-2 text-blue-500 font-normal normal-case">
                {form.type === "email" ? "{ smtpHost, smtpPort, secure, authUser, authPass, fromAddr }" :
                 form.type === "webhook" ? "{ url, format (slack/discord/generic) }" :
                 form.type === "telegram" ? "{ botToken, chatId }" : "{}"}
              </span>
            </label>
            <textarea value={form.config} onChange={(e) => setForm({ ...form, config: e.target.value })}
              rows={4}
              className="w-full px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm font-mono"
              placeholder='{"smtpHost": "smtp.gmail.com", "smtpPort": 587, ...}' />
          </div>
          <button onClick={createChannel} className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700">
            Create Channel
          </button>
        </div>
      )}

      {/* Channels Table */}
      <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-100 dark:border-slate-800">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Delivery Channels ({channels.length})</h3>
        </div>
        {channels.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No channels configured</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Failures</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Last Used</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((ch) => (
                  <tr key={ch.id} className="border-t border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3 font-bold text-gray-900 dark:text-white">{ch.name}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/40 text-purple-800 rounded-full text-[10px] font-bold uppercase">
                        {channelTypeLabels[ch.type] || ch.type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => toggleActive(ch)} className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        ch.isActive
                          ? "bg-green-100 text-green-800 hover:bg-green-200"
                          : "bg-red-100 text-red-800 hover:bg-red-200"
                      }`}>
                        {ch.isActive ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`font-bold ${ch.failureCount > 5 ? "text-red-600" : "text-gray-600"}`}>
                        {ch.failureCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {ch.lastUsedAt ? new Date(ch.lastUsedAt).toLocaleString() : "Never"}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button onClick={() => testChannel(ch.id)} className="text-blue-600 hover:text-blue-800 text-xs font-bold">Test</button>
                      <button onClick={() => deleteChannel(ch.id)} className="text-red-500 hover:text-red-700 text-xs font-bold">Delete</button>
                    </td>
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

// ============================================================
// Secrets Tab
// ============================================================

function SecretsTab() {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showValues, setShowValues] = useState(false);

  const [form, setForm] = useState({ name: "", type: "smtp_password", value: "", hint: "" });

  useEffect(() => { fetchSecrets(); }, []);

  const fetchSecrets = async () => {
    try {
      const res = await fetch(`/api/admin/alerts/secrets?showValue=${showValues}`);
      const data = await res.json();
      if (data.secrets) setSecrets(data.secrets);
    } catch (e) { console.error("Failed to fetch secrets:", e); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchSecrets(); }, [showValues]);

  const createSecret = async () => {
    try {
      const res = await fetch("/api/admin/alerts/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) { const d = await res.json(); alert(d.error); return; }
      setShowForm(false);
      setForm({ name: "", type: "smtp_password", value: "", hint: "" });
      fetchSecrets();
    } catch (e) { console.error("Failed to create:", e); }
  };

  const deleteSecret = async (id: string) => {
    if (!confirm("Delete this secret?")) return;
    try {
      await fetch(`/api/admin/alerts/secrets?id=${id}`, { method: "DELETE" });
      fetchSecrets();
    } catch (e) { console.error("Failed to delete:", e); }
  };

  const typeLabels: Record<string, string> = {
    smtp_password: "SMTP Password", api_key: "API Key",
    bot_token: "Bot Token", webhook_secret: "Webhook Secret",
  };

  if (loading) return <div className="flex justify-center p-12"><p>Loading...</p></div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <p className="text-sm text-gray-500">{secrets.length} secrets stored (AES-256-GCM encrypted)</p>
        </div>
        <div className="flex gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showValues} onChange={(e) => setShowValues(e.target.checked)} />
            Show Values
          </label>
          <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700">
            {showForm ? "Cancel" : "+ Add Secret"}
          </button>
        </div>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-bold">New Encrypted Secret</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Name (unique key)</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="smtp_gmail" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="smtp_password">SMTP Password</option>
                <option value="api_key">API Key</option>
                <option value="bot_token">Bot Token</option>
                <option value="webhook_secret">Webhook Secret</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Value (will be encrypted)</label>
            <input value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} type="password"
              className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Enter secret value..." />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Hint (masked preview)</label>
            <input value={form.hint} onChange={(e) => setForm({ ...form, hint: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="app***@gmail.com" />
          </div>
          <button onClick={createSecret} className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700">
            Encrypt & Save
          </button>
        </div>
      )}

      {/* Secrets Table */}
      <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-800/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Value</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Created</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {secrets.map((s) => (
                <tr key={s.id} className="border-t border-gray-100 dark:border-slate-800 hover:bg-gray-50">
                  <td className="px-4 py-3 font-bold text-gray-900 dark:text-white">{s.name}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-[10px] font-bold uppercase">
                      {typeLabels[s.type] || s.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">
                    {showValues ? s.value : s.hint || "****"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      s.isActive !== false ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                    }`}>
                      {s.isActive !== false ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{new Date(s.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => deleteSecret(s.id)} className="text-red-500 hover:text-red-700 text-xs font-bold">Delete</button>
                  </td>
                </tr>
              ))}
              {secrets.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No secrets stored</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Delivery Logs Tab
// ============================================================

function DeliveryLogsTab() {
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [hours, setHours] = useState(48);
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => { fetchEvents(); }, [hours, statusFilter]);

  const fetchEvents = async () => {
    try {
      const params = new URLSearchParams({ hours: String(hours), limit: "100" });
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/admin/alerts/events?${params}`);
      const data = await res.json();
      if (data.events) { setEvents(data.events); setTotal(data.total); setStats(data.stats); }
    } catch (e) { console.error("Failed to fetch events:", e); }
    finally { setLoading(false); }
  };

  const acknowledgeEvent = async (id: string) => {
    try {
      await fetch(`/api/alerts/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: id, acknowledge: true }),
      });
      fetchEvents();
    } catch (e) { console.error("Failed to acknowledge:", e); }
  };

  const statusColors: Record<string, string> = {
    delivered: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
    pending: "bg-yellow-100 text-yellow-800",
  };

  if (loading) return <div className="flex justify-center p-12"><p>Loading...</p></div>;

  return (
    <div className="space-y-6">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-4">
            <p className="text-xs font-bold text-gray-500 uppercase">Total Events ({hours}h)</p>
            <p className="text-2xl font-black">{total}</p>
          </div>
          {Object.entries(stats.byStatus || {}).map(([status, count]) => (
            <div key={status} className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-4">
              <p className={`text-xs font-bold uppercase ${status === "delivered" ? "text-green-600" : status === "failed" ? "text-red-600" : "text-yellow-600"}`}>
                {status}
              </p>
              <p className={`text-2xl font-black ${status === "delivered" ? "text-green-600" : status === "failed" ? "text-red-600" : "text-yellow-600"}`}>
                {count}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-4 items-center">
        <div>
          <label className="text-xs font-bold text-gray-500 uppercase mr-2">Time Window</label>
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))}
            className="px-3 py-1.5 border rounded-lg text-sm">
            <option value={1}>Last 1 hour</option>
            <option value={6}>Last 6 hours</option>
            <option value={24}>Last 24 hours</option>
            <option value={48}>Last 48 hours</option>
            <option value={168}>Last 7 days</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-bold text-gray-500 uppercase mr-2">Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 border rounded-lg text-sm">
            <option value="">All</option>
            <option value="delivered">Delivered</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
          </select>
        </div>
        <button onClick={fetchEvents} className="px-4 py-1.5 bg-gray-200 dark:bg-slate-700 rounded-lg text-sm font-bold hover:bg-gray-300">
          Refresh
        </button>
      </div>

      {/* Events Table */}
      <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-100 dark:border-slate-800">
          <h3 className="text-lg font-bold">Delivery Events</h3>
        </div>
        {events.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No delivery events in this time window</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Rule</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Channel</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Error</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Delivered At</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id} className="border-t border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(ev.attemptedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-bold text-gray-900 dark:text-white">{ev.rule?.name || ev.ruleId}</p>
                      {ev.rule?.user && (
                        <p className="text-xs text-gray-500">{ev.rule.user.name || ev.rule.user.email}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-purple-100 text-purple-800 rounded-full text-[10px] font-bold uppercase">
                        {ev.channelType}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${statusColors[ev.status] || "bg-gray-100"}`}>
                        {ev.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-red-600 max-w-[200px] truncate">
                      {ev.error || "-"}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {ev.deliveredAt ? new Date(ev.deliveredAt).toLocaleString() : "-"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {ev.status === "failed" && (
                        <button onClick={() => acknowledgeEvent(ev.id)} className="text-blue-600 hover:text-blue-800 text-xs font-bold">
                          Acknowledge
                        </button>
                      )}
                      {ev.status === "delivered" && !ev.acknowledgedAt && (
                        <button onClick={() => acknowledgeEvent(ev.id)} className="text-gray-500 hover:text-gray-700 text-xs font-bold">
                          Dismiss
                        </button>
                      )}
                    </td>
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

// ============================================================
// Telegram Subscribers Tab
// ============================================================

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

interface TelegramStats {
  totalSubscribers: number;
  activeSubscribers: number;
  inactiveSubscribers: number;
  totalTelegramEvents: number;
  totalAIEvents: number;
  recentSubscribers: { id: string; userId: number; chatId: string; isActive: boolean; createdAt: string }[];
}

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

function TelegramSubscribersTab() {
  const [stats, setStats] = useState<TelegramStats | null>(null);
  const [subscribers, setSubscribers] = useState<TelegramSubscriber[]>([]);
  const [deliveries, setDeliveries] = useState<TelegramDelivery[]>([]);
  const [calls, setCalls] = useState<TelegramDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [subSection, setSubSection] = useState<"overview" | "subscribers" | "deliveries" | "calls">("overview");

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [statsRes, subsRes, delRes, callsRes] = await Promise.all([
        fetch("/api/admin/alerts/telegram?section=stats"),
        fetch("/api/admin/alerts/telegram?section=subscribers&limit=200"),
        fetch("/api/admin/alerts/telegram?section=deliveries&limit=100"),
        fetch("/api/admin/alerts/telegram?section=calls&limit=100"),
      ]);

      if (statsRes.ok) setStats(await statsRes.json());
      if (subsRes.ok) { const d = await subsRes.json(); setSubscribers(d.subscribers || []); }
      if (delRes.ok) { const d = await delRes.json(); setDeliveries(d.deliveries || []); }
      if (callsRes.ok) { const d = await callsRes.json(); setCalls(d.calls || []); }
    } catch (e) { console.error("Failed to fetch Telegram data:", e); }
    finally { setLoading(false); }
  };

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

  if (loading) return <div className="flex justify-center p-12"><p>Loading Telegram data...</p></div>;

  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
      <div className="flex flex-wrap gap-1 bg-gray-100 dark:bg-slate-800 p-1 rounded-lg">
        {(["overview", "subscribers", "deliveries", "calls"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSubSection(s)}
            className={`px-4 py-2 rounded-md text-xs font-bold transition-all ${
              subSection === s
                ? "bg-white dark:bg-slate-700 text-blue-600 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Overview */}
      {subSection === "overview" && stats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-5">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Total Subscribers</p>
              <p className="text-2xl font-black text-gray-900 dark:text-white">{stats.totalSubscribers}</p>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-5">
              <p className="text-xs font-bold text-green-600 uppercase tracking-widest">Active</p>
              <p className="text-2xl font-black text-green-600">{stats.activeSubscribers}</p>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-5">
              <p className="text-xs font-bold text-blue-600 uppercase tracking-widest">Telegram Events</p>
              <p className="text-2xl font-black text-blue-600">{stats.totalTelegramEvents}</p>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-5">
              <p className="text-xs font-bold text-purple-600 uppercase tracking-widest">AI Agent Events</p>
              <p className="text-2xl font-black text-purple-600">{stats.totalAIEvents}</p>
            </div>
          </div>

          {/* Recent subscribers */}
          {stats.recentSubscribers.length > 0 && (
            <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-gray-100 dark:border-slate-800">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">Recent Subscribers</h3>
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
        </>
      )}

      {/* Subscribers list */}
      {subSection === "subscribers" && (
        <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">All Telegram Subscribers ({subscribers.length})</h3>
            <button onClick={fetchAll} className="px-3 py-1.5 text-xs font-bold bg-gray-200 dark:bg-slate-700 rounded-lg hover:bg-gray-300">
              Refresh
            </button>
          </div>
          {subscribers.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No Telegram subscribers yet</div>
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
                  {subscribers.map((s) => (
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
      )}

      {/* Deliveries */}
      {subSection === "deliveries" && (
        <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-gray-100 dark:border-slate-800">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">Telegram Delivery Events ({deliveries.length})</h3>
          </div>
          {deliveries.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No Telegram delivery events yet</div>
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
                  {deliveries.map((d) => (
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
      )}

      {/* AI Calls */}
      {subSection === "calls" && (
        <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-gray-100 dark:border-slate-800">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">AI Agent Call Log ({calls.length})</h3>
          </div>
          {calls.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No AI agent calls yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-800/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Time</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">User</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Metadata</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map((c) => (
                    <tr key={c.id} className="border-t border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{new Date(c.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${actionColors[c.action] || "bg-gray-100"}`}>
                          {actionLabels[c.action] || c.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300">{c.userEmail || "-"}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 max-w-[300px] truncate">
                        {c.metadata ? JSON.stringify(c.metadata).substring(0, 100) : "-"}
                      </td>
                      <td className="px-4 py-3 text-xs text-red-600 max-w-[200px] truncate">{c.errorMessage || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Main Page
// ============================================================

type TabKey = "alerts" | "channels" | "secrets" | "logs" | "telegram";

const TABS: { key: TabKey; label: string; desc: string }[] = [
  { key: "alerts", label: "User Alerts", desc: "Monitor and manage user price alerts" },
  { key: "channels", label: "Delivery Channels", desc: "Email, Webhook, Telegram config" },
  { key: "secrets", label: "Secrets", desc: "Encrypted credential storage" },
  { key: "logs", label: "Delivery Logs", desc: "Delivery event tracking & observability" },
  { key: "telegram", label: "Telegram", desc: "Subscribers, delivery logs, AI calls" },
];

export default function AdminAlertsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("alerts");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            Alert Management
          </h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1 font-medium">
            Alerts config, delivery channels, secrets, and event observability
          </p>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 bg-gray-100 dark:bg-slate-800 p-1 rounded-xl">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${
                activeTab === tab.key
                  ? "bg-white dark:bg-slate-700 text-blue-600 dark:text-white shadow-sm"
                  : "text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === "alerts" && <UserAlertsTab />}
        {activeTab === "channels" && <DeliveryChannelsTab />}
        {activeTab === "secrets" && <SecretsTab />}
        {activeTab === "logs" && <DeliveryLogsTab />}
        {activeTab === "telegram" && <TelegramSubscribersTab />}
      </div>
    </div>
  );
}
