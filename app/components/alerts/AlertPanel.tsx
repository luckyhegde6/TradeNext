"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";

interface Alert {
  id: string;
  type: string;
  symbol?: string;
  condition: Record<string, unknown>;
  triggered: boolean;
  triggeredAt?: string;
  seen: boolean;
  createdAt: string;
}

export function AlertPanel() {
  const { data: session } = useSession();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newAlert, setNewAlert] = useState({
    type: "price_above",
    symbol: "",
    threshold: "",
    changePercent: "",
  });
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [alertPrices, setAlertPrices] = useState<Record<string, number>>({});

  // Fetch current price for symbol
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
        if (data.lastPrice) {
          setCurrentPrice(parseFloat(data.lastPrice));
        } else {
          setCurrentPrice(null);
        }
      } else {
        setCurrentPrice(null);
      }
    } catch (error) {
      console.error('Failed to fetch price:', error);
      setCurrentPrice(null);
    } finally {
      setPriceLoading(false);
    }
  };

  // Fetch current prices for all alert symbols
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

  const fetchAlerts = useCallback(async () => {
    if (!session?.user) return;
    
    try {
      const res = await fetch("/api/alerts");
      if (res.ok) {
        const data = await res.json();
        setAlerts(data);
        
        // Fetch current prices for alerts with symbols
        const symbols = [...new Set(data.filter((a: Alert) => a.symbol).map((a: Alert) => a.symbol))] as string[];
        fetchAlertPrices(symbols);
      }
    } catch (error) {
      console.error("Error fetching alerts:", error);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const handleMarkSeen = async (alertId: string) => {
    try {
      await fetch(`/api/alerts?id=${alertId}&action=markSeen`, { method: "POST" });
      fetchAlerts();
    } catch (error) {
      console.error("Error marking alert seen:", error);
    }
  };

  const handleMarkAllSeen = async () => {
    try {
      await fetch("/api/alerts?action=markAllSeen", { method: "POST" });
      fetchAlerts();
    } catch (error) {
      console.error("Error marking all alerts seen:", error);
    }
  };

  const handleDelete = async (alertId: string) => {
    try {
      await fetch(`/api/alerts?id=${alertId}&action=delete`, { method: "POST" });
      fetchAlerts();
    } catch (error) {
      console.error("Error deleting alert:", error);
    }
  };

  const handleCreateAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const condition: Record<string, unknown> = {};
    
    if (newAlert.threshold) {
      condition.threshold = parseFloat(newAlert.threshold);
    }
    
    if (newAlert.changePercent) {
      condition.changePercent = parseFloat(newAlert.changePercent);
    }
    
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: newAlert.type,
          symbol: newAlert.symbol.toUpperCase() || undefined,
          condition,
        }),
      });
      
      if (res.ok) {
        setShowCreate(false);
        setNewAlert({ type: "price_above", symbol: "", threshold: "", changePercent: "" });
        fetchAlerts();
      }
    } catch (error) {
      console.error("Error creating alert:", error);
    }
  };

  const getAlertTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      price_above: "Price Above",
      price_below: "Price Below",
      volume_spike: "Volume Spike",
      price_jump: "Price Jump",
      piotroski_score: "Piotroski Score",
      portfolio_value: "Portfolio Value",
    };
    return labels[type] || type;
  };

  const getAlertIcon = (type: string) => {
    if (type.includes("price") && type.includes("above")) return "📈";
    if (type.includes("price") && type.includes("below")) return "📉";
    if (type.includes("volume")) return "🔥";
    if (type.includes("jump")) return "⚡";
    return "🔔";
  };

  if (!session?.user) {
    return null;
  }

  const unseenCount = alerts.filter((a) => !a.seen).length;

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Alerts</h3>
        <div className="flex gap-2">
          {unseenCount > 0 && (
            <button
              onClick={handleMarkAllSeen}
              className="text-sm text-blue-600 hover:underline dark:text-blue-400"
            >
              Mark all read
            </button>
          )}
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
          >
            {showCreate ? "Cancel" : "+ New Alert"}
          </button>
        </div>
      </div>

      {showCreate && (
        <form onSubmit={handleCreateAlert} className="mb-4 rounded border border-border p-3 dark:border-slate-700">
          <div className="grid gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Alert Type</label>
              <select
                value={newAlert.type}
                onChange={(e) => setNewAlert({ ...newAlert, type: e.target.value })}
                className="w-full rounded border border-border bg-background px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="price_above">Price Above</option>
                <option value="price_below">Price Below</option>
                <option value="price_jump">Price Jump (%)</option>
                <option value="volume_spike">Volume Spike</option>
                <option value="portfolio_value">Portfolio Value Change</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Symbol (optional)</label>
              <input
                type="text"
                value={newAlert.symbol}
                onChange={(e) => {
                  const symbol = e.target.value.toUpperCase();
                  setNewAlert({ ...newAlert, symbol });
                  fetchCurrentPrice(symbol);
                }}
                placeholder="RELIANCE"
                className="w-full rounded border border-border bg-background px-3 py-2 uppercase dark:border-slate-700 dark:bg-slate-800"
              />
              {newAlert.symbol && (
                <div className="mt-1 text-sm">
                  {priceLoading ? (
                    <span className="text-gray-500">Loading price...</span>
                  ) : currentPrice !== null ? (
                    <span className="text-green-600 font-medium">
                      Current: ₹{currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  ) : (
                    <span className="text-gray-500">Price not available</span>
                  )}
                </div>
              )}
            </div>
            {(newAlert.type === "price_above" || newAlert.type === "price_below") && (
              <div>
                <label className="mb-1 block text-sm font-medium">Price Threshold (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={newAlert.threshold}
                  onChange={(e) => setNewAlert({ ...newAlert, threshold: e.target.value })}
                  placeholder="2500"
                  className="w-full rounded border border-border bg-background px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
            )}
            {(newAlert.type === "price_jump" || newAlert.type === "portfolio_value") && (
              <div>
                <label className="mb-1 block text-sm font-medium">Change %</label>
                <input
                  type="number"
                  step="0.1"
                  value={newAlert.changePercent}
                  onChange={(e) => setNewAlert({ ...newAlert, changePercent: e.target.value })}
                  placeholder="5"
                  className="w-full rounded border border-border bg-background px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
            )}
            <button
              type="submit"
              className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700"
            >
              Create Alert
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="py-4 text-center text-gray-500">Loading alerts...</div>
      ) : alerts.length === 0 ? (
        <div className="py-4 text-center text-gray-500">No alerts set</div>
      ) : (
        <ul className="space-y-2">
          {alerts.map((alert) => (
            <li
              key={alert.id}
              className={`flex items-center justify-between rounded p-2 ${
                !alert.seen ? "bg-blue-50 dark:bg-blue-900/20" : "bg-surface dark:bg-slate-800"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">{getAlertIcon(alert.type)}</span>
                <div>
                  <p className="font-medium">
                    {getAlertTypeLabel(alert.type)}
                    {alert.symbol && <span className="ml-2 text-gray-500">@{alert.symbol}</span>}
                    {alert.symbol && alertPrices[alert.symbol] && (
                      <span className="ml-2 text-green-600 font-medium">
                        (₹{alertPrices[alert.symbol].toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-gray-500">
                    {(alert.condition.threshold as number) && `Target: ₹${alert.condition.threshold}`}
                    {(alert.condition.changePercent as number) && `${alert.condition.changePercent}%`}
                    {alert.triggered && alert.triggeredAt && (
                      <span className="ml-2 text-green-600">
                        - Triggered {new Date(alert.triggeredAt).toLocaleString()}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                {!alert.seen && (
                  <button
                    onClick={() => handleMarkSeen(alert.id)}
                    className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Mark read
                  </button>
                )}
                <button
                  onClick={() => handleDelete(alert.id)}
                  className="text-sm text-red-600 hover:underline dark:text-red-400"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
