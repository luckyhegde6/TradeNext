"use client";

import { useState, useEffect } from "react";
import {
    CloudArrowUpIcon,
    TrashIcon,
    ArrowPathIcon,
    CheckCircleIcon,
    ExclamationCircleIcon,
    CalendarIcon,
    DocumentTextIcon,
    ChartBarIcon,
    ClipboardDocumentListIcon,
    UserGroupIcon,
    BoltIcon,
    ArrowTrendingUpIcon,
    ArrowTrendingDownIcon,
    ChartBarSquareIcon,
    BuildingLibraryIcon,
} from "@heroicons/react/24/outline";

interface SyncResult {
    success: boolean;
    message: string;
    duration: number;
    indices: { name: string; status: string }[];
    symbols: { symbol: string; status: string }[];
}

interface LiveSyncResult {
    success: boolean;
    type: string;
    count: number;
    message: string;
    duration: number;
    advances?: number;
    declines?: number;
    unchanged?: number;
    blockDeals?: number;
    bulkDeals?: number;
    shortSelling?: number;
}

interface HistoricalSyncResult {
    success: boolean;
    type: string;
    fromDate: string;
    toDate: string;
    recordsFetched: number;
    recordsSaved: number;
    duration: number;
    message: string;
}

interface IndexStatus {
    name: string;
    dbPrice: string;
    nseStatus: string;
}

type DataType = 'corporate_actions' | 'announcements' | 'events' | 'results' | 'insider';

type LiveSyncType = 'advance_decline' | 'corporate_actions' | 'announcements' | 'events' | 'deals' | 'volume' | 'insider';

interface SyncResult {
    success: boolean;
    message: string;
    duration: number;
    indices: { name: string; status: string }[];
    symbols: { symbol: string; status: string }[];
}

interface HistoricalSyncResult {
    success: boolean;
    type: string;
    fromDate: string;
    toDate: string;
    recordsFetched: number;
    recordsSaved: number;
    duration: number;
    message: string;
}

interface IndexStatus {
    name: string;
    dbPrice: string;
    nseStatus: string;
}

interface LiveSyncTile {
    id: LiveSyncType;
    label: string;
    description: string;
    icon: React.ReactNode;
    color: string;
}

const liveSyncTiles: LiveSyncTile[] = [
    {
        id: 'advance_decline',
        label: 'Advance / Decline',
        description: 'Market breadth data',
        icon: <ArrowTrendingUpIcon className="w-6 h-6" />,
        color: 'blue',
    },
    {
        id: 'corporate_actions',
        label: 'Corporate Actions',
        description: 'Dividends, Splits, Bonus',
        icon: <ClipboardDocumentListIcon className="w-6 h-6" />,
        color: 'green',
    },
    {
        id: 'announcements',
        label: 'Announcements',
        description: 'Corporate announcements',
        icon: <DocumentTextIcon className="w-6 h-6" />,
        color: 'purple',
    },
    {
        id: 'events',
        label: 'Event Calendar',
        description: 'Earnings, dividends, AGMs',
        icon: <CalendarIcon className="w-6 h-6" />,
        color: 'orange',
    },
    {
        id: 'deals',
        label: 'Large Deals',
        description: 'Block, Bulk, Short Selling',
        icon: <ChartBarSquareIcon className="w-6 h-6" />,
        color: 'red',
    },
    {
        id: 'volume',
        label: 'Volume Analysis',
        description: 'Most active stocks',
        icon: <ArrowTrendingDownIcon className="w-6 h-6" />,
        color: 'cyan',
    },
    {
        id: 'insider',
        label: 'Insider Trading',
        description: 'Promoter, stakeholder',
        icon: <UserGroupIcon className="w-6 h-6" />,
        color: 'pink',
    },
];

export default function NSESyncPage() {
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [historicalSyncing, setHistoricalSyncing] = useState(false);
    const [stockSyncing, setStockSyncing] = useState(false);
    const [status, setStatus] = useState<any>(null);
    const [result, setResult] = useState<SyncResult | null>(null);
    const [historicalResult, setHistoricalResult] = useState<HistoricalSyncResult | null>(null);
    const [stockSyncResult, setStockSyncResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    
    // Live sync state
    const [liveSyncing, setLiveSyncing] = useState(false);
    const [liveSyncType, setLiveSyncType] = useState<LiveSyncType | null>(null);
    const [liveSyncResults, setLiveSyncResults] = useState<LiveSyncResult[]>([]);
    
    // Stock sync state
    const [stockIndices, setStockIndices] = useState<{ name: string; url: string }[]>([]);
    const [selectedIndices, setSelectedIndices] = useState<string[]>([]);
    
    // Historical sync state
    const [fromDate, setFromDate] = useState<string>("");
    const [toDate, setToDate] = useState<string>("");
    const [selectedTypes, setSelectedTypes] = useState<DataType[]>([]);
    const [symbolFilter, setSymbolFilter] = useState<string>("");

    const dataTypes: { id: DataType; label: string; icon: React.ReactNode; description: string }[] = [
        { 
            id: 'corporate_actions', 
            label: 'Corporate Actions', 
            icon: <ClipboardDocumentListIcon className="w-5 h-5" />,
            description: 'Dividends, Splits, Bonus, Rights, Buybacks'
        },
        { 
            id: 'announcements', 
            label: 'Corporate Announcements', 
            icon: <DocumentTextIcon className="w-5 h-5" />,
            description: 'Board meetings, results, closures'
        },
        { 
            id: 'events', 
            label: 'Event Calendar', 
            icon: <CalendarIcon className="w-5 h-5" />,
            description: 'Earnings, dividends, AGMs'
        },
        { 
            id: 'results', 
            label: 'Financial Results', 
            icon: <ChartBarIcon className="w-5 h-5" />,
            description: 'Quarterly, annual results'
        },
        { 
            id: 'insider', 
            label: 'Insider Trading', 
            icon: <UserGroupIcon className="w-5 h-5" />,
            description: 'Promoter, stakeholder changes'
        },
    ];

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

    const handleHistoricalSync = async () => {
        if (!fromDate || !toDate) {
            setError("Please select both from and to dates");
            return;
        }

        if (selectedTypes.length === 0) {
            setError("Please select at least one data type to sync");
            return;
        }

        if (!confirm(`Sync historical data from ${fromDate} to ${toDate} for ${selectedTypes.length} data type(s)?`)) return;

        setHistoricalSyncing(true);
        setHistoricalResult(null);
        setError(null);

        try {
            const res = await fetch("/api/admin/nse/historical", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    types: selectedTypes,
                    fromDate,
                    toDate,
                    symbol: symbolFilter || undefined
                })
            });
            
            if (!res.ok) throw new Error("Historical sync failed");
            const data = await res.json();
            setHistoricalResult(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Historical sync failed");
        } finally {
            setHistoricalSyncing(false);
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

    // Live sync handler
    const handleLiveSync = async (type: LiveSyncType) => {
        if (!confirm(`Sync ${type.replace(/_/g, ' ')} data from NSE now? This will fetch fresh data.`)) return;

        setLiveSyncing(true);
        setLiveSyncType(type);
        setError(null);

        try {
            const res = await fetch("/api/admin/nse/live-sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type, forceRefresh: true })
            });
            
            if (!res.ok) throw new Error("Live sync failed");
            const data = await res.json();
            
            const result: LiveSyncResult = {
                success: data.success,
                type,
                count: data.count || 0,
                message: data.message,
                duration: data.duration,
                advances: data.advances,
                declines: data.declines,
                unchanged: data.unchanged,
                blockDeals: data.blockDeals,
                bulkDeals: data.bulkDeals,
                shortSelling: data.shortSelling,
            };
            
            setLiveSyncResults(prev => [result, ...prev].slice(0, 10)); // Keep last 10 results
        } catch (err) {
            setError(err instanceof Error ? err.message : "Live sync failed");
        } finally {
            setLiveSyncing(false);
            setLiveSyncType(null);
        }
    };

    const toggleDataType = (type: DataType) => {
        setSelectedTypes(prev => 
            prev.includes(type) 
                ? prev.filter(t => t !== type)
                : [...prev, type]
        );
    };

    const fetchStockIndices = async () => {
        try {
            const res = await fetch("/api/admin/nse/stocks?action=list");
            const data = await res.json();
            setStockIndices(data.indices || []);
        } catch (err) {
            console.error("Failed to fetch stock indices:", err);
        }
    };

    const handleStockSync = async () => {
        if (selectedIndices.length === 0) {
            setError("Please select at least one index to sync");
            return;
        }

        if (!confirm(`Sync stocks from ${selectedIndices.length} index(es)?`)) return;

        setStockSyncing(true);
        setStockSyncResult(null);
        setError(null);

        try {
            const res = await fetch("/api/admin/nse/stocks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ indices: selectedIndices })
            });
            
            if (!res.ok) throw new Error("Stock sync failed");
            const data = await res.json();
            setStockSyncResult(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Stock sync failed");
        } finally {
            setStockSyncing(false);
        }
    };

    const toggleIndex = (indexName: string) => {
        setSelectedIndices(prev => 
            prev.includes(indexName) 
                ? prev.filter(i => i !== indexName)
                : [...prev, indexName]
        );
    };

    // Set default dates (last 1 year)
    useEffect(() => {
        const today = new Date();
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(today.getFullYear() - 1);
        
        const formatDate = (d: Date) => {
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            return `${day}-${month}-${year}`;
        };
        
        setToDate(formatDate(today));
        setFromDate(formatDate(oneYearAgo));
    }, []);

    useEffect(() => {
        fetchStatus();
        fetchStockIndices();
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

            {/* Live Data Sync Section */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-gray-100 dark:border-slate-800 overflow-hidden">
                <div className="px-8 py-6 border-b border-gray-100 dark:border-slate-800 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-slate-800/40 dark:to-slate-800/40">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center">
                            <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg flex items-center justify-center mr-3">
                                <BoltIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <div>
                                <h2 className="font-black text-gray-900 dark:text-white uppercase tracking-widest text-sm">Live Data Sync</h2>
                                <p className="text-sm text-emerald-700 dark:text-emerald-400 mt-1">
                                    Fetch fresh data from NSE immediately - bypasses cache for instant updates
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div className="p-8">
                    {/* Live Sync Tiles Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-8">
                        {liveSyncTiles.map((tile) => (
                            <button
                                key={tile.id}
                                onClick={() => handleLiveSync(tile.id)}
                                disabled={liveSyncing}
                                className={`p-4 rounded-xl border-2 transition-all text-left hover:scale-105 active:scale-95 ${
                                    liveSyncType === tile.id
                                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                                        : 'border-gray-200 dark:border-slate-700 hover:border-emerald-300'
                                }`}
                            >
                                <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg mb-3 ${
                                    tile.color === 'blue' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' :
                                    tile.color === 'green' ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' :
                                    tile.color === 'purple' ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400' :
                                    tile.color === 'orange' ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400' :
                                    tile.color === 'red' ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' :
                                    tile.color === 'cyan' ? 'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400' :
                                    'bg-pink-100 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400'
                                }`}>
                                    {liveSyncing && liveSyncType === tile.id ? (
                                        <ArrowPathIcon className="w-5 h-5 animate-spin" />
                                    ) : (
                                        tile.icon
                                    )}
                                </div>
                                <div className="text-xs font-bold text-gray-900 dark:text-white">{tile.label}</div>
                                <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-1">{tile.description}</div>
                            </button>
                        ))}
                    </div>

                    {/* Live Sync Results */}
                    {liveSyncResults.length > 0 && (
                        <div className="space-y-3">
                            <h3 className="text-xs font-black text-gray-500 dark:text-slate-400 uppercase tracking-wider">Recent Sync Results</h3>
                            {liveSyncResults.map((result, idx) => (
                                <div 
                                    key={idx}
                                    className={`p-4 rounded-xl border-2 ${
                                        result.success 
                                            ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800' 
                                            : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'
                                    }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center">
                                            {result.success ? (
                                                <CheckCircleIcon className="w-5 h-5 text-emerald-600 mr-3" />
                                            ) : (
                                                <ExclamationCircleIcon className="w-5 h-5 text-red-600 mr-3" />
                                            )}
                                            <div>
                                                <div className="text-sm font-bold text-gray-900 dark:text-white capitalize">
                                                    {result.type.replace(/_/g, ' ')}
                                                </div>
                                                <div className="text-xs text-gray-600 dark:text-gray-400">
                                                    {result.message}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-lg font-black text-gray-900 dark:text-white">
                                                {result.count}
                                            </div>
                                            <div className="text-[10px] text-gray-500 dark:text-slate-400">
                                                {result.duration}ms
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Historical Sync Section */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-gray-100 dark:border-slate-800 overflow-hidden">
                <div className="px-8 py-6 border-b border-gray-100 dark:border-slate-800 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-slate-800/40 dark:to-slate-800/40">
                    <div className="flex items-center">
                        <div className="w-8 h-8 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center mr-3">
                            <CalendarIcon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <h2 className="font-black text-gray-900 dark:text-white uppercase tracking-widest text-sm">Historical Data Sync</h2>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mt-2">
                        Fetch and sync historical data from NSE by specifying a date range. This updates the database with past corporate actions, announcements, and more.
                    </p>
                </div>
                
                <div className="p-8 space-y-6">
                    {/* Date Range Selection */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-xs font-black text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                                From Date (DD-MM-YYYY)
                            </label>
                            <input
                                type="text"
                                value={fromDate}
                                onChange={(e) => setFromDate(e.target.value)}
                                placeholder="13-03-2025"
                                className="w-full px-4 py-3 border border-gray-200 dark:border-slate-700 rounded-xl bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-black text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                                To Date (DD-MM-YYYY)
                            </label>
                            <input
                                type="text"
                                value={toDate}
                                onChange={(e) => setToDate(e.target.value)}
                                placeholder="13-03-2026"
                                className="w-full px-4 py-3 border border-gray-200 dark:border-slate-700 rounded-xl bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-black text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                                Symbol (Optional)
                            </label>
                            <input
                                type="text"
                                value={symbolFilter}
                                onChange={(e) => setSymbolFilter(e.target.value)}
                                placeholder="RELIANCE"
                                className="w-full px-4 py-3 border border-gray-200 dark:border-slate-700 rounded-xl bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                    </div>

                    {/* Data Type Selection */}
                    <div>
                        <label className="block text-xs font-black text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                            Select Data Types to Sync
                        </label>
                        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                            {dataTypes.map((type) => (
                                <button
                                    key={type.id}
                                    onClick={() => toggleDataType(type.id)}
                                    className={`p-4 rounded-xl border-2 transition-all text-left ${
                                        selectedTypes.includes(type.id)
                                            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                                            : 'border-gray-200 dark:border-slate-700 hover:border-indigo-300'
                                    }`}
                                >
                                    <div className="flex items-center mb-2">
                                        <span className={`${selectedTypes.includes(type.id) ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400'}`}>
                                            {type.icon}
                                        </span>
                                        {selectedTypes.includes(type.id) && (
                                            <CheckCircleIcon className="w-4 h-4 text-indigo-600 ml-auto" />
                                        )}
                                    </div>
                                    <div className="text-xs font-bold text-gray-900 dark:text-white">{type.label}</div>
                                    <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-1">{type.description}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Sync Button */}
                    <div className="flex items-center gap-4">
                        <button
                            onClick={handleHistoricalSync}
                            disabled={historicalSyncing || selectedTypes.length === 0 || !fromDate || !toDate}
                            className={`flex items-center space-x-2 px-6 py-3 rounded-xl text-white font-black text-sm tracking-wide transition-all ${
                                historicalSyncing || selectedTypes.length === 0 || !fromDate || !toDate
                                    ? "bg-gray-400 cursor-not-allowed"
                                    : "bg-indigo-600 hover:bg-indigo-700"
                            }`}
                        >
                            {historicalSyncing ? (
                                <ArrowPathIcon className="w-5 h-5 animate-spin" />
                            ) : (
                                <CloudArrowUpIcon className="w-5 h-5" />
                            )}
                            <span>{historicalSyncing ? "SYNCING..." : "SYNC HISTORICAL DATA"}</span>
                        </button>
                        
                        <span className="text-xs text-gray-500 dark:text-slate-400">
                            {selectedTypes.length > 0 
                                ? `${selectedTypes.length} type(s) selected` 
                                : 'Select at least one data type'}
                        </span>
                    </div>

                    {/* Historical Sync Result */}
                    {historicalResult && (
                        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center">
                                    <CheckCircleIcon className="w-5 h-5 text-emerald-600 mr-2" />
                                    <span className="text-sm font-bold text-emerald-800 dark:text-emerald-300">
                                        {historicalResult.message}
                                    </span>
                                </div>
                                <span className="text-xs text-emerald-600 dark:text-emerald-400">
                                    {historicalResult.duration}ms
                                </span>
                            </div>
                            <div className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
                                Records fetched: {historicalResult.recordsFetched} | Saved to DB: {historicalResult.recordsSaved}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Stock List Sync Section */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-gray-100 dark:border-slate-800 overflow-hidden">
                <div className="px-8 py-6 border-b border-gray-100 dark:border-slate-800 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-slate-800/40 dark:to-slate-800/40">
                    <div className="flex items-center">
                        <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg flex items-center justify-center mr-3">
                            <BuildingLibraryIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <h2 className="font-black text-gray-900 dark:text-white uppercase tracking-widest text-sm">Stock List Sync</h2>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mt-2">
                        Fetch and sync stock symbols from NSE indices to populate the autocomplete database. This enables symbol search functionality across the platform.
                    </p>
                </div>
                
                <div className="p-8 space-y-6">
                    {/* Quick TOTAL Sync */}
                    <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-6">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center">
                                <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/40 rounded-xl flex items-center justify-center mr-4">
                                    <BuildingLibraryIcon className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-black text-amber-900 dark:text-amber-300">Sync Complete Market Data</h3>
                                    <p className="text-sm text-amber-700 dark:text-amber-400">Fetches all stocks from NIFTY TOTAL MARKET (~2000+ stocks)</p>
                                </div>
                            </div>
                            <button
                                onClick={async () => {
                                    if (!confirm("Sync ALL stocks from NIFTY TOTAL MARKET? This will populate the entire stock database.")) return;
                                    setStockSyncing(true);
                                    setStockSyncResult(null);
                                    setError(null);
                                    try {
                                        const res = await fetch("/api/admin/nse/stocks?action=sync&index=NIFTY%20TOTAL%20MARKET");
                                        const data = await res.json();
                                        setStockSyncResult(data);
                                    } catch (err) {
                                        setError(err instanceof Error ? err.message : "Stock sync failed");
                                    } finally {
                                        setStockSyncing(false);
                                    }
                                }}
                                disabled={stockSyncing}
                                className="px-6 py-3 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-400 text-white font-bold rounded-xl transition-all"
                            >
                                {stockSyncing ? (
                                    <span className="flex items-center">
                                        <ArrowPathIcon className="w-5 h-5 animate-spin mr-2" />
                                        SYNCING...
                                    </span>
                                ) : (
                                    "SYNC TOTAL MARKET"
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Index Selection */}
                    <div>
                        <label className="block text-xs font-black text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                            Or Select Individual Indices
                        </label>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {stockIndices.map((idx) => (
                                <button
                                    key={idx.url}
                                    onClick={() => toggleIndex(idx.url)}
                                    className={`p-3 rounded-xl border-2 transition-all text-left ${
                                        selectedIndices.includes(idx.url)
                                            ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                                            : 'border-gray-200 dark:border-slate-700 hover:border-emerald-300'
                                    }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-gray-900 dark:text-white">{idx.name}</span>
                                        {selectedIndices.includes(idx.url) && (
                                            <CheckCircleIcon className="w-4 h-4 text-emerald-600" />
                                        )}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Sync Button */}
                    <div className="flex items-center gap-4">
                        <button
                            onClick={handleStockSync}
                            disabled={stockSyncing || selectedIndices.length === 0}
                            className={`flex items-center space-x-2 px-6 py-3 rounded-xl text-white font-black text-sm tracking-wide transition-all ${
                                stockSyncing || selectedIndices.length === 0
                                    ? "bg-gray-400 cursor-not-allowed"
                                    : "bg-emerald-600 hover:bg-emerald-700"
                            }`}
                        >
                            {stockSyncing ? (
                                <ArrowPathIcon className="w-5 h-5 animate-spin" />
                            ) : (
                                <BuildingLibraryIcon className="w-5 h-5" />
                            )}
                            <span>{stockSyncing ? "SYNCING STOCKS..." : "SYNC STOCK LIST"}</span>
                        </button>
                        
                        <span className="text-xs text-gray-500 dark:text-slate-400">
                            {selectedIndices.length > 0 
                                ? `${selectedIndices.length} index(es) selected` 
                                : 'Select at least one index'}
                        </span>
                    </div>

                    {/* Stock Sync Result */}
                    {stockSyncResult && (
                        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center">
                                    <CheckCircleIcon className="w-5 h-5 text-emerald-600 mr-2" />
                                    <span className="text-sm font-bold text-emerald-800 dark:text-emerald-300">
                                        Stock sync completed
                                    </span>
                                </div>
                            </div>
                            <div className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
                                Total synced: {stockSyncResult.totalSynced || 0} | Errors: {stockSyncResult.totalErrors || 0}
                            </div>
                        </div>
                    )}
                </div>
            </div>

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
