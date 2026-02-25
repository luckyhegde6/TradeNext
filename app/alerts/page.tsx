"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";

interface Alert {
  id: string;
  type: string;
  symbol?: string;
  condition: {
    threshold?: number;
    changePercent?: number;
    direction?: string;
  };
  triggered: boolean;
  triggeredAt?: string;
  seen: boolean;
  createdAt: string;
}

const ALERT_TYPES = [
  { value: 'price_above', label: 'Price Above', description: 'Alert when price goes above target' },
  { value: 'price_below', label: 'Price Below', description: 'Alert when price drops below target' },
  { value: 'price_jump', label: 'Price Jump', description: 'Alert on significant price change' },
  { value: 'volume_spike', label: 'Volume Spike', description: 'Alert on unusual trading volume' },
];

export default function AlertsPage() {
  const { data: session } = useSession();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    type: 'price_above',
    symbol: '',
    threshold: '',
    changePercent: '',
  });

  useEffect(() => {
    if (session) {
      fetchAlerts();
    }
  }, [session]);

  const fetchAlerts = async () => {
    try {
      const res = await fetch('/api/alerts');
      const data = await res.json();
      setAlerts(data);
    } catch (error) {
      console.error('Failed to fetch alerts:', error);
    } finally {
      setLoading(false);
    }
  };

  const createAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const condition: Record<string, number> = {};
      if (formData.threshold) condition.threshold = parseFloat(formData.threshold);
      if (formData.changePercent) condition.changePercent = parseFloat(formData.changePercent);

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
        setFormData({ type: 'price_above', symbol: '', threshold: '', changePercent: '' });
        fetchAlerts();
      }
    } catch (error) {
      console.error('Failed to create alert:', error);
    }
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

        {showForm && (
          <div className="bg-card border border-border rounded-lg p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">New Alert</h2>
            <form onSubmit={createAlert} className="space-y-4">
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
                <label className="block text-sm font-medium mb-1">Stock Symbol</label>
                <input
                  type="text"
                  placeholder="e.g., RELIANCE"
                  className="w-full p-2 border border-border rounded bg-background"
                  value={formData.symbol}
                  onChange={(e) => setFormData({ ...formData, symbol: e.target.value.toUpperCase() })}
                  required
                />
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

              <button
                type="submit"
                className="w-full py-2 bg-primary text-white rounded hover:bg-primary/90"
              >
                Create Alert
              </button>
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
                  <button
                    onClick={() => deleteAlert(alert.id)}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
