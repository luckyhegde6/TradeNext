'use client';

import { useState, useEffect } from 'react';
import {
    BellIcon,
    CheckCircleIcon,
    ExclamationCircleIcon,
    InformationCircleIcon,
    CpuChipIcon,
    ClockIcon,
    ArrowPathIcon,
    CalendarIcon,
    UserIcon,
    ShieldCheckIcon
} from '@heroicons/react/24/outline';

const formatTimeAgo = (date: Date) => {
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return 'just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;

    return date.toLocaleDateString();
};

type Notification = {
    id: string;
    title: string;
    message: string;
    type: string;
    link?: string;
    isRead: boolean;
    createdAt: string;
};

type WorkerTask = {
    id: string;
    name: string;
    taskType: string;
    status: string;
    createdAt: string;
    completedAt?: string;
    error?: string;
    events?: any[];
};

type SystemUpdate = {
    id: string;
    type: string;
    title: string;
    message: string;
    status: string;
    createdAt: string;
    metadata?: any;
};

type Announcement = {
    id: string;
    title: string;
    message: string;
    type: string;
    createdAt: string;
};

export default function NotificationsPage() {
    const [activeTab, setActiveTab] = useState<'all' | 'alerts' | 'tasks' | 'system'>('all');
    const [data, setData] = useState<{
        notifications: Notification[];
        announcements: Announcement[];
        workerTasks: WorkerTask[];
        systemUpdates: SystemUpdate[];
        isAdmin: boolean;
    } | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchUpdates = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/updates');
            if (res.status === 401) {
                setError('Please sign in to view your notifications.');
                return;
            }
            if (res.ok) {
                const json = await res.json();
                setData(json);
            } else {
                setError('Failed to load updates. Please try again later.');
            }
        } catch (error) {
            console.error('Failed to fetch updates:', error);
            setError('An unexpected error occurred.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUpdates();
    }, []);

    if (loading && !data) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-slate-950 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-slate-950 flex items-center justify-center py-12 px-4">
                <div className="max-w-md w-full bg-white dark:bg-slate-900 p-8 rounded-3xl border border-gray-100 dark:border-slate-800 shadow-xl text-center">
                    <div className="w-16 h-16 bg-red-50 dark:bg-red-900/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                        <ShieldCheckIcon className="w-8 h-8 text-red-500" />
                    </div>
                    <h2 className="text-2xl font-black text-gray-900 dark:text-white mb-2">Access Denied</h2>
                    <p className="text-gray-500 dark:text-slate-400 mb-8">{error}</p>
                    <button
                        onClick={() => window.location.href = '/'}
                        className="w-full py-4 bg-primary text-white font-black rounded-2xl hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 active:scale-95"
                    >
                        GO TO HOME
                    </button>
                </div>
            </div>
        );
    }

    const announcements = data?.announcements || [];
    const notifications = data?.notifications || [];

    const filteredNotifications = notifications.filter(n => {
        if (activeTab === 'all') return true;
        if (activeTab === 'alerts') return n.type.includes('alert');
        return false;
    });

    const filteredSystem = activeTab === 'all' || activeTab === 'system'
        ? [...(data?.systemUpdates || []), ...announcements.map(a => ({
            id: `ann-${a.id}`,
            type: 'announcement',
            title: a.title,
            message: a.message,
            status: a.type,
            createdAt: a.createdAt
        }))].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        : [];

    const filteredTasks = activeTab === 'all' || activeTab === 'tasks' ? data?.workerTasks || [] : [];

    const getStatusColor = (status: string) => {
        switch (status.toLowerCase()) {
            case 'completed':
            case 'success':
            case 'success':
                return 'text-green-500 bg-green-50 dark:bg-green-900/10';
            case 'failed':
            case 'error':
                return 'text-red-500 bg-red-50 dark:bg-red-900/10';
            case 'running':
            case 'pending':
            case 'warning':
                return 'text-yellow-500 bg-yellow-50 dark:bg-yellow-900/10';
            default:
                return 'text-blue-500 bg-blue-50 dark:bg-blue-900/10';
        }
    };

    const getIcon = (type: string, status?: string) => {
        if (type === 'announcement') return <InformationCircleIcon className="w-5 h-5" />;
        if (type === 'system_log') return <ShieldCheckIcon className="w-5 h-5" />;
        if (status === 'error' || status === 'failed') return <ExclamationCircleIcon className="w-5 h-5" />;
        return <BellIcon className="w-5 h-5" />;
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-slate-950 py-12 px-4 sm:px-6 lg:px-8 pt-24">
            <div className="max-w-4xl mx-auto">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                    <div>
                        <h1 className="text-3xl font-black text-gray-900 dark:text-white flex items-center gap-3">
                            <BellIcon className="w-8 h-8 text-primary" />
                            Notifications & Updates
                        </h1>
                        <p className="text-gray-500 dark:text-slate-400 mt-2">
                            Stay updated with system tasks, alerts, and recent activities.
                        </p>
                    </div>
                    <button
                        onClick={fetchUpdates}
                        className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm font-bold text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-all shadow-sm active:scale-95"
                    >
                        <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh Feed
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex p-1 bg-gray-200/50 dark:bg-slate-900/50 rounded-2xl mb-8 overflow-x-auto no-scrollbar">
                    {(['all', 'alerts', 'tasks', 'system'] as const).map((tab) => {
                        if (tab === 'tasks' && !data?.isAdmin) return null;
                        return (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`flex-1 min-w-[100px] py-2.5 text-sm font-bold rounded-xl transition-all ${activeTab === tab
                                        ? 'bg-white dark:bg-slate-800 text-primary shadow-sm'
                                        : 'text-gray-500 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-300'
                                    } capitalize`}
                            >
                                {tab}
                            </button>
                        );
                    })}
                </div>

                <div className="space-y-4">
                    {/* Combined Feed */}
                    {activeTab === 'all' && (
                        <div className="grid gap-4">
                            {/* Personal Notifications */}
                            {filteredNotifications.map(n => (
                                <div key={n.id} className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm hover:shadow-md transition-all">
                                    <div className="flex items-start gap-4">
                                        <div className={`p-2.5 rounded-xl ${getStatusColor(n.type)}`}>
                                            <BellIcon className="w-5 h-5" />
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between gap-2">
                                                <h3 className="font-bold text-gray-900 dark:text-white">{n.title}</h3>
                                                <span className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase">
                                                    {formatTimeAgo(new Date(n.createdAt))}
                                                </span>
                                            </div>
                                            <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">{n.message}</p>
                                            {n.link && (
                                                <a href={n.link} className="inline-block mt-3 text-xs font-bold text-primary hover:underline">
                                                    View details &rarr;
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {/* System Updates & Announcements */}
                            {filteredSystem.map(update => (
                                <div key={update.id} className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm hover:shadow-md transition-all">
                                    <div className="flex items-start gap-4">
                                        <div className={`p-2.5 rounded-xl ${getStatusColor(update.status)}`}>
                                            {getIcon(update.type, update.status)}
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between gap-2">
                                                <h3 className="font-bold text-gray-900 dark:text-white">{update.title}</h3>
                                                <span className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase">
                                                    {update.type === 'announcement' ? 'Announcement' : 'System'} • {formatTimeAgo(new Date(update.createdAt))}
                                                </span>
                                            </div>
                                            <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">{update.message}</p>
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {/* Admin Specific: Worker Tasks */}
                            {data?.isAdmin && data.workerTasks.map(task => (
                                <div key={task.id} className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm hover:shadow-md transition-all">
                                    <div className="flex items-start gap-4">
                                        <div className={`p-2.5 rounded-xl ${getStatusColor(task.status)}`}>
                                            <CpuChipIcon className="w-5 h-5" />
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between gap-2">
                                                <h3 className="font-bold text-gray-900 dark:text-white">{task.name || task.taskType}</h3>
                                                <span className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase">
                                                    Worker Task • {formatTimeAgo(new Date(task.createdAt))}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${getStatusColor(task.status)}`}>
                                                    {task.status}
                                                </span>
                                                <p className="text-sm text-gray-600 dark:text-slate-400">{task.error || 'Running automatically by system worker'}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {filteredNotifications.length === 0 && filteredSystem.length === 0 && (!data?.isAdmin || data.workerTasks.length === 0) && (
                                <div className="py-20 text-center bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-gray-200 dark:border-slate-800">
                                    <InformationCircleIcon className="w-12 h-12 text-gray-300 dark:text-slate-700 mx-auto mb-4" />
                                    <p className="text-gray-500 dark:text-slate-400 font-bold">All caught up! No new updates.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Individual Tabs */}
                    {activeTab === 'alerts' && (
                        <div className="space-y-4">
                            {filteredNotifications.length > 0 ? filteredNotifications.map(n => (
                                /* Notification render (same as above, shortened for brevity) */
                                <div key={n.id} className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm hover:shadow-md transition-all">
                                    <div className="flex items-start gap-4">
                                        <div className={`p-2.5 rounded-xl ${getStatusColor(n.type)}`}>
                                            <BellIcon className="w-5 h-5" />
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between">
                                                <h3 className="font-bold text-gray-900 dark:text-white">{n.title}</h3>
                                                <span className="text-xs text-gray-400">{formatTimeAgo(new Date(n.createdAt))}</span>
                                            </div>
                                            <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">{n.message}</p>
                                        </div>
                                    </div>
                                </div>
                            )) : (
                                <div className="py-20 text-center bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-gray-200 dark:border-slate-800">
                                    <InformationCircleIcon className="w-12 h-12 text-gray-300 dark:text-slate-700 mx-auto mb-4" />
                                    <p className="text-gray-500 dark:text-slate-400 font-bold">No price alerts found.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'tasks' && data?.isAdmin && (
                        <div className="space-y-4">
                            {data.workerTasks.length > 0 ? data.workerTasks.map(task => (
                                <div key={task.id} className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-lg ${getStatusColor(task.status)}`}>
                                                <CpuChipIcon className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-gray-900 dark:text-white capitalize">{task.name || task.taskType.replace('_', ' ')}</h3>
                                                <p className="text-xs text-gray-500">ID: {task.id.split('-')[0]}... • {formatTimeAgo(new Date(task.createdAt))}</p>
                                            </div>
                                        </div>
                                        <span className={`px-3 py-1 rounded-full text-xs font-black uppercase ${getStatusColor(task.status)}`}>
                                            {task.status}
                                        </span>
                                    </div>

                                    {task.error && (
                                        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-100 dark:border-red-900/20">
                                            <p className="text-xs text-red-600 dark:text-red-400 font-mono font-bold uppercase mb-1 flex items-center gap-1">
                                                <ExclamationCircleIcon className="w-3 h-3" /> Error Details
                                            </p>
                                            <p className="text-sm text-red-700 dark:text-red-300">{task.error}</p>
                                        </div>
                                    )}

                                    <div className="space-y-2">
                                        <p className="text-xs font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-2">Detailed Timeline</p>
                                        {task.events?.map((event: any) => (
                                            <div key={event.id} className="flex gap-3 pl-2 border-l-2 border-gray-100 dark:border-slate-800">
                                                <div className="text-[10px] text-gray-400 font-mono pt-1 min-w-[60px]">{new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
                                                <div className="flex-1 pb-2">
                                                    <p className="text-xs font-bold text-gray-700 dark:text-slate-300">{event.message || event.eventType.replace('_', ' ')}</p>
                                                    {event.metadata && <pre className="text-[10px] mt-1 p-2 bg-gray-50 dark:bg-slate-800/50 rounded-lg overflow-x-auto text-gray-500 no-scrollbar">{JSON.stringify(event.metadata, null, 2)}</pre>}
                                                </div>
                                            </div>
                                        ))}
                                        {(!task.events || task.events.length === 0) && (
                                            <p className="text-xs text-gray-400 italic">No events recorded for this task</p>
                                        )}
                                    </div>
                                </div>
                            )) : (
                                <div className="py-20 text-center bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-gray-200 dark:border-slate-800">
                                    <p className="text-gray-500 dark:text-slate-400 font-bold">No worker tasks found.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'system' && data?.isAdmin && (
                        <div className="space-y-4">
                            {data.systemUpdates.length > 0 ? data.systemUpdates.map(update => (
                                <div key={update.id} className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm transition-all hover:border-primary/20 cursor-default group">
                                    <div className="flex items-start gap-4">
                                        <div className={`p-3 rounded-2xl transition-all group-hover:scale-110 ${getStatusColor(update.status)}`}>
                                            {getIcon(update.type, update.status)}
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between gap-2">
                                                <h3 className="font-bold text-gray-900 dark:text-white">{update.title}</h3>
                                                <span className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase flex items-center gap-1">
                                                    <ClockIcon className="w-3 h-3" /> {formatTimeAgo(new Date(update.createdAt))}
                                                </span>
                                            </div>
                                            <p className="text-sm text-gray-600 dark:text-slate-400 mt-1 leading-relaxed">{update.message}</p>

                                            {update.metadata && (
                                                <div className="mt-4 pt-4 border-t border-gray-50 dark:border-slate-800/50">
                                                    <button className="text-[10px] font-black tracking-widest text-primary uppercase flex items-center gap-1 hover:opacity-80 transition-opacity">
                                                        <InformationCircleIcon className="w-3 h-3" /> View Diagnostic Metadata
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )) : (
                                <div className="py-20 text-center bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-gray-200 dark:border-slate-800">
                                    <p className="text-gray-500 dark:text-slate-400 font-bold">No system updates recorded.</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
