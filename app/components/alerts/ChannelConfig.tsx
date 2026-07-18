"use client";

import { useState, useEffect, useCallback } from "react";

type ChannelType = "email" | "webhook";

interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  config: Record<string, any>;
  isActive: boolean;
  createdAt: string;
}

const CHANNEL_ICONS: Record<ChannelType, string> = {
  email: "📧",
  webhook: "🔗",
};

const WEBHOOK_FORMATS = [
  { value: "generic", label: "Generic JSON" },
  { value: "slack", label: "Slack" },
  { value: "discord", label: "Discord" },
];

export default function ChannelConfig() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  // Form state
  const [formType, setFormType] = useState<ChannelType>("email");
  const [formName, setFormName] = useState("");
  const [formHost, setFormHost] = useState("");
  const [formPort, setFormPort] = useState("587");
  const [formUser, setFormUser] = useState("");
  const [formPass, setFormPass] = useState("");
  const [formFrom, setFormFrom] = useState("");
  const [formTo, setFormTo] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formFormat, setFormFormat] = useState("generic");

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts/channels");
      if (!res.ok) throw new Error("Failed to fetch channels");
      const data = await res.json();
      setChannels(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load channels");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  const resetForm = () => {
    setFormType("email");
    setFormName("");
    setFormHost("");
    setFormPort("587");
    setFormUser("");
    setFormPass("");
    setFormFrom("");
    setFormTo("");
    setFormUrl("");
    setFormFormat("generic");
  };

  const openNewForm = (type: ChannelType) => {
    setEditingChannel(null);
    resetForm();
    setFormType(type);
    setShowForm(true);
  };

  const openEditForm = (ch: Channel) => {
    setEditingChannel(ch);
    setFormType(ch.type);
    setFormName(ch.name);
    setShowForm(true);

    if (ch.type === "email") {
      const c = ch.config;
      setFormHost(c.host || "");
      setFormPort(String(c.port || "587"));
      setFormUser(c.user || "");
      setFormPass(c.pass || "");
      setFormFrom(c.from || "");
      setFormTo(c.to || "");
    } else if (ch.type === "webhook") {
      const c = ch.config;
      setFormUrl(c.url || "");
      setFormFormat(c.format || "generic");
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingChannel(null);
    resetForm();
  };

  const buildConfig = (): Record<string, any> => {
    if (formType === "email") {
      return {
        host: formHost,
        port: parseInt(formPort) || 587,
        user: formUser,
        pass: formPass,
        from: formFrom,
        to: formTo,
      };
    }
    return {
      url: formUrl,
      format: formFormat,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const payload = {
        type: formType,
        name: formName,
        config: buildConfig(),
      };

      const url = editingChannel ? `/api/alerts/channels/${editingChannel.id}` : "/api/alerts/channels";
      const method = editingChannel ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || `Failed to ${editingChannel ? "update" : "create"} channel`);
      }

      closeForm();
      fetchChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleChannel = async (ch: Channel) => {
    try {
      const res = await fetch(`/api/alerts/channels/${ch.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !ch.isActive }),
      });
      if (res.ok) fetchChannels();
    } catch (err) {
      console.error("Failed to toggle channel:", err);
    }
  };

  const deleteChannel = async (ch: Channel) => {
    if (!confirm(`Delete channel "${ch.name}"?`)) return;
    try {
      const res = await fetch(`/api/alerts/channels/${ch.id}`, { method: "DELETE" });
      if (res.ok) fetchChannels();
    } catch (err) {
      console.error("Failed to delete channel:", err);
    }
  };

  const testChannel = async (ch: Channel) => {
    setTesting(ch.id);
    try {
      const res = await fetch(`/api/alerts/channels/${ch.id}/test`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        alert("✅ Test sent successfully! Check your channel.");
      } else {
        alert(`❌ Test failed: ${data.error || "Unknown error"}`);
      }
    } catch (err) {
      alert("❌ Test request failed");
    } finally {
      setTesting(null);
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Loading channels...</div>;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-muted-foreground">
          {channels.filter((c) => c.isActive).length} active of {channels.length} channels
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => openNewForm("email")}
            className="px-3 py-1.5 text-sm border border-border rounded hover:bg-muted"
          >
            + Email Channel
          </button>
          <button
            onClick={() => openNewForm("webhook")}
            className="px-3 py-1.5 text-sm border border-border rounded hover:bg-muted"
          >
            + Webhook Channel
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-10 pb-10 bg-black/40 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-border w-full max-w-lg mx-4">
            <div className="border-b border-border px-6 py-4 flex justify-between items-center">
              <h3 className="text-lg font-semibold">
                {editingChannel ? "Edit Channel" : `New ${formType === "email" ? "Email" : "Webhook"} Channel`}
              </h3>
              <button onClick={closeForm} className="text-muted-foreground hover:text-foreground text-xl">&times;</button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium mb-1">Channel Name *</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={formType === "email" ? "e.g., My Email" : "e.g., Slack Alerts"}
                  className="w-full p-2 border border-border rounded bg-background text-sm"
                />
              </div>

              {/* Type selector */}
              <div>
                <label className="block text-sm font-medium mb-1">Type</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setFormType("email")}
                    className={`flex-1 py-2 border rounded text-sm ${
                      formType === "email" ? "border-primary bg-primary/5 text-primary" : "border-border"
                    }`}
                  >
                    📧 Email (SMTP)
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormType("webhook")}
                    className={`flex-1 py-2 border rounded text-sm ${
                      formType === "webhook" ? "border-primary bg-primary/5 text-primary" : "border-border"
                    }`}
                  >
                    🔗 Webhook
                  </button>
                </div>
              </div>

              {/* Email fields */}
              {formType === "email" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">SMTP Host *</label>
                      <input
                        type="text"
                        required
                        value={formHost}
                        onChange={(e) => setFormHost(e.target.value)}
                        placeholder="smtp.gmail.com"
                        className="w-full p-2 border border-border rounded bg-background text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Port</label>
                      <input
                        type="number"
                        value={formPort}
                        onChange={(e) => setFormPort(e.target.value)}
                        placeholder="587"
                        className="w-full p-2 border border-border rounded bg-background text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">Username *</label>
                      <input
                        type="text"
                        required
                        value={formUser}
                        onChange={(e) => setFormUser(e.target.value)}
                        placeholder="your@email.com"
                        className="w-full p-2 border border-border rounded bg-background text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Password *</label>
                      <input
                        type="password"
                        required={!editingChannel}
                        value={formPass}
                        onChange={(e) => setFormPass(e.target.value)}
                        placeholder="App password"
                        className="w-full p-2 border border-border rounded bg-background text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">From Address *</label>
                      <input
                        type="email"
                        required
                        value={formFrom}
                        onChange={(e) => setFormFrom(e.target.value)}
                        placeholder="alerts@example.com"
                        className="w-full p-2 border border-border rounded bg-background text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">To Address *</label>
                      <input
                        type="email"
                        required
                        value={formTo}
                        onChange={(e) => setFormTo(e.target.value)}
                        placeholder="you@example.com"
                        className="w-full p-2 border border-border rounded bg-background text-sm"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Webhook fields */}
              {formType === "webhook" && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">Webhook URL *</label>
                    <input
                      type="url"
                      required
                      value={formUrl}
                      onChange={(e) => setFormUrl(e.target.value)}
                      placeholder="https://hooks.slack.com/services/..."
                      className="w-full p-2 border border-border rounded bg-background text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Format</label>
                    <select
                      value={formFormat}
                      onChange={(e) => setFormFormat(e.target.value)}
                      className="w-full p-2 border border-border rounded bg-background text-sm"
                    >
                      {WEBHOOK_FORMATS.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2 bg-primary text-white rounded hover:bg-primary/90 disabled:opacity-50 text-sm font-medium"
                >
                  {saving ? "Saving..." : editingChannel ? "Update Channel" : "Create Channel"}
                </button>
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-4 py-2 border border-border rounded hover:bg-muted text-sm"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Channel list */}
      {channels.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg mb-2">No delivery channels yet</p>
          <p className="text-sm">Add an email or webhook channel to receive alert notifications</p>
        </div>
      ) : (
        <div className="space-y-3">
          {channels.map((ch) => (
            <div
              key={ch.id}
              className={`bg-card border rounded-lg p-4 ${
                ch.isActive ? "" : "opacity-60"
              }`}
            >
              <div className="flex justify-between items-start">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{CHANNEL_ICONS[ch.type]}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{ch.name}</span>
                      <span className="px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 rounded uppercase">
                        {ch.type}
                      </span>
                      {!ch.isActive && (
                        <span className="px-1.5 py-0.5 text-xs bg-yellow-100 text-yellow-700 rounded">
                          Disabled
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {ch.type === "email"
                        ? `${ch.config.from || "?"} → ${ch.config.to || "?"}`
                        : `${ch.config.format || "generic"} — ${ch.config.url?.substring(0, 60) || "?"}...`
                      }
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Created: {new Date(ch.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => testChannel(ch)}
                    disabled={testing === ch.id}
                    className="px-2 py-1 text-xs border border-border rounded hover:bg-muted disabled:opacity-50"
                  >
                    {testing === ch.id ? "Sending..." : "Test"}
                  </button>
                  <button
                    onClick={() => {
                      const updated = { ...ch, isActive: !ch.isActive };
                      toggleChannel(ch);
                    }}
                    className="px-2 py-1 text-xs border border-border rounded hover:bg-muted"
                  >
                    {ch.isActive ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => openEditForm(ch)}
                    className="text-blue-600 hover:text-blue-800 text-sm"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteChannel(ch)}
                    className="text-red-600 hover:text-red-800 text-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
