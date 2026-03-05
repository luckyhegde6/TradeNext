"use client";

import { useState, useEffect } from "react";

interface Alert {
  id: string;
  type: string;
  symbol: string | null;
  condition: {
    threshold?: number | string;
    changePercent?: number | string;
    [key: string]: unknown;
  };
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
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        <div className="border-b dark:border-slate-800 pb-6">
          <h1 className="text-4xl font-extrabold text-gray-900 dark:text-white tracking-tight">Alert Management</h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1 font-medium">Monitor and manage real-time user price notifications.</p>
        </div>

        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-2xl p-6 shadow-xl hover:shadow-2xl transition-all group">
              <h3 className="text-sm font-bold text-gray-500 dark:text-slate-500 uppercase tracking-widest mb-1">Total Alerts</h3>
              <p className="text-3xl font-black text-gray-900 dark:text-white">{stats.total}</p>
              <div className="h-1 w-12 bg-blue-500 rounded-full mt-4 group-hover:w-full transition-all duration-500"></div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-2xl p-6 shadow-xl hover:shadow-2xl transition-all group">
              <h3 className="text-sm font-bold text-gray-500 dark:text-slate-500 uppercase tracking-widest mb-1">Active</h3>
              <p className="text-3xl font-black text-green-600 dark:text-green-400">{stats.active}</p>
              <div className="h-1 w-12 bg-green-500 rounded-full mt-4 group-hover:w-full transition-all duration-500"></div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-2xl p-6 shadow-xl hover:shadow-2xl transition-all group">
              <h3 className="text-sm font-bold text-gray-500 dark:text-slate-500 uppercase tracking-widest mb-1">Triggered</h3>
              <p className="text-3xl font-black text-yellow-600 dark:text-yellow-400">{stats.triggered}</p>
              <div className="h-1 w-12 bg-yellow-500 rounded-full mt-4 group-hover:w-full transition-all duration-500"></div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-2xl p-6 shadow-xl hover:shadow-2xl transition-all group">
              <h3 className="text-sm font-bold text-gray-500 dark:text-slate-500 uppercase tracking-widest mb-1">By Type</h3>
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

        <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
          <div className="p-6 border-b border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/50 flex justify-between items-center">
            <h2 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
              <span className="w-2 h-6 bg-blue-600 rounded-full"></span>
              User Alerts
            </h2>
            <div className="flex bg-gray-100 dark:bg-slate-800 p-1 rounded-xl">
              <button
                onClick={() => setFilter('all')}
                className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${filter === 'all' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-white shadow-sm' : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'}`}
              >
                All
              </button>
              <button
                onClick={() => setFilter('active')}
                className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${filter === 'active' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-white shadow-sm' : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'}`}
              >
                Active
              </button>
              <button
                onClick={() => setFilter('triggered')}
                className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${filter === 'triggered' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-white shadow-sm' : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'}`}
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
                <thead className="bg-gray-50/50 dark:bg-slate-800/50">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">User</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">Type</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">Symbol</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">Condition</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">Status</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">Created</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">Triggered</th>
                    <th className="px-6 py-4 text-right text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAlerts.map(alert => (
                    <tr key={alert.id} className="border-t border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-gray-900 dark:text-white">{alert.user?.name || 'Unknown'}</div>
                        <div className="text-xs font-medium text-gray-500 dark:text-slate-500">{alert.user?.email}</div>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span className="px-2.5 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-full text-[10px] font-black uppercase tracking-tighter">
                          {getAlertTypeLabel(alert.type)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm font-black text-blue-600 dark:text-blue-400">{alert.symbol || '-'}</td>
                      <td className="px-6 py-4 text-sm font-bold text-gray-700 dark:text-slate-300">
                        {alert.condition.threshold && `Target: ₹${alert.condition.threshold}`}
                        {alert.condition.changePercent && `${alert.condition.changePercent}%`}
                      </td>
                      <td className="px-6 py-4">
                        {alert.triggered ? (
                          <span className="px-2.5 py-1 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800 rounded-full text-[10px] font-black uppercase tracking-tighter">
                            Triggered
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-400 border border-green-200 dark:border-green-800 rounded-full text-[10px] font-black uppercase tracking-tighter">
                            Active
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-xs font-mono italic text-gray-500 dark:text-slate-500">
                        {new Date(alert.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-xs font-mono italic text-gray-500 dark:text-slate-500">
                        {alert.triggeredAt ? new Date(alert.triggeredAt).toLocaleDateString() : '-'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => deleteAlert(alert.id)}
                          className="text-red-500 hover:text-red-700 dark:hover:text-red-400 text-sm font-bold transition-colors"
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
