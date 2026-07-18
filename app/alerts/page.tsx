"use client";

import { useState, lazy, Suspense, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import Autocomplete from "@/app/components/ui/Autocomplete";
import RuleList from "@/app/components/alerts/RuleList";
import ChannelConfig from "@/app/components/alerts/ChannelConfig";
import EventHistory from "@/app/components/alerts/EventHistory";
import AiActionButton from "@/app/components/AiActionButton";
import TelegramSubscription from "@/app/components/alerts/TelegramSubscription";

// ============================================================
// Types
// ============================================================

interface Alert {
  id: string;
  type: string;
  symbol?: string;
  condition: {
    threshold?: number;
    changePercent?: number;
    direction?: string;
    minDividend?: number;
    triggeredAction?: string;
    exDate?: string;
    purpose?: string;
  };
  triggered: boolean;
  triggeredAt?: string;
  seen: boolean;
  createdAt: string;
  currentPrice?: number;
}

const ALERT_TYPES = [
  { value: "price_above", label: "Price Above", description: "Alert when price goes above target" },
  { value: "price_below", label: "Price Below", description: "Alert when price drops below target" },
  { value: "price_jump", label: "Price Jump", description: "Alert on significant price change" },
  { value: "volume_spike", label: "Volume Spike", description: "Alert on unusual trading volume" },
  // Corporate Action Alerts
  { value: "dividend_alert", label: "Dividend Alert", description: "Alert when dividend is announced" },
  { value: "bonus_alert", label: "Bonus Alert", description: "Alert when bonus shares are announced" },
  { value: "split_alert", label: "Stock Split Alert", description: "Alert when stock split is announced" },
  { value: "rights_alert", label: "Rights Issue Alert", description: "Alert when rights issue is announced" },
  { value: "buyback_alert", label: "Buyback Alert", description: "Alert when buyback is announced" },
  { value: "meeting_alert", label: "Meeting/AGM Alert", description: "Alert for shareholder meetings" },
] as const;

// ============================================================
// Tabs
// ============================================================

type Tab = "simple-alerts" | "rules" | "channels" | "events" | "telegram";

const TABS: { key: Tab; label: string }[] = [
  { key: "simple-alerts", label: "My Alerts" },
  { key: "rules", label: "Alert Rules" },
  { key: "channels", label: "Channels" },
  { key: "events", label: "Event History" },
  { key: "telegram", label: "Telegram Bot" },
];

// ============================================================
// Simple Alerts Tab (existing legacy alerts)
// ============================================================

function SimpleAlertsTab() {
  const { data: session } = useSession();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingAlert, setEditingAlert] = useState<Alert | null>(null);
  const [formData, setFormData] = useState({
    type: "price_above",
    symbol: "",
    threshold: "",
    changePercent: "",
    minDividend: "",
  });
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [alertPrices, setAlertPrices] = useState<Record<string, number>>({});

  // AI Analysis state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiRateLimit, setAiRateLimit] = useState<{ remaining: number; limit: number } | null>(null);
  const [showAiAnalysis, setShowAiAnalysis] = useState(false);

  useEffect(() => {
    if (session) {
      fetchAlerts();
      checkAlertsRealTime();
    }
  }, [session]);

  const checkAlertsRealTime = async () => {
    try {
      await fetch("/api/alerts/check", { method: "POST" });
    } catch (error) {
      console.error("Real-time alert check failed:", error);
    }
  };

  const fetchAlerts = async () => {
    try {
      const res = await fetch("/api/alerts");
      const data = await res.json();
      setAlerts(data);
      const symbols = [...new Set(data.filter((a: Alert) => a.symbol).map((a: Alert) => a.symbol))] as string[];
      fetchAlertPrices(symbols);
    } catch (error) {
      console.error("Failed to fetch alerts:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAlertPrices = async (symbols: string[]) => {
    const prices: Record<string, number> = {};
    for (const symbol of symbols) {
      try {
        const res = await fetch(`/api/nse/stock/${symbol}/quote`);
        if (res.ok) {
          const data = await res.json();
          if (data.lastPrice) {
            prices[symbol] = parseFloat(data.lastPrice);
          }
        }
      } catch (error) {
        console.error(`Failed to fetch price for ${symbol}:`, error);
      }
    }
    setAlertPrices(prices);
  };

  const createAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const condition: Record<string, any> = {};
      if (formData.type === "price_above" || formData.type === "price_below") {
        if (formData.threshold) condition.threshold = parseFloat(formData.threshold);
      } else if (formData.type === "price_jump" || formData.type === "volume_spike") {
        if (formData.changePercent) condition.changePercent = parseFloat(formData.changePercent);
      } else if (formData.type === "dividend_alert") {
        if (formData.minDividend) condition.minDividend = parseFloat(formData.minDividend);
      }

      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: formData.type,
          symbol: formData.symbol.toUpperCase(),
          condition,
        }),
      });

      if (res.ok) {
        setShowForm(false);
        setFormData({ type: "price_above", symbol: "", threshold: "", changePercent: "", minDividend: "" });
        fetchAlerts();
      }
    } catch (error) {
      console.error("Failed to create alert:", error);
    }
  };

  const updateAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAlert) return;
    try {
      const condition: Record<string, number> = {};
      if (formData.threshold) condition.threshold = parseFloat(formData.threshold);
      if (formData.changePercent) condition.changePercent = parseFloat(formData.changePercent);

      const res = await fetch(`/api/alerts?action=update&id=${editingAlert.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: formData.type,
          symbol: formData.symbol.toUpperCase(),
          condition,
        }),
      });

      if (res.ok) {
        setEditingAlert(null);
        setFormData({ type: "price_above", symbol: "", threshold: "", changePercent: "", minDividend: "" });
        fetchAlerts();
      }
    } catch (error) {
      console.error("Failed to update alert:", error);
    }
  };

  const handleEdit = (alert: Alert) => {
    setEditingAlert(alert);
    setFormData({
      type: alert.type,
      symbol: alert.symbol || "",
      threshold: alert.condition.threshold?.toString() || "",
      changePercent: alert.condition.changePercent?.toString() || "",
      minDividend: alert.condition.minDividend?.toString() || "",
    });
  };

  const deleteAlert = async (id: string) => {
    try {
      await fetch(`/api/alerts?action=delete&id=${id}`, { method: "DELETE" });
      fetchAlerts();
    } catch (error) {
      console.error("Failed to delete alert:", error);
    }
  };

  const markAllSeen = async () => {
    try {
      await fetch("/api/alerts?action=markAllSeen", { method: "POST" });
      fetchAlerts();
    } catch (error) {
      console.error("Failed to mark alerts seen:", error);
    }
  };

  // ─── AI Alert Analysis ─────────────────────────────────────────────────
  const analyzeAlertsWithAI = useCallback(async (): Promise<{ remaining: number | null; limit: number | null }> => {
    const triggeredAlerts = alerts.filter(a => a.triggered);
    if (triggeredAlerts.length === 0) {
      setAiError("No triggered alerts to analyze.");
      setShowAiAnalysis(true);
      return { remaining: null, limit: null };
    }

    setAiLoading(true);
    setAiResult(null);
    setAiError(null);
    setAiRateLimit(null);
    setShowAiAnalysis(true);

    let remaining: number | null = null;
    let limit: number | null = null;

    try {
      const alertSummary = triggeredAlerts.map(a =>
        `${a.symbol || "Any"} - ${a.type} (Threshold: ${a.condition.threshold || a.condition.changePercent || "N/A"})`
      ).join("\n");

      const query = `Here are my triggered stock alerts. Analyze them and provide recommendations:\n\n${alertSummary}\n\nFor each alert, explain what might be happening and what action to consider. Also highlight any patterns across multiple alerts.`;

      const res = await fetch("/api/ai/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, analysisType: "alert" }),
      });

      // Read rate limit headers
      remaining = parseInt(res.headers.get("X-RateLimit-Remaining") || "", 10) || null;
      limit = parseInt(res.headers.get("X-RateLimit-Limit") || "", 10) || null;
      if (remaining !== null && limit !== null) {
        setAiRateLimit({ remaining, limit });
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data.success && data.data?.analysis) {
        setAiResult(data.data.analysis);
      } else if (data.data?.filteredAnalysis) {
        setAiResult(data.data.filteredAnalysis);
      } else {
        setAiResult(data.analysis || "No analysis returned.");
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiLoading(false);
    }
    return { remaining, limit };
  }, [alerts]);

  const getAlertTypeLabel = (type: string) => {
    return ALERT_TYPES.find((t) => t.value === type)?.label || type;
  };

  const fetchCurrentPrice = async (symbol: string) => {
    if (!symbol) {
      setCurrentPrice(null);
      return;
    }
    setPriceLoading(true);
    try {
      const res = await fetch(`/api/nse/stock/${symbol}/quote`);
      if (res.ok) {
        const data = await res.json();
        setCurrentPrice(data.lastPrice ? parseFloat(data.lastPrice) : null);
      } else {
        setCurrentPrice(null);
      }
    } catch {
      setCurrentPrice(null);
    } finally {
      setPriceLoading(false);
    }
  };

  const handleSymbolSelect = (symbol: string) => {
    setFormData({ ...formData, symbol });
    fetchCurrentPrice(symbol);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingAlert(null);
    setFormData({ type: "price_above", symbol: "", threshold: "", changePercent: "", minDividend: "" });
    setCurrentPrice(null);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold">Simple Price & Corporate Action Alerts</h2>
              <div className="flex gap-2">
                <button
                  onClick={markAllSeen}
                  className="px-3 py-1.5 text-sm border border-border rounded hover:bg-muted"
                >
                  Mark All Seen
                </button>
                <AiActionButton onClick={analyzeAlertsWithAI} size="small">
                  Analyze with AI
                </AiActionButton>
                <button
                  onClick={() => setShowForm(!showForm)}
                  className="px-3 py-1.5 text-sm bg-primary text-white rounded hover:bg-primary/90"
                >
                  {showForm ? "Cancel" : "Create Alert"}
                </button>
              </div>
      </div>

      {/* AI Analysis Results */}
      {showAiAnalysis && (
        <div className="bg-card border border-border rounded-lg p-4 mb-6">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold">AI Alert Analysis</h3>
            <button
              onClick={() => { setShowAiAnalysis(false); setAiResult(null); setAiError(null); }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Dismiss
            </button>
          </div>

          {aiRateLimit && (
            <div className={`text-xs mb-3 px-3 py-1.5 rounded ${
              aiRateLimit.remaining > 0
                ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400"
                : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
            }`}>
              {aiRateLimit.remaining > 0
                ? `Rate limit: ${aiRateLimit.remaining} of ${aiRateLimit.limit} requests remaining`
                : `Rate limit reached (${aiRateLimit.limit}/${aiRateLimit.limit}). Please wait.`}
            </div>
          )}

          {aiLoading && (
            <div className="flex items-center justify-center py-6">
              <div className="text-center">
                <div className="animate-spin h-6 w-6 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">Analyzing alerts...</p>
              </div>
            </div>
          )}

          {aiError && !aiLoading && (
            <div className="text-center py-4">
              <p className="text-sm text-red-500 mb-2">{aiError}</p>
              <button
                onClick={analyzeAlertsWithAI}
                className="text-xs text-purple-600 hover:underline"
              >
                Retry
              </button>
            </div>
          )}

          {aiResult && !aiLoading && (
            <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
              {aiResult}
            </div>
          )}
        </div>
      )}

      {(showForm || editingAlert) && (
        <div className="bg-card border border-border rounded-lg p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">{editingAlert ? "Edit Alert" : "New Alert"}</h3>
          <form onSubmit={editingAlert ? updateAlert : createAlert} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Alert Type</label>
              <select
                className="w-full p-2 border border-border rounded bg-background"
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
              >
                {ALERT_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label} - {type.description}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Stock Symbol{" "}
                {["dividend_alert", "bonus_alert", "split_alert", "rights_alert", "buyback_alert", "meeting_alert"].includes(formData.type) && (
                  <span className="text-muted-foreground">(Optional - leave empty for any)</span>
                )}
              </label>
              <Autocomplete
                onSelect={handleSymbolSelect}
                placeholder={
                  ["dividend_alert", "bonus_alert", "split_alert", "rights_alert", "buyback_alert", "meeting_alert"].includes(formData.type)
                    ? "Leave empty for any stock"
                    : "e.g., RELIANCE"
                }
                initialValue={formData.symbol}
              />
              {formData.symbol && (
                <div className="mt-2 text-sm">
                  {priceLoading ? (
                    <span className="text-muted-foreground">Loading price...</span>
                  ) : currentPrice !== null ? (
                    <span className="text-green-600 font-medium">
                      Current Price: ₹{currentPrice.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Price not available</span>
                  )}
                </div>
              )}
            </div>

            {(formData.type === "price_above" || formData.type === "price_below") && (
              <div>
                <label className="block text-sm font-medium mb-1">Target Price (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="e.g., 1500.00"
                  className="w-full p-2 border border-border rounded bg-background"
                  value={formData.threshold}
                  onChange={(e) => setFormData({ ...formData, threshold: e.target.value })}
                  required
                />
              </div>
            )}

            {(formData.type === "price_jump" || formData.type === "volume_spike") && (
              <div>
                <label className="block text-sm font-medium mb-1">
                  {formData.type === "price_jump" ? "Change %" : "Volume Multiplier"}
                </label>
                <input
                  type="number"
                  step="0.1"
                  placeholder={formData.type === "price_jump" ? "e.g., 5" : "e.g., 3"}
                  className="w-full p-2 border border-border rounded bg-background"
                  value={formData.changePercent}
                  onChange={(e) => setFormData({ ...formData, changePercent: e.target.value })}
                  required
                />
              </div>
            )}

            {formData.type === "dividend_alert" && (
              <div>
                <label className="block text-sm font-medium mb-1">Minimum Dividend (₹) - Optional</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="e.g., 5.00"
                  className="w-full p-2 border border-border rounded bg-background"
                  value={formData.minDividend || ""}
                  onChange={(e) => setFormData({ ...formData, minDividend: e.target.value })}
                />
                <p className="text-xs text-muted-foreground mt-1">Leave empty to get alerts for any dividend</p>
              </div>
            )}

            <div className="flex gap-2">
              <button type="submit" className="flex-1 py-2 bg-primary text-white rounded hover:bg-primary/90">
                {editingAlert ? "Update Alert" : "Create Alert"}
              </button>
              <button type="button" onClick={closeForm} className="px-4 py-2 border border-border rounded hover:bg-muted">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8">Loading alerts...</div>
      ) : alerts.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <p>No alerts configured</p>
          <p className="text-sm">Create an alert to get notified</p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`bg-card border rounded-lg p-4 ${!alert.seen ? "border-l-4 border-l-primary" : "border-border"}`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${alert.triggered ? "bg-yellow-100 text-yellow-800" : "bg-blue-100 text-blue-800"}`}
                    >
                      {alert.triggered ? "Triggered" : "Active"}
                    </span>
                    <span className="font-medium">{getAlertTypeLabel(alert.type)}</span>
                    {alert.symbol && <span className="text-muted-foreground">{alert.symbol}</span>}
                    {alert.symbol && alertPrices[alert.symbol] && (
                      <span className="text-green-600 font-medium text-sm ml-2">
                        (₹{alertPrices[alert.symbol].toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {alert.condition.threshold && `Target: ₹${alert.condition.threshold}`}
                    {alert.condition.changePercent && `${alert.condition.changePercent}${alert.type === "volume_spike" ? "x" : "%"}`}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Created: {new Date(alert.createdAt).toLocaleDateString()}
                    {alert.triggeredAt && ` • Triggered: ${new Date(alert.triggeredAt).toLocaleDateString()}`}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleEdit(alert)} className="text-blue-500 hover:text-blue-700 text-sm">
                    Edit
                  </button>
                  <button onClick={() => deleteAlert(alert.id)} className="text-red-500 hover:text-red-700 text-sm">
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

// ============================================================
// Main Alerts Page (Tabbed)
// ============================================================

export default function AlertsPage() {
  const { data: session } = useSession();
  const [activeTab, setActiveTab] = useState<Tab>("simple-alerts");

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Please sign in to view alerts</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Page header */}
        <h1 className="text-3xl font-bold mb-2">Alerts</h1>
        <p className="text-muted-foreground mb-6">
          Configure alert rules, delivery channels, and view triggered events
        </p>

        {/* Tabs */}
        <div className="border-b border-border mb-6">
          <div className="flex gap-0 -mb-px">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        {activeTab === "simple-alerts" && <SimpleAlertsTab />}
        {activeTab === "rules" && <RuleList />}
        {activeTab === "channels" && <ChannelConfig />}
        {activeTab === "events" && <EventHistory />}
        {activeTab === "telegram" && <TelegramSubscription />}
      </div>
    </div>
  );
}
