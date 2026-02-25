"use client";

import { useState, useEffect } from "react";

interface Alert {
  id: string;
  type: string;
  symbol: string | null;
  condition: Record<string, unknown>;
  triggered: boolean;
  triggeredAt: string | null;
  seen: boolean;
  createdAt: string;
  user: {
    id: number;
    email: string;
    name: string | null;
  } | null;
}

interface Stats {
  total: number;
  active: number;
  triggered: number;
  byType: { type: string; _count: number }[];
}

export default function AdminAlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'triggered'>('all');

  useEffect(() => {
    fetchAlerts();
  }, []);

  const fetchAlerts = async () => {
    try {
      const res = await fetch('/api/admin/alerts');
      const data = await res.json();
      if (data.alerts) {
        setAlerts(data.alerts);
        setStats(data.stats);
      }
    } catch (error) {
      console.error('Failed to fetch alerts:', error);
    } finally {
      setLoading(false);
    }
  };

  const deleteAlert = async (id: string) => {
    if (!confirm('Are you sure you want to delete this alert?')) return;
    try {
      await fetch(`/api/admin/alerts?id=${id}`, { method: 'DELETE' });
      fetchAlerts();
    } catch (error) {
      console.error('Failed to delete alert:', error);
    }
  };

  const filteredAlerts = alerts.filter(alert => {
    if (filter === 'active') return !alert.triggered;
    if (filter === 'triggered') return alert.triggered;
    return true;
  });

  const getAlertTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'price_above': 'Price Above',
      'price_below': 'Price Below',
      'price_jump': 'Price Jump',
      'volume_spike': 'Volume Spike',
      'piotroski_score': 'Piotroski Score',
      'portfolio_value': 'Portfolio Value',
    };
    return labels[type] || type;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-6">Alert Management</h1>

        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="text-sm font-medium text-muted-foreground">Total Alerts</h3>
              <p className="text-2xl font-bold">{stats.total}</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="text-sm font-medium text-muted-foreground">Active</h3>
              <p className="text-2xl font-bold text-green-500">{stats.active}</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="text-sm font-medium text-muted-foreground">Triggered</h3>
              <p className="text-2xl font-bold text-yellow-500">{stats.triggered}</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="text-sm font-medium text-muted-foreground">By Type</h3>
              <div className="text-sm mt-1">
                {stats.byType.map(t => (
                  <div key={t.type} className="flex justify-between">
                    <span>{getAlertTypeLabel(t.type)}:</span>
                    <span className="font-medium">{t._count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="bg-card border border-border rounded-lg">
          <div className="p-4 border-b border-border flex justify-between items-center">
            <h2 className="text-xl font-semibold">User Alerts</h2>
            <div className="flex gap-2">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1 rounded ${filter === 'all' ? 'bg-primary text-white' : 'bg-muted'}`}
              >
                All
              </button>
              <button
                onClick={() => setFilter('active')}
                className={`px-3 py-1 rounded ${filter === 'active' ? 'bg-primary text-white' : 'bg-muted'}`}
              >
                Active
              </button>
              <button
                onClick={() => setFilter('triggered')}
                className={`px-3 py-1 rounded ${filter === 'triggered' ? 'bg-primary text-white' : 'bg-muted'}`}
              >
                Triggered
              </button>
            </div>
          </div>

          {filteredAlerts.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No alerts found
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted">
                  <tr>
                    <th className="p-3 text-left text-sm font-medium">User</th>
                    <th className="p-3 text-left text-sm font-medium">Type</th>
                    <th className="p-3 text-left text-sm font-medium">Symbol</th>
                    <th className="p-3 text-left text-sm font-medium">Condition</th>
                    <th className="p-3 text-left text-sm font-medium">Status</th>
                    <th className="p-3 text-left text-sm font-medium">Created</th>
                    <th className="p-3 text-left text-sm font-medium">Triggered</th>
                    <th className="p-3 text-left text-sm font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAlerts.map(alert => (
                    <tr key={alert.id} className="border-t border-border">
                      <td className="p-3">
                        <div className="text-sm font-medium">{alert.user?.name || 'Unknown'}</div>
                        <div className="text-xs text-muted-foreground">{alert.user?.email}</div>
                      </td>
                      <td className="p-3 text-sm">
                        <span className="px-2 py-1 bg-primary/10 text-primary rounded text-xs">
                          {getAlertTypeLabel(alert.type)}
                        </span>
                      </td>
                      <td className="p-3 text-sm font-medium">{alert.symbol || '-'}</td>
                      <td className="p-3 text-sm">
                        {alert.condition.threshold && `Target: ₹${alert.condition.threshold}`}
                        {alert.condition.changePercent && `${alert.condition.changePercent}%`}
                      </td>
                      <td className="p-3">
                        {alert.triggered ? (
                          <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs">
                            Triggered
                          </span>
                        ) : (
                          <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs">
                            Active
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {new Date(alert.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {alert.triggeredAt ? new Date(alert.triggeredAt).toLocaleDateString() : '-'}
                      </td>
                      <td className="p-3">
                        <button
                          onClick={() => deleteAlert(alert.id)}
                          className="text-red-500 hover:text-red-700 text-sm"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
