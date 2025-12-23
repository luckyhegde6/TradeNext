"use client";

import useSWR from "swr";
import Link from "next/link";
import sanitizeHtml from "sanitize-html";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function CorporateAnnouncementsWidget({ symbol = "NIFTY 50" }: { symbol?: string }) {
    // Build API URL based on whether symbol is provided
    const apiUrl = symbol
        ? `/api/nse/index/${encodeURIComponent(symbol)}/announcements`
        : "/api/announcements";

    const { data: announcements, isLoading } = useSWR(apiUrl, fetcher, {
        refreshInterval: 60000, // Refresh every minute
    });

    if (isLoading) {
        return (
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-800 p-4 h-full">
                <h3 className="font-bold text-lg mb-4 text-gray-900 dark:text-white">Corporate Announcements</h3>
                <div className="space-y-4 animate-pulse">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-16 bg-gray-100 dark:bg-slate-800 rounded"></div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-800 h-[600px] flex flex-col">
            <div className="p-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-900 rounded-t-lg">
                <h3 className="font-bold text-lg text-gray-900 dark:text-white flex items-center">
                    📢 Corporate Announcements
                </h3>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar max-h-[500px]">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {announcements?.map((item: any, index: number) => {
                    const symbol = item.symbol;
                    const date = item.an_dt || item.broadcastDateTime;
                    const subject = item.desc || item.subject;
                    const details = item.attchmntText || item.details;
                    const attachment = item.attchmntFile || item.attachment;
                    const dt = item.dt || item.seq_id || index;

                    return (
                        <div key={`${symbol}-${dt}-${index}`} className="p-3 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors border-gray-100 dark:border-slate-700">
                            <div className="flex justify-between items-start">
                                <span className="font-bold text-sm text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded">
                                    {symbol}
                                </span>
                                <span className="text-xs text-gray-400">
                                    {date && (date.includes('-') || date.includes('/')) ? date :
                                        (date ? new Date(date).toLocaleString('en-IN', {
                                            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                                        }) : '-')}
                                </span>
                            </div>
                            <h4 className="font-semibold text-sm mt-2 text-gray-900 dark:text-gray-100 line-clamp-2">
                                {subject}
                            </h4>
                            {details && (
                                <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                                    {sanitizeHtml(details, { allowedTags: [], allowedAttributes: {} })}
                                </p>
                            )}
                            {attachment && (
                                <a href={attachment} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline mt-1 inline-block">
                                    View PDF
                                </a>
                            )}
                        </div>
                    );
                })}

                {!announcements?.length && (
                    <div className="p-4 text-center text-gray-500">No recent announcements found.</div>
                )}
            </div>

            <div className="p-3 border-t border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-900 rounded-b-lg text-center">
                <Link href="/markets" className="text-sm text-blue-600 font-medium hover:underline">View All Market Data</Link>
            </div>
        </div>
    );
}
