"use client";

import useSWR from "swr";
import Link from "next/link";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function IndexHeatmap({ symbol = "NIFTY 50" }: { symbol?: string }) {
    const encodedSymbol = encodeURIComponent(symbol);
    const { data: stocks, error } = useSWR(`/api/nse/index/${encodedSymbol}/heatmap`, fetcher, {
        refreshInterval: 60000,
    });

    if (error) return <div className="text-red-500">Failed to load heatmap</div>;
    if (!stocks || stocks.length === 0) return <div className="animate-pulse bg-gray-100 h-64 rounded"></div>;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sortedStocks = [...stocks].sort((a: any, b: any) => (b.pchange || b.pChange || 0) - (a.pchange || a.pChange || 0));

    return (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-800 p-4 h-full flex flex-col">
            <h3 className="text-lg font-bold mb-3 text-gray-900 dark:text-white">Constituents Heatmap</h3>
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-5 gap-2 flex-1 overflow-y-auto">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {sortedStocks.map((stock: any) => {
                    // Use cmSymbol or symbol
                    const stockSymbol = stock.cmSymbol || stock.symbol || '';
                    if (!stockSymbol) return null;

                    const pChange = stock.pchange || stock.pChange || 0;
                    const lastPrice = stock.lasttradedPrice || stock.lastPrice || stock.last || 0;

                    const isPos = pChange >= 0;
                    const colorClass = isPos
                        ? (pChange > 2 ? 'bg-green-600' : 'bg-green-500')
                        : (pChange < -2 ? 'bg-red-600' : 'bg-red-500');

                    return (
                        <div key={stockSymbol}>
                            <Link
                                href={`/company/${stockSymbol}`}
                                className={`${colorClass} text-white p-2 rounded shadow-sm flex flex-col justify-between hover:opacity-90 hover:scale-105 transition-all cursor-pointer block min-h-[60px]`}
                                title={`${stockSymbol}: ${lastPrice} (${pChange}%)`}
                            >
                                <span className="font-bold text-xs truncate">{stockSymbol}</span>
                                <div className="flex justify-between items-end mt-1">
                                    <span className="text-[10px] opacity-90">{lastPrice.toFixed(2)}</span>
                                    <span className="text-[10px] font-bold">{pChange.toFixed(2)}%</span>
                                </div>
                            </Link>
                        </div>
                    )
                })}
            </div>
        </div>
    );
}
