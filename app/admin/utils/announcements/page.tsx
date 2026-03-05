"use client";

import { useState } from "react";

export default function AnnouncementsIngestPage() {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<unknown>(null);

    const handleSync = async () => {
        setLoading(true);
        setResult(null);
        try {
            const res = await fetch("/api/admin/ingest/announcements", { method: "POST" });
            const data = await res.json();
            setResult(data);
        } catch {
            setResult({ error: "Failed to sync" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex justify-between items-end border-b dark:border-slate-800 pb-6">
                <div className="space-y-1">
                    <h1 className="text-4xl font-extrabold text-gray-900 dark:text-white tracking-tight">
                        Corporate Announcements
                    </h1>
                    <p className="text-lg text-gray-500 dark:text-slate-400">
                        Sync latest corporate actions and announcements directly from NSE CSV sources.
                    </p>
                </div>
                <div className="flex items-center px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/50 rounded-2xl text-[10px] font-black uppercase text-amber-700 dark:text-amber-400 tracking-widest">
                    Manual Trigger Required
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 shadow-2xl shadow-slate-200/50 dark:shadow-none border border-gray-100 dark:border-slate-800 rounded-3xl p-10">
                <div className="max-w-xl">
                    <h3 className="text-sm font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-4">Ingest Pipeline</h3>
                    <p className="text-sm text-gray-600 dark:text-slate-400 mb-8 leading-relaxed">
                        This operation will fetch the latest <code>.csv</code> data from NSE India's corporate action archives.
                        Existing records with same timestamps will be skipped to avoid duplication.
                    </p>

                    <button
                        onClick={handleSync}
                        disabled={loading}
                        className={`flex items-center space-x-3 px-10 py-4 rounded-2xl text-white font-black text-sm tracking-wide transition-all active:scale-95 shadow-lg ${loading
                            ? "bg-blue-400 dark:bg-blue-600/50 cursor-not-allowed"
                            : "bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 shadow-blue-500/20"
                            }`}
                    >
                        {loading ? (
                            <>
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                <span>INITIALIZING PIPELINE...</span>
                            </>
                        ) : (
                            <>
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                <span>START INGESTION</span>
                            </>
                        )}
                    </button>
                </div>

                {!!result && (
                    <div className="mt-12 animate-in zoom-in-95 duration-500">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xs font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest">Pipeline Metadata</h3>
                            <button
                                onClick={() => setResult(null)}
                                className="text-[10px] font-black text-gray-400 dark:text-slate-600 hover:text-red-500 uppercase tracking-tighter"
                            >
                                Clear Results
                            </button>
                        </div>
                        <div className="p-6 bg-slate-950 rounded-2xl border border-slate-800 shadow-inner overflow-hidden">
                            <pre className="whitespace-pre-wrap text-[11px] text-emerald-400 font-mono leading-relaxed max-h-[400px] overflow-y-auto custom-scrollbar">
                                {JSON.stringify(result, null, 2)}
                            </pre>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
