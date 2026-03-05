"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { ArrowTopRightOnSquareIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";

interface NewsItem {
    id: string;
    title: string;
    summary: string;
    source: string;
    url: string;
    publishedAt: string;
    symbol?: string;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function timeAgo(isoDate: string): string {
    const diff = Date.now() - new Date(isoDate).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

function NewsCard({ item }: { item: NewsItem }) {
    return (
        <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col gap-2 p-5 bg-white dark:bg-slate-800/60 border border-gray-100 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-lg hover:border-primary/30 dark:hover:border-primary/40 transition-all"
        >
            <div className="flex items-start justify-between gap-3">
                <span className="text-xs font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    {item.source}
                </span>
                <ArrowTopRightOnSquareIcon className="h-4 w-4 text-gray-400 group-hover:text-primary shrink-0 mt-0.5 transition-colors" />
            </div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-white leading-snug group-hover:text-primary transition-colors line-clamp-3">
                {item.title}
            </h3>
            {item.summary && item.summary !== item.title && (
                <p className="text-xs text-gray-500 dark:text-slate-400 line-clamp-2">{item.summary}</p>
            )}
            <div className="flex items-center gap-2 mt-auto pt-2 border-t border-gray-100 dark:border-slate-700">
                {item.symbol && (
                    <span className="text-[10px] font-bold bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 px-2 py-0.5 rounded-full">
                        {item.symbol}
                    </span>
                )}
                <span className="ml-auto text-[10px] font-medium text-gray-400 dark:text-slate-500">
                    {timeAgo(item.publishedAt)}
                </span>
            </div>
        </a>
    );
}

export default function NewsPage() {
    const [tab, setTab] = useState<"all" | "india" | "global">("all");
    const [search, setSearch] = useState("");

    const { data, isLoading, error } = useSWR<{ india: NewsItem[]; global: NewsItem[] }>(
        "/api/news/market",
        fetcher,
        { revalidateOnFocus: false }
    );

    const indiaNews = data?.india || [];
    const globalNews = data?.global || [];

    const combined = tab === "india" ? indiaNews : tab === "global" ? globalNews : [...indiaNews, ...globalNews];

    const filtered = search.trim()
        ? combined.filter(
            (n) =>
                n.title.toLowerCase().includes(search.toLowerCase()) ||
                n.source.toLowerCase().includes(search.toLowerCase()) ||
                (n.symbol && n.symbol.toLowerCase().includes(search.toLowerCase()))
        )
        : combined;

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
            {/* Hero */}
            <div className="bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-800 px-4 sm:px-8 py-8">
                <div className="max-w-6xl mx-auto">
                    <h1 className="text-3xl font-black text-gray-900 dark:text-white mb-1">
                        Market News
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
                        India &amp; Global financial news from NSE, TradingView and more.
                    </p>

                    {/* Search + Tabs */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                        <div className="relative flex-1 max-w-sm">
                            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search news or symbol..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/40"
                            />
                        </div>

                        <div className="flex items-center p-1 bg-gray-100 dark:bg-slate-800 rounded-xl">
                            {(["all", "india", "global"] as const).map((t) => (
                                <button
                                    key={t}
                                    onClick={() => setTab(t)}
                                    className={`px-4 py-1.5 text-xs font-black rounded-lg capitalize transition-all ${tab === t
                                            ? "bg-white dark:bg-slate-700 text-primary shadow-sm"
                                            : "text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
                                        }`}
                                >
                                    {t === "all" ? "All" : t === "india" ? "🇮🇳 India" : "🌍 Global"}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8">
                {isLoading && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {Array.from({ length: 9 }).map((_, i) => (
                            <div key={i} className="h-44 rounded-2xl bg-gray-100 dark:bg-slate-800 animate-pulse" />
                        ))}
                    </div>
                )}

                {error && (
                    <div className="text-center py-20 text-red-500 dark:text-red-400 font-bold">
                        Failed to load news. Please try again later.
                    </div>
                )}

                {!isLoading && !error && filtered.length === 0 && (
                    <div className="text-center py-20 text-gray-400 dark:text-slate-500">
                        No news found{search ? ` for "${search}"` : ""}.
                    </div>
                )}

                {!isLoading && !error && filtered.length > 0 && (
                    <>
                        <p className="text-xs text-gray-400 dark:text-slate-500 mb-4 font-medium">
                            {filtered.length} article{filtered.length !== 1 ? "s" : ""}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filtered.map((item) => (
                                <NewsCard key={item.id} item={item} />
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
