"use client";

import { useState, useEffect } from "react";

interface Stats {
    users: {
        total: number;
        admin: number;
        regular: number;
        recent: number;
    };
    portfolios: {
        total: number;
        withHoldings: number;
    };
    database: {
        status: string;
        responseTime: number;
        version: string;
    };
    system: {
        database: string;
        cache: string;
        workers: string;
        cron: string;
    };
    ingest: {
        recent: Array<{
            id: number;
            filename: string;
            status: string;
            recordsProcessed: number;
            createdAt: string;
            errorMessage?: string;
        }>;
        totalProcessed: number;
    };
    timestamp: string;
}

interface ActiveUsers {
    recentUsers: Array<{
        id: number;
        name: string | null;
        email: string;
        role: string;
        updatedAt: string;
    }>;
    activity: {
        lastHour: number;
        last24Hours: number;
        totalUsers: number;
    };
    note: string;
}

export default function AdminOverviewPage() {
    const [stats, setStats] = useState<Stats | null>(null);
    const [activeUsers, setActiveUsers] = useState<ActiveUsers | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const [statsRes, activeUsersRes] = await Promise.all([
                    fetch('/api/admin/stats'),
                    fetch('/api/admin/active-users')
                ]);

                if (!statsRes.ok || !activeUsersRes.ok) {
                    throw new Error('Failed to fetch admin data');
                }

                const statsData = await statsRes.json();
                const activeUsersData = await activeUsersRes.json();

                setStats(statsData);
                setActiveUsers(activeUsersData);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Unknown error');
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, []);

    if (loading) {
        return (
            <div className="space-y-6">
                <h1 className="text-3xl font-bold text-gray-900">Admin Overview</h1>
                <div className="animate-pulse space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {[...Array(8)].map((_, i) => (
                            <div key={i} className="bg-gray-200 h-24 rounded-lg"></div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="space-y-6">
                <h1 className="text-3xl font-bold text-gray-900">Admin Overview</h1>
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <p className="text-red-800">Error loading admin data: {error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold text-gray-900">Admin Overview</h1>
                <span className="text-sm text-gray-500">
                    Last updated: {stats ? new Date(stats.timestamp).toLocaleString() : 'Never'}
                </span>
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Total Users</h3>
                    <p className="text-3xl font-bold text-blue-600">{stats?.users.total || 0}</p>
                    <p className="text-sm text-gray-500">
                        {stats?.users.recent || 0} new this month
                    </p>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Portfolios</h3>
                    <p className="text-3xl font-bold text-green-600">{stats?.portfolios.total || 0}</p>
                    <p className="text-sm text-gray-500">
                        {stats?.portfolios.withHoldings || 0} with holdings
                    </p>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Database Health</h3>
                    <p className={`text-lg font-bold ${stats?.database.status === 'healthy' ? 'text-green-600' : 'text-red-600'}`}>
                        {stats?.database.status || 'Unknown'}
                    </p>
                    <p className="text-sm text-gray-500">
                        {stats?.database.responseTime || 0}ms response
                    </p>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Active Users</h3>
                    <p className="text-3xl font-bold text-purple-600">{activeUsers?.activity.last24Hours || 0}</p>
                    <p className="text-sm text-gray-500">
                        {activeUsers?.activity.lastHour || 0} in last hour
                    </p>
                </div>
            </div>

            {/* User Breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">User Distribution</h3>
                    <div className="space-y-3">
                        <div className="flex justify-between items-center">
                            <span className="text-gray-600">Administrators</span>
                            <span className="font-semibold text-red-600">{stats?.users.admin || 0}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-gray-600">Regular Users</span>
                            <span className="font-semibold text-blue-600">{stats?.users.regular || 0}</span>
                        </div>
                        <div className="flex justify-between items-center border-t pt-2">
                            <span className="text-gray-600 font-medium">Total</span>
                            <span className="font-bold text-gray-900">{stats?.users.total || 0}</span>
                        </div>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">System Status</h3>
                    <div className="space-y-3">
                        <div className="flex justify-between items-center">
                            <span className="text-gray-600">Database</span>
                            <span className={`font-semibold ${stats?.system.database === 'healthy' ? 'text-green-600' : 'text-red-600'}`}>
                                {stats?.system.database || 'Unknown'}
                            </span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-gray-600">Cache</span>
                            <span className="font-semibold text-blue-600">{stats?.system.cache || 'Unknown'}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-gray-600">Workers</span>
                            <span className="font-semibold text-orange-600">{stats?.system.workers || 'Unknown'}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-gray-600">Cron Jobs</span>
                            <span className="font-semibold text-orange-600">{stats?.system.cron || 'Unknown'}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Recent Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Ingest Activity</h3>
                    <div className="space-y-3">
                        {stats?.ingest.recent.length ? (
                            stats.ingest.recent.slice(0, 3).map((ingest) => (
                                <div key={ingest.id} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
                                    <div>
                                        <p className="text-sm font-medium text-gray-900 truncate">{ingest.filename}</p>
                                        <p className="text-xs text-gray-500">
                                            {new Date(ingest.createdAt).toLocaleDateString()}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <span className={`text-xs px-2 py-1 rounded-full ${
                                            ingest.status === 'completed' ? 'bg-green-100 text-green-800' :
                                            ingest.status === 'failed' ? 'bg-red-100 text-red-800' :
                                            'bg-yellow-100 text-yellow-800'
                                        }`}>
                                            {ingest.status}
                                        </span>
                                        <p className="text-xs text-gray-500 mt-1">
                                            {ingest.recordsProcessed || 0} records
                                        </p>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <p className="text-gray-500 text-sm">No recent ingest activity</p>
                        )}
                    </div>
                    <div className="mt-4 pt-3 border-t border-gray-100">
                        <p className="text-sm text-gray-600">
                            Total records processed: <span className="font-semibold">{stats?.ingest.totalProcessed || 0}</span>
                        </p>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Active Users</h3>
                    <div className="space-y-3">
                        {activeUsers?.recentUsers.length ? (
                            activeUsers.recentUsers.slice(0, 5).map((user) => (
                                <div key={user.id} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
                                    <div>
                                        <p className="text-sm font-medium text-gray-900">{user.name || 'No Name'}</p>
                                        <p className="text-xs text-gray-500">{user.email}</p>
                                    </div>
                                    <div className="text-right">
                                        <span className={`text-xs px-2 py-1 rounded-full ${
                                            user.role === 'admin' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'
                                        }`}>
                                            {user.role}
                                        </span>
                                        <p className="text-xs text-gray-500 mt-1">
                                            {new Date(user.updatedAt).toLocaleDateString()}
                                        </p>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <p className="text-gray-500 text-sm">No recent user activity</p>
                        )}
                    </div>
                    <div className="mt-4 pt-3 border-t border-gray-100">
                        <p className="text-sm text-gray-600">{activeUsers?.note}</p>
                    </div>
                </div>
            </div>

            {/* Database Info */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Database Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <h4 className="font-medium text-gray-900 mb-2">Connection Status</h4>
                        <div className="space-y-2">
                            <div className="flex justify-between">
                                <span className="text-gray-600">Status:</span>
                                <span className={`font-semibold ${stats?.database.status === 'healthy' ? 'text-green-600' : 'text-red-600'}`}>
                                    {stats?.database.status || 'Unknown'}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-600">Response Time:</span>
                                <span className="font-semibold">{stats?.database.responseTime || 0}ms</span>
                            </div>
                        </div>
                    </div>
                    <div>
                        <h4 className="font-medium text-gray-900 mb-2">Database Version</h4>
                        <p className="text-gray-600 font-mono text-sm">{stats?.database.version || 'Unknown'}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
