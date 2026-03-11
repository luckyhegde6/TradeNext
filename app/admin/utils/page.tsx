"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

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

interface NseStats {
    totalCalls: number;
    byEndpoint: Array<{
        endpoint: string;
        count: number;
    }>;
    hourlyData: Record<string, number>;
    flaggedUsers: Array<{
        userId: number;
        userName: string | null;
        userEmail: string;
        endpoint: string;
        requestCount: number;
    }>;
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
                 fetch('/api/admin/active-users'),
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
            <div className="space-y-6 animate-in fade-in duration-500">
                <div className="flex justify-between items-end border-b dark:border-slate-800 pb-4">
                    <div className="space-y-1">
                        <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">Admin Overview</h1>
                        <p className="text-sm text-gray-500 dark:text-slate-400">Loading system metrics...</p>
                    </div>
                </div>
                <div className="animate-pulse space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {[...Array(4)].map((_, i) => (
                            <div key={i} className="bg-gray-100 dark:bg-slate-800/50 h-32 rounded-2xl border border-gray-200 dark:border-slate-800"></div>
                        ))}
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {[...Array(2)].map((_, i) => (
                            <div key={i} className="bg-gray-100 dark:bg-slate-800/50 h-64 rounded-2xl border border-gray-200 dark:border-slate-800"></div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="space-y-6">
                <div className="flex justify-between items-end border-b dark:border-slate-800 pb-4">
                    <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">Admin Overview</h1>
                </div>
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-2xl p-6 text-center">
                    <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4 text-red-600 dark:text-red-400">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <h3 className="text-lg font-bold text-red-900 dark:text-red-300">System Error</h3>
                    <p className="text-red-800 dark:text-red-400 mt-1 max-w-md mx-auto">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex justify-between items-end border-b dark:border-slate-800 pb-6">
                <div className="space-y-1">
                    <h1 className="text-4xl font-extrabold text-gray-900 dark:text-white tracking-tight">Admin Overview</h1>
                    <p className="text-lg text-gray-500 dark:text-slate-400">Real-time health markers, user growth, and system performance.</p>
                </div>
                <div className="flex flex-col items-end">
                    <span className="text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">Last Synced</span>
                    <span className="text-sm font-semibold text-gray-700 dark:text-slate-300">
                        {stats ? new Date(stats.timestamp).toLocaleString() : 'Never'}
                    </span>
                </div>
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-gray-100 dark:border-slate-800 transition-all hover:translate-y-[-4px] group">
                    <div className="flex items-center justify-between mb-4">
                        <div className="p-2.5 bg-blue-50 dark:bg-blue-900/30 rounded-xl text-blue-600 dark:text-blue-400 group-hover:scale-110 transition-transform">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                            </svg>
                        </div>
                        <span className="text-[10px] font-black uppercase text-blue-600/50 dark:text-blue-400/30 tracking-tighter">Growth</span>
                    </div>
                    <h3 className="text-sm font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-1">Total Users</h3>
                    <p className="text-4xl font-black text-gray-900 dark:text-white">{stats?.users.total || 0}</p>
                    <div className="mt-4 pt-4 border-t dark:border-slate-800/50 flex items-center text-xs font-bold text-green-600 dark:text-green-400">
                        <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M12 7a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0V8.414l-4.293 4.293a1 1 0 01-1.414 0L8 10.414l-4.293 4.293a1 1 0 01-1.414-1.414l5-5a1 1 0 011.414 0L11 10.586 14.586 7H12z" clipRule="evenodd" />
                        </svg>
                        +{stats?.users.recent || 0} this month
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-gray-100 dark:border-slate-800 transition-all hover:translate-y-[-4px] group">
                    <div className="flex items-center justify-between mb-4">
                        <div className="p-2.5 bg-emerald-50 dark:bg-emerald-900/30 rounded-xl text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
                            </svg>
                        </div>
                        <span className="text-[10px] font-black uppercase text-emerald-600/50 dark:text-emerald-400/30 tracking-tighter">Assets</span>
                    </div>
                    <h3 className="text-sm font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-1">Portfolios</h3>
                    <p className="text-4xl font-black text-gray-900 dark:text-white">{stats?.portfolios.total || 0}</p>
                    <div className="mt-4 pt-4 border-t dark:border-slate-800/50 flex items-center text-xs font-bold text-slate-500 dark:text-slate-400">
                        {stats?.portfolios.withHoldings || 0} active portfolios
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-gray-100 dark:border-slate-800 transition-all hover:translate-y-[-4px] group">
                    <div className="flex items-center justify-between mb-4">
                        <div className="p-2.5 bg-amber-50 dark:bg-amber-900/30 rounded-xl text-amber-600 dark:text-amber-400 group-hover:scale-110 transition-transform">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                            </svg>
                        </div>
                        <span className="text-[10px] font-black uppercase text-amber-600/50 dark:text-amber-400/30 tracking-tighter">Health</span>
                    </div>
                    <h3 className="text-sm font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-1">DB Response</h3>
                    <p className="text-4xl font-black text-gray-900 dark:text-white">{stats?.database.responseTime || 0}<span className="text-lg ml-1 font-bold text-gray-400">ms</span></p>
                    <div className="mt-4 pt-4 border-t dark:border-slate-800/50 flex items-center text-xs font-bold">
                        <div className={`w-2.5 h-2.5 rounded-full mr-2 ${stats?.database.status === 'healthy' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-red-500 animate-pulse'}`}></div>
                        <span className={stats?.database.status === 'healthy' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                            {stats?.database.status === 'healthy' ? 'Operational' : 'Critical'}
                        </span>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-gray-100 dark:border-slate-800 transition-all hover:translate-y-[-4px] group">
                    <div className="flex items-center justify-between mb-4">
                        <div className="p-2.5 bg-purple-50 dark:bg-purple-900/30 rounded-xl text-purple-600 dark:text-purple-400 group-hover:scale-110 transition-transform">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                        </div>
                        <span className="text-[10px] font-black uppercase text-purple-600/50 dark:text-purple-400/30 tracking-tighter">Usage</span>
                    </div>
                    <h3 className="text-sm font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-1">Active Now</h3>
                    <p className="text-4xl font-black text-gray-900 dark:text-white">{activeUsers?.activity.lastHour || 0}</p>
                    <div className="mt-4 pt-4 border-t dark:border-slate-800/50 flex items-center text-xs font-bold text-purple-600 dark:text-purple-400">
                        {activeUsers?.activity.last24Hours || 0} unique in 24h
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* System Nodes */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-gray-100 dark:border-slate-800">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6 flex items-center">
                            <svg className="w-5 h-5 mr-2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                            </svg>
                            System Nodes
                        </h3>
                        <div className="space-y-4">
                            {[
                                { name: 'Database API', status: stats?.system.database, color: 'emerald' },
                                { name: 'Redis Cache', status: stats?.system.cache, color: 'blue' },
                                { name: 'Background Workers', status: stats?.system.workers, color: 'amber' },
                                { name: 'Scheduled Jobs', status: stats?.system.cron, color: 'purple' }
                            ].map((node) => (
                                <div key={node.name} className="flex justify-between items-center p-3.5 bg-gray-50 dark:bg-slate-800/50 rounded-xl border border-gray-100 dark:border-slate-800">
                                    <span className="text-sm font-bold text-gray-700 dark:text-slate-300">{node.name}</span>
                                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-lg border ${node.status === 'healthy' || node.status === 'active' || node.status === 'running'
                                        ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-800/50'
                                        : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-100 dark:border-red-800/50'
                                        }`}>
                                        {node.status || 'Offline'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-gray-100 dark:border-slate-800">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6 flex items-center">
                            <svg className="w-5 h-5 mr-2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                            </svg>
                            User Distribution
                        </h3>
                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-slate-500">
                                    <span>Administrators</span>
                                    <span className="text-gray-900 dark:text-white">{stats?.users.admin || 0}</span>
                                </div>
                                <div className="h-2 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.3)]"
                                        style={{ width: `${((stats?.users.admin || 0) / (stats?.users.total || 1)) * 100}%` }}
                                    ></div>
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-slate-500">
                                    <span>Standard Users</span>
                                    <span className="text-gray-900 dark:text-white">{stats?.users.regular || 0}</span>
                                </div>
                                <div className="h-2 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.3)]"
                                        style={{ width: `${((stats?.users.regular || 0) / (stats?.users.total || 1)) * 100}%` }}
                                    ></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Logs and Activity */}
                <div className="lg:col-span-2 space-y-8">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-gray-100 dark:border-slate-800 overflow-hidden">
                        <div className="px-6 py-5 border-b dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/50 flex justify-between items-center">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center">
                                <svg className="w-5 h-5 mr-2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                Recent Core Activity
                            </h3>
                        </div>
                        <div className="divide-y dark:divide-slate-800">
                            {activeUsers?.recentUsers.length ? (
                                activeUsers.recentUsers.slice(0, 4).map((user) => (
                                    <div key={user.id} className="p-6 hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors flex justify-between items-center">
                                        <div className="flex items-center">
                                            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 font-bold mr-4">
                                                {user.name ? user.name[0] : 'U'}
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-gray-900 dark:text-white">{user.name || 'Authenticated User'}</p>
                                                <p className="text-xs text-gray-500 dark:text-slate-500">{user.email}</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-lg ${user.role === 'admin' ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'}`}>
                                                {user.role}
                                            </span>
                                            <p className="text-[10px] text-gray-400 dark:text-slate-600 mt-1 font-bold">
                                                Active {new Date(user.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </p>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="p-12 text-center text-gray-400 dark:text-slate-600 font-bold italic">No recent sessions found</div>
                            )}
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-gray-100 dark:border-slate-800 overflow-hidden">
                        <div className="px-6 py-5 border-b dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/50 flex justify-between items-center">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center">
                                <svg className="w-5 h-5 mr-2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                NSE Ingest Pipeline
                            </h3>
                            <Link href="/admin/utils/nse-sync" className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline">Manage Sync</Link>
                        </div>
                        <div className="divide-y dark:divide-slate-800">
                            {stats?.ingest.recent.length ? (
                                stats.ingest.recent.slice(0, 3).map((ingest) => (
                                    <div key={ingest.id} className="p-6 hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors">
                                        <div className="flex justify-between items-start mb-2">
                                            <div>
                                                <p className="text-sm font-bold text-gray-900 dark:text-white">{ingest.filename}</p>
                                                <p className="text-xs text-gray-500 dark:text-slate-500 font-medium">Source: NSE India FTP / CSV Proxy</p>
                                            </div>
                                            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-lg border ${ingest.status === 'completed'
                                                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-800/50'
                                                : ingest.status === 'failed'
                                                    ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-100 dark:border-red-800/50'
                                                    : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-800/50'
                                                }`}>
                                                {ingest.status}
                                            </span>
                                        </div>
                                        <div className="flex items-center space-x-4 mt-4">
                                            <div className="flex items-center text-[11px] font-black text-slate-500 dark:text-slate-400">
                                                <div className="w-2 h-2 rounded-full bg-blue-500 mr-1.5 opacity-50"></div>
                                                {ingest.recordsProcessed.toLocaleString()} RECORDS
                                            </div>
                                            <div className="flex items-center text-[11px] font-black text-slate-500 dark:text-slate-400">
                                                <div className="w-2 h-2 rounded-full bg-indigo-500 mr-1.5 opacity-50"></div>
                                                {new Date(ingest.createdAt).toLocaleDateString()}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="p-12 text-center text-gray-400 dark:text-slate-600 font-bold italic">No recent pipeline activity</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
