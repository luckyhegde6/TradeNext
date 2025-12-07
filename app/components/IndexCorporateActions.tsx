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
                {actions.slice(0, 5).map((action: any, i: number) => (
                    <div key={i} className="p-4 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                        <div className="flex justify-between">
                            <span className="font-bold text-blue-600">{action.symbol}</span>
                            <span className="text-xs text-gray-500">{action.exDate}</span>
                        </div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">{action.purpose}</p>
                        <p className="text-xs text-gray-500 mt-1">{action.company}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}
