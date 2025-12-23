"use client";

import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function IndexCorporateActions({ symbol = "NIFTY 50" }: { symbol?: string }) {
    const encodedSymbol = encodeURIComponent(symbol);
    const { data: actions, error } = useSWR(`/api/nse/index/${encodedSymbol}/corp-actions`, fetcher);

    if (error) return null;
    if (!actions) return <div className="h-32 bg-gray-50 rounded animate-pulse"></div>;

    if (actions.length === 0) return (
        <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-gray-200 dark:border-slate-800 text-center text-gray-500">
            No upcoming corporate actions
        </div>
    );

    return (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-800 overflow-hidden">
            <div className="p-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-950">
                <h3 className="font-bold text-gray-900 dark:text-white">Upcoming Corporate Actions</h3>
            </div>
            <div className="divide-y divide-gray-200 dark:divide-slate-800">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {actions.slice(0, 6).map((action: any, i: number) => (
                    <div key={i} className="p-4 hover:bg-gray-50/80 dark:hover:bg-slate-800/50 transition-all border-l-4 border-transparent hover:border-blue-500 group">
                        <div className="flex justify-between items-start mb-2">
                            <div className="flex flex-col">
                                <span className="font-bold text-blue-600 dark:text-blue-400 text-sm group-hover:underline cursor-pointer">
                                    {action.symbol}
                                </span>
                            </div>
                            <div className="flex flex-col items-end">
                                <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-slate-800 px-2 py-0.5 rounded shadow-sm">
                                    {action.exDate}
                                </span>
                            </div>
                        </div>
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 leading-snug line-clamp-2">
                            {action.subject}
                        </p>
                        <div className="mt-2 flex items-center text-[11px] text-gray-500 dark:text-gray-400">
                            <span className="truncate" title={action.comp}>{action.comp}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
