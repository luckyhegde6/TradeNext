"use client";

import { useState, useEffect } from "react";

interface UserSession {
    id: string;
    userId: number;
    ipAddress: string | null;
    userAgent: string | null;
    deviceInfo: string | null;
    location: string | null;
    isActive: boolean;
    expiresAt: string;
    lastActiveAt: string;
    createdAt: string;
    user?: {
        id: number;
        email: string;
        name: string | null;
        role: string;
    };
}

interface SessionStats {
    total: number;
    active: number;
    expired: number;
    usersWithSessions: number;
}

export default function AdminSessionsPage() {
    const [sessions, setSessions] = useState<UserSession[]>([]);
    const [stats, setStats] = useState<SessionStats>({ total: 0, active: 0, expired: 0, usersWithSessions: 0 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filterUserId, setFilterUserId] = useState<string>("");
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const fetchSessions = async () => {
        try {
            setLoading(true);
            const url = filterUserId 
                ? `/api/admin/sessions?userId=${filterUserId}&includeUser=true`
                : `/api/admin/sessions?includeUser=true`;
            
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch sessions');
            const data = await response.json();
            setSessions(data.sessions || []);
            setStats(data.stats || { total: 0, active: 0, expired: 0, usersWithSessions: 0 });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSessions();
    }, []);

    const handleInvalidateSession = async (sessionId: string) => {
        if (!confirm('Are you sure you want to invalidate this session?')) return;
        
        setActionLoading(sessionId);
        try {
            const response = await fetch('/api/admin/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'invalidate', sessionId })
            });
            
            if (!response.ok) throw new Error('Failed to invalidate session');
            fetchSessions();
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Failed to invalidate session');
        } finally {
            setActionLoading(null);
        }
    };

    const handleInvalidateAllUserSessions = async (userId: number) => {
        if (!confirm(`Are you sure you want to invalidate ALL sessions for user ID ${userId}?`)) return;
        
        setActionLoading(`user-${userId}`);
        try {
            const response = await fetch('/api/admin/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'invalidateAll', userId })
            });
            
            if (!response.ok) throw new Error('Failed to invalidate sessions');
            fetchSessions();
            alert('Sessions invalidated successfully');
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Failed to invalidate sessions');
        } finally {
            setActionLoading(null);
        }
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getTimeAgo = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
        return `${Math.floor(diffMins / 1440)}d ago`;
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-slate-900 p-6">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-black text-gray-900 dark:text-white">Session Management</h1>
                    <p className="text-gray-600 dark:text-slate-400 mt-2">
                        View and manage user active sessions
                    </p>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-border shadow-sm">
                        <div className="text-sm font-medium text-gray-500 dark:text-slate-400">Total Sessions</div>
                        <div className="text-3xl font-black text-gray-900 dark:text-white mt-2">{stats.total}</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-border shadow-sm">
                        <div className="text-sm font-medium text-gray-500 dark:text-slate-400">Active Sessions</div>
                        <div className="text-3xl font-black text-green-600 mt-2">{stats.active}</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-border shadow-sm">
                        <div className="text-sm font-medium text-gray-500 dark:text-slate-400">Expired Sessions</div>
                        <div className="text-3xl font-black text-gray-400 mt-2">{stats.expired}</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-border shadow-sm">
                        <div className="text-sm font-medium text-gray-500 dark:text-slate-400">Users with Sessions</div>
                        <div className="text-3xl font-black text-blue-600 mt-2">{stats.usersWithSessions}</div>
                    </div>
                </div>

                {/* Filter */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-border shadow-sm mb-6">
                    <div className="flex flex-col sm:flex-row gap-4">
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                                Filter by User ID
                            </label>
                            <input
                                type="text"
                                value={filterUserId}
                                onChange={(e) => setFilterUserId(e.target.value)}
                                placeholder="Enter user ID..."
                                className="w-full px-4 py-2 rounded-xl border border-border bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-transparent"
                            />
                        </div>
                        <div className="flex items-end">
                            <button
                                onClick={() => fetchSessions()}
                                disabled={loading}
                                className="px-6 py-2 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-colors"
                            >
                                {loading ? 'Loading...' : 'Apply Filter'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Error Message */}
                {error && (
                    <div className="mb-6 p-4 bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400">
                        {error}
                    </div>
                )}

                {/* Sessions Table */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-border shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 dark:bg-slate-900 border-b border-border">
                                <tr>
                                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                                        User
                                    </th>
                                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                                        IP Address
                                    </th>
                                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                                        Device
                                    </th>
                                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                                        Last Active
                                    </th>
                                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                                        Expires
                                    </th>
                                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {loading ? (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-slate-400">
                                            Loading sessions...
                                        </td>
                                    </tr>
                                ) : sessions.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-slate-400">
                                            No active sessions found
                                        </td>
                                    </tr>
                                ) : (
                                    sessions.map((session) => (
                                        <tr key={session.id} className="hover:bg-gray-50 dark:hover:bg-slate-900/50 transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-gray-900 dark:text-white">
                                                        {session.user?.name || session.user?.email || `User #${session.userId}`}
                                                    </span>
                                                    <span className="text-xs text-gray-500 dark:text-slate-400">
                                                        {session.user?.email} • ID: {session.userId}
                                                    </span>
                                                    <span className="text-xs text-blue-600 dark:text-blue-400 uppercase">
                                                        {session.user?.role}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="text-sm text-gray-900 dark:text-white font-mono">
                                                    {session.ipAddress || 'Unknown'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col">
                                                    <span className="text-sm text-gray-900 dark:text-white">
                                                        {session.deviceInfo || 'Unknown'}
                                                    </span>
                                                    <span className="text-xs text-gray-500 dark:text-slate-400 truncate max-w-[200px]">
                                                        {session.userAgent || 'No user agent'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col">
                                                    <span className="text-sm text-gray-900 dark:text-white">
                                                        {getTimeAgo(session.lastActiveAt)}
                                                    </span>
                                                    <span className="text-xs text-gray-500 dark:text-slate-400">
                                                        {formatDate(session.lastActiveAt)}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col">
                                                    <span className={`text-sm font-medium ${
                                                        new Date(session.expiresAt) < new Date(Date.now() + 24 * 60 * 60 * 1000)
                                                            ? 'text-red-600'
                                                            : 'text-gray-900 dark:text-white'
                                                    }`}>
                                                        {formatDate(session.expiresAt)}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => handleInvalidateSession(session.id)}
                                                        disabled={actionLoading === session.id}
                                                        className="px-3 py-1.5 text-xs font-bold text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-50 transition-colors"
                                                    >
                                                        {actionLoading === session.id ? 'Invalidating...' : 'Invalidate'}
                                                    </button>
                                                    <button
                                                        onClick={() => handleInvalidateAllUserSessions(session.userId)}
                                                        disabled={actionLoading === `user-${session.userId}`}
                                                        className="px-3 py-1.5 text-xs font-bold text-orange-600 bg-orange-50 dark:bg-orange-900/20 rounded-lg hover:bg-orange-100 dark:hover:bg-orange-900/40 disabled:opacity-50 transition-colors"
                                                        title="Invalidate all sessions for this user"
                                                    >
                                                        {actionLoading === `user-${session.userId}` ? '...' : 'Invalidate All'}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Refresh Button */}
                <div className="mt-6 flex justify-center">
                    <button
                        onClick={() => fetchSessions()}
                        disabled={loading}
                        className="px-6 py-2 bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 font-bold rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
                    >
                        {loading ? 'Refreshing...' : 'Refresh Sessions'}
                    </button>
                </div>
            </div>
        </div>
    );
}
