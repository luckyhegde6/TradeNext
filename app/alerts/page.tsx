"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Autocomplete from "@/app/components/ui/Autocomplete";

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
  { value: 'price_above', label: 'Price Above', description: 'Alert when price goes above target' },
  { value: 'price_below', label: 'Price Below', description: 'Alert when price drops below target' },
  { value: 'price_jump', label: 'Price Jump', description: 'Alert on significant price change' },
  { value: 'volume_spike', label: 'Volume Spike', description: 'Alert on unusual trading volume' },
  // Corporate Action Alerts
  { value: 'dividend_alert', label: 'Dividend Alert', description: 'Alert when dividend is announced' },
  { value: 'bonus_alert', label: 'Bonus Alert', description: 'Alert when bonus shares are announced' },
  { value: 'split_alert', label: 'Stock Split Alert', description: 'Alert when stock split is announced' },
  { value: 'rights_alert', label: 'Rights Issue Alert', description: 'Alert when rights issue is announced' },
  { value: 'buyback_alert', label: 'Buyback Alert', description: 'Alert when buyback is announced' },
  { value: 'meeting_alert', label: 'Meeting/AGM Alert', description: 'Alert for shareholder meetings' },
];

export default function AlertsPage() {
  const { data: session } = useSession();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingAlert, setEditingAlert] = useState<Alert | null>(null);
  const [formData, setFormData] = useState({
    type: 'price_above',
    symbol: '',
    threshold: '',
    changePercent: '',
    minDividend: '',
  });
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [alertPrices, setAlertPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    if (session) {
      fetchAlerts();
      // Trigger a real-time alert check when page loads
      // This serves as a fallback for serverless environments where background workers don't run continuously
      checkAlertsRealTime();
    }
  }, [session]);

  // Real-time alert check - fetches current prices and triggers alerts
  const checkAlertsRealTime = async () => {
    try {
      await fetch('/api/alerts/check', { method: 'POST' });
    } catch (error) {
      console.error('Real-time alert check failed:', error);
    }
  };

  const fetchAlerts = async () => {
    try {
      const res = await fetch('/api/alerts');
      const data = await res.json();
      setAlerts(data);
      
      // Fetch current prices for alerts with symbols
      const symbols = [...new Set(data.filter((a: Alert) => a.symbol).map((a: Alert) => a.symbol))] as string[];
      fetchAlertPrices(symbols);
    } catch (error) {
      console.error('Failed to fetch alerts:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch current prices for multiple symbols
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
      
      // Price-based alerts need threshold or changePercent
      if (formData.type === 'price_above' || formData.type === 'price_below') {
        if (formData.threshold) condition.threshold = parseFloat(formData.threshold);
      } else if (formData.type === 'price_jump' || formData.type === 'volume_spike') {
        if (formData.changePercent) condition.changePercent = parseFloat(formData.changePercent);
      } else if (formData.type === 'dividend_alert') {
        // Corporate action alerts - optional min dividend
        if (formData.minDividend) condition.minDividend = parseFloat(formData.minDividend);
      }
      // Corporate action alerts (dividend_alert, bonus_alert, etc.) don't need extra condition

      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: formData.type,
          symbol: formData.symbol.toUpperCase(),
          condition,
        }),
      });

      if (res.ok) {
        setShowForm(false);
        setFormData({ type: 'price_above', symbol: '', threshold: '', changePercent: '', minDividend: '' });
        fetchAlerts();
      }
    } catch (error) {
      console.error('Failed to create alert:', error);
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
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: formData.type,
          symbol: formData.symbol.toUpperCase(),
          condition,
        }),
      });

      if (res.ok) {
        setEditingAlert(null);
        setFormData({ type: 'price_above', symbol: '', threshold: '', changePercent: '', minDividend: '' });
        fetchAlerts();
      }
    } catch (error) {
      console.error('Failed to update alert:', error);
    }
  };

  const handleEdit = (alert: Alert) => {
    setEditingAlert(alert);
    setFormData({
      type: alert.type,
      symbol: alert.symbol || '',
      threshold: alert.condition.threshold?.toString() || '',
      changePercent: alert.condition.changePercent?.toString() || '',
      minDividend: alert.condition.minDividend?.toString() || '',
    });
  };

  const deleteAlert = async (id: string) => {
    try {
      await fetch(`/api/alerts?action=delete&id=${id}`, { method: 'DELETE' });
      fetchAlerts();
    } catch (error) {
      console.error('Failed to delete alert:', error);
    }
  };

  const markAllSeen = async () => {
    try {
      await fetch('/api/alerts?action=markAllSeen', { method: 'POST' });
      fetchAlerts();
    } catch (error) {
      console.error('Failed to mark alerts seen:', error);
    }
  };

  const getAlertTypeLabel = (type: string) => {
    return ALERT_TYPES.find(t => t.value === type)?.label || type;
  };

  // Fetch current price when symbol changes
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
          setCurrentPrice(parseFloat(data.lastPrice) || null);
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

  // Handle symbol selection
  const handleSymbolSelect = (symbol: string) => {
    setFormData({ ...formData, symbol });
    fetchCurrentPrice(symbol);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingAlert(null);
    setFormData({ type: 'price_above', symbol: '', threshold: '', changePercent: '', minDividend: '' });
    setCurrentPrice(null);
  };

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
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Price Alerts</h1>
          <div className="flex gap-2">
            <button
              onClick={markAllSeen}
              className="px-4 py-2 border border-border rounded hover:bg-muted"
            >
              Mark All Seen
            </button>
            <button
              onClick={() => setShowForm(!showForm)}
              className="px-4 py-2 bg-primary text-white rounded hover:bg-primary/90"
            >
              {showForm ? 'Cancel' : 'Create Alert'}
            </button>
          </div>
        </div>

        {(showForm || editingAlert) && (
          <div className="bg-card border border-border rounded-lg p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">{editingAlert ? 'Edit Alert' : 'New Alert'}</h2>
            <form onSubmit={editingAlert ? updateAlert : createAlert} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Alert Type</label>
                <select
                  className="w-full p-2 border border-border rounded bg-background"
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                >
                  {ALERT_TYPES.map(type => (
                    <option key={type.value} value={type.value}>
                      {type.label} - {type.description}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Stock Symbol {['dividend_alert', 'bonus_alert', 'split_alert', 'rights_alert', 'buyback_alert', 'meeting_alert'].includes(formData.type) && <span className="text-muted-foreground">(Optional - leave empty for any)</span>}
                </label>
                <Autocomplete
                  onSelect={handleSymbolSelect}
                  placeholder={['dividend_alert', 'bonus_alert', 'split_alert', 'rights_alert', 'buyback_alert', 'meeting_alert'].includes(formData.type) ? "Leave empty for any stock" : "e.g., RELIANCE"}
                  initialValue={formData.symbol}
                />
                {formData.symbol && (
                  <div className="mt-2 text-sm">
                    {priceLoading ? (
                      <span className="text-muted-foreground">Loading price...</span>
                    ) : currentPrice !== null ? (
                      <span className="text-green-600 font-medium">
                        Current Price: ₹{currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Price not available</span>
                    )}
                  </div>
                )}
              </div>

              {(formData.type === 'price_above' || formData.type === 'price_below') && (
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

              {(formData.type === 'price_jump' || formData.type === 'volume_spike') && (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    {formData.type === 'price_jump' ? 'Change %' : 'Volume Multiplier'}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder={formData.type === 'price_jump' ? 'e.g., 5' : 'e.g., 3'}
                    className="w-full p-2 border border-border rounded bg-background"
                    value={formData.changePercent}
                    onChange={(e) => setFormData({ ...formData, changePercent: e.target.value })}
                    required
                  />
                </div>
              )}

              {/* Corporate Action Alert Options */}
              {formData.type === 'dividend_alert' && (
                <div>
                  <label className="block text-sm font-medium mb-1">Minimum Dividend (₹) - Optional</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="e.g., 5.00 (only alert if dividend >= this)"
                    className="w-full p-2 border border-border rounded bg-background"
                    value={formData.minDividend || ''}
                    onChange={(e) => setFormData({ ...formData, minDividend: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Leave empty to get alerts for any dividend
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 py-2 bg-primary text-white rounded hover:bg-primary/90"
                >
                  {editingAlert ? 'Update Alert' : 'Create Alert'}
                </button>
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-4 py-2 border border-border rounded hover:bg-muted"
                >
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
            {alerts.map(alert => (
              <div
                key={alert.id}
                className={`bg-card border rounded-lg p-4 ${!alert.seen ? 'border-l-4 border-l-primary' : 'border-border'}`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${alert.triggered ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'}`}>
                        {alert.triggered ? 'Triggered' : 'Active'}
                      </span>
                      <span className="font-medium">{getAlertTypeLabel(alert.type)}</span>
                      {alert.symbol && <span className="text-muted-foreground">{alert.symbol}</span>}
                      {alert.symbol && alertPrices[alert.symbol] && (
                        <span className="text-green-600 font-medium text-sm ml-2">
                          (₹{alertPrices[alert.symbol].toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {alert.condition.threshold && `Target: ₹${alert.condition.threshold}`}
                      {alert.condition.changePercent && `${alert.condition.changePercent}${alert.type === 'volume_spike' ? 'x' : '%'}`}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Created: {new Date(alert.createdAt).toLocaleDateString()}
                      {alert.triggeredAt && ` • Triggered: ${new Date(alert.triggeredAt).toLocaleDateString()}`}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(alert)}
                      className="text-blue-500 hover:text-blue-700 text-sm"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteAlert(alert.id)}
                      className="text-red-500 hover:text-red-700 text-sm"
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
    </div>
  );
}
