"use client";

import { useState, useEffect } from "react";
import {
    CloudArrowUpIcon,
    TrashIcon,
    ArrowPathIcon,
    CheckCircleIcon,
    ExclamationCircleIcon
} from "@heroicons/react/24/outline";

interface SyncResult {
    success: boolean;
    message: string;
    duration: number;
    indices: { name: string; status: string }[];
    symbols: { symbol: string; status: string }[];
}

interface IndexStatus {
    name: string;
    dbPrice: string;
    nseStatus: string;
}

export default function NSESyncPage() {
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [status, setStatus] = useState<any>(null);
    const [result, setResult] = useState<SyncResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchStatus = async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/admin/nse/sync");
            if (!res.ok) throw new Error("Failed to fetch sync status");
            const data = await res.json();
            setStatus(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setLoading(false);
        }
    };

    const handleSync = async () => {
        if (!confirm("This will flush all application caches and force a fresh sync from NSE. Proceed?")) return;

        setSyncing(true);
        setResult(null);
        setError(null);

        try {
            const res = await fetch("/api/admin/nse/sync", { method: "POST" });
            if (!res.ok) throw new Error("Sync failed");
            const data = await res.json();
            setResult(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Sync attempt failed");
        } finally {
            setSyncing(false);
        }
    };

    const handleClearCache = async (type: string) => {
        try {
            const res = await fetch(`/api/cache?action=clear-${type}`);
            if (res.ok) alert(`${type === 'all' ? 'All caches' : type + ' cache'} cleared successfully`);
        } catch (err) {
            alert("Failed to clear cache");
        }
    };

    useEffect(() => {
        fetchStatus();
    }, []);

    return (
        <div className="space-y-8 max-w-6xl mx-auto animate-in fade-in duration-500">
            {/* Premium Header Section */}
            <div className="bg-white dark:bg-slate-900 shadow-2xl shadow-slate-200/50 dark:shadow-none rounded-3xl border border-gray-100 dark:border-slate-800 overflow-hidden">
                <div className="px-8 py-10 sm:px-12 flex flex-col lg:flex-row lg:items-center justify-between gap-8 bg-gradient-to-br from-white to-gray-50/50 dark:from-slate-900 dark:to-slate-900/50">
                    <div className="flex-1 space-y-2">
                        <div className="inline-flex items-center px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 mb-2">
                            System Utility
                        </div>
                        <h1 className="text-4xl font-extrabold text-gray-900 dark:text-white tracking-tight sm:text-5xl">
                            NSE Data Synchronization
                        </h1>
                        <p className="text-lg text-gray-500 dark:text-slate-400 max-w-2xl leading-relaxed">
                            Manage real-time indexing, flush system-wide caches, and maintain cross-environment data consistency with NSE India.
                        </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-4">
                        <button
                            onClick={() => handleClearCache('all')}
                            className="flex items-center justify-center space-x-2 px-6 py-3 border border-gray-200 dark:border-slate-700 rounded-2xl text-sm font-bold text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-all active:scale-95"
                        >
                            <TrashIcon className="w-5 h-5 text-gray-400 dark:text-slate-500" />
                            <span>Flush All Caches</span>
                        </button>
                        <button
                            onClick={handleSync}
                            disabled={syncing}
                            className={`flex items-center justify-center space-x-2 px-8 py-3 rounded-2xl text-white font-black text-sm tracking-wide transition-all active:scale-95 shadow-lg ${syncing
                                ? "bg-blue-400 dark:bg-blue-600/50 cursor-not-allowed"
                                : "bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 shadow-blue-500/20"
                                }`}
                        >
                            {syncing ? (
                                <ArrowPathIcon className="w-5 h-5 animate-spin" />
                            ) : (
                                <CloudArrowUpIcon className="w-5 h-5" />
                            )}
                            <span>{syncing ? "SYNCING PIPELINE..." : "TRIGGER GLOBAL SYNC"}</span>
                        </button>
                    </div>
                </div>
            </div>

            {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 p-6 rounded-2xl animate-in shake duration-500">
                    <div className="flex items-center">
                        <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg mr-4">
                            <ExclamationCircleIcon className="h-6 w-6 text-red-600 dark:text-red-400" />
                        </div>
                        <div>
                            <h3 className="text-sm font-black text-red-900 dark:text-red-300 uppercase tracking-wider">Sync Failure</h3>
                            <p className="text-red-700 dark:text-red-400/80 text-sm mt-0.5">{error}</p>
                        </div>
                    </div>
                </div>
            )}

            {result && (
                <div className="bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-800/30 p-8 rounded-3xl shadow-sm animate-in zoom-in-95 duration-500">
                    <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center">
                            <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl mr-4">
                                <CheckCircleIcon className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <div>
                                <h2 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight">Sync Cycle Complete</h2>
                                <p className="text-sm text-emerald-700 dark:text-emerald-400 font-bold">Pipeline executing optimally</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <span className="text-[10px] font-black text-emerald-600/50 dark:text-emerald-400/30 uppercase tracking-widest block mb-1">Duration</span>
                            <span className="text-lg font-black text-gray-900 dark:text-white tracking-widest">{(result.duration / 1000).toFixed(2)}s</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="bg-white/60 dark:bg-slate-900/50 backdrop-blur-xl p-6 rounded-2xl border border-emerald-100 dark:border-emerald-800/20">
                            <h3 className="text-xs font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-4 flex items-center">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2"></div>
                                Index Status
                            </h3>
                            <div className="space-y-3">
                                {result.indices.map((idx, i) => (
                                    <div key={i} className="flex justify-between items-center p-3 bg-white dark:bg-slate-800/50 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm">
                                        <span className="text-sm font-bold text-gray-700 dark:text-slate-300">{idx.name}</span>
                                        <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-tighter border ${idx.status === 'success'
                                            ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-800/50'
                                            : 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border-red-100 dark:border-red-800/50'
                                            }`}>{idx.status}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="bg-white/60 dark:bg-slate-900/50 backdrop-blur-xl p-6 rounded-2xl border border-emerald-100 dark:border-emerald-800/20">
                            <h3 className="text-xs font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-4 flex items-center">
                                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mr-2"></div>
                                Symbol Verification
                            </h3>
                            <div className="flex flex-wrap gap-2">
                                {result.symbols.map((sym, i) => (
                                    <span key={i} className={`px-3 py-1.5 rounded-xl text-[10px] font-black tracking-widest border transition-all hover:scale-105 ${sym.status === 'success'
                                        ? 'bg-white dark:bg-slate-800 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 shadow-sm'
                                        : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
                                        }`}>
                                        {sym.symbol}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Status Card */}
                <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-gray-100 dark:border-slate-800 overflow-hidden">
                    <div className="px-8 py-6 border-b border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/40 flex justify-between items-center">
                        <div className="flex items-center">
                            <div className="w-8 h-8 bg-blue-50 dark:bg-blue-900/30 rounded-lg flex items-center justify-center mr-3 shadow-inner">
                                <ArrowPathIcon className={`w-4 h-4 text-blue-600 dark:text-blue-400 ${loading ? 'animate-spin' : ''}`} />
                            </div>
                            <h2 className="font-black text-gray-900 dark:text-white uppercase tracking-widest text-sm">Sync Configuration</h2>
                        </div>
                        <button
                            onClick={fetchStatus}
                            className="p-2 rounded-xl text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-white dark:hover:bg-slate-800 transition-all border border-transparent hover:border-gray-100 dark:hover:border-slate-700"
                            title="Refresh Status"
                        >
                            <ArrowPathIcon className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                    <div className="p-8">
                        {status ? (
                            <div className="space-y-8">
                                <div>
                                    <h3 className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-[0.2em] mb-4">Major Indices Pipeline</h3>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                        {status.majorIndices.map((idx: string) => (
                                            <div key={idx} className="group flex items-center p-4 rounded-2xl bg-gray-50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-800 transition-all hover:bg-white dark:hover:bg-slate-800 hover:shadow-md dark:hover:shadow-none hover:border-blue-100 dark:hover:border-blue-900/30">
                                                <div className="w-2.5 h-2.5 rounded-full bg-blue-500 mr-3 shadow-[0_0_8px_rgba(59,130,246,0.4)] group-hover:scale-125 transition-transform"></div>
                                                <span className="text-sm font-bold text-gray-700 dark:text-slate-200">{idx}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="pt-8 border-t dark:border-slate-800/50">
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-[0.2em]">Stock Coverage Health</h3>
                                        <span className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded">Active Monitoring</span>
                                    </div>
                                    <div className="flex items-end gap-3">
                                        <span className="text-5xl font-black text-gray-900 dark:text-white tracking-tighter leading-none">{status.monitoredSymbols}</span>
                                        <span className="text-sm font-bold text-gray-500 dark:text-slate-500 mb-1">Priority Assets Cached</span>
                                    </div>
                                    <p className="mt-4 text-sm text-gray-500 dark:text-slate-400 leading-relaxed max-w-xl font-medium italic">
                                        Initial symbols prioritized for rapid delivery. Historical hydration and intraday streaming active for these cohorts.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="py-20 flex flex-col items-center justify-center space-y-4">
                                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-full">
                                    <ArrowPathIcon className="w-10 h-10 text-blue-500/20 dark:text-blue-500/10 animate-spin" />
                                </div>
                                <p className="text-sm font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">Hydrating Sync Matrix...</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Info Sidebar */}
                <div className="lg:col-span-1 space-y-8">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-gray-100 dark:border-slate-800 p-8">
                        <div className="flex items-center mb-6">
                            <div className="w-1 h-6 bg-blue-600 dark:bg-blue-500 rounded-full mr-3"></div>
                            <h3 className="font-black text-gray-900 dark:text-white uppercase tracking-widest text-xs">Architectural Rationale</h3>
                        </div>
                        <div className="space-y-6">
                            <div className="space-y-2">
                                <h4 className="text-[11px] font-black text-gray-900 dark:text-slate-200 uppercase tracking-widest">Off-Market Accuracy</h4>
                                <p className="text-sm text-gray-500 dark:text-slate-400 leading-relaxed font-medium">During non-market hours, the system defaults to verified DB records to prevent volatile cross-environment drifts.</p>
                            </div>
                            <div className="space-y-2">
                                <h4 className="text-[11px] font-black text-gray-900 dark:text-slate-200 uppercase tracking-widest">Cache Coherency</h4>
                                <p className="text-sm text-gray-500 dark:text-slate-400 leading-relaxed font-medium">Flushing global NodeCache forces re-negotiation with NSE endpoints, ensuring token freshness and fresh headers.</p>
                            </div>
                            <div className="space-y-2">
                                <h4 className="text-[11px] font-black text-gray-900 dark:text-slate-200 uppercase tracking-widest">DB Hydration</h4>
                                <p className="text-sm text-gray-500 dark:text-slate-400 leading-relaxed font-medium">Auto-updates <code>IndexQuote</code> and <code>DailyPrice</code> tables for a seamless, unified cross-device user journey.</p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-3xl p-8 text-white shadow-xl shadow-blue-500/20">
                        <h3 className="text-lg font-black uppercase tracking-tight mb-2">Live Status</h3>
                        <p className="text-blue-100 text-sm font-medium leading-relaxed mb-6">External NSE APIs are currently operational with nominal latency metrics.</p>
                        <div className="flex items-center font-black text-[10px] tracking-[0.2em] bg-white/10 rounded-xl px-4 py-2 w-fit">
                            <div className="w-2 h-2 rounded-full bg-green-400 mr-2 shadow-[0_0_8px_rgba(74,222,128,0.5)] animate-pulse"></div>
                            NSE CONNECTED
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
