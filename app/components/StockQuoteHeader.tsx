"use client";

import useSWR from "swr";
import Link from "next/link";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

interface StockQuoteProps {
    symbol: string;
}

export default function StockQuoteHeader({ symbol }: StockQuoteProps) {
    const { data: quote, error } = useSWR(`/api/nse/stock/${symbol}/quote`, fetcher, {
        refreshInterval: 30000, // Refresh every 30 seconds
        dedupingInterval: 10000, // Dedupe requests within 10 seconds
    });

    if (error) return <div className="text-red-500">Failed to load stock data</div>;
    if (!quote) return <div className="animate-pulse bg-gray-100 h-32 rounded"></div>;

    const isPositive = quote.pChange >= 0;
    const changeColor = isPositive ? 'text-green-600' : 'text-red-600';
    const bgColor = isPositive ? 'bg-green-50 dark:bg-green-900/10' : 'bg-red-50 dark:bg-red-900/10';

    return (
        <div className={`${bgColor} rounded-lg p-6 border border-gray-200 dark:border-slate-800`}>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                {/* Company Name & Symbol */}
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                        {quote.symbol}
                    </h1>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {quote.companyName}
                    </p>
                    {quote.industry && (
                        <p className="text-xs text-gray-500 mt-1">
                            {quote.industry} • {quote.sector}
                        </p>
                    )}
                </div>

                {/* Price & Change */}
                <div className="flex items-center gap-6">
                    <div>
                        <div className="text-4xl font-bold text-gray-900 dark:text-white">
                            ₹{quote.lastPrice?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className={`text-lg font-semibold ${changeColor} flex items-center gap-2 mt-1`}>
                            <span>{isPositive ? '▲' : '▼'}</span>
                            <span>{isPositive ? '+' : ''}{quote.change?.toFixed(2)}</span>
                            <span>({isPositive ? '+' : ''}{quote.pChange?.toFixed(2)}%)</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mt-6 pt-6 border-t border-gray-200 dark:border-slate-700">
                <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Open</div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white mt-1">
                        ₹{quote.open?.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </div>
                </div>
                <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">High</div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white mt-1">
                        ₹{quote.dayHigh?.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </div>
                </div>
                <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Low</div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white mt-1">
                        ₹{quote.dayLow?.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </div>
                </div>
                <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Prev. Close</div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white mt-1">
                        ₹{quote.previousClose?.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </div>
                </div>
                <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">52W High</div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white mt-1">
                        ₹{quote.yearHigh?.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </div>
                </div>
                <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">52W Low</div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white mt-1">
                        ₹{quote.yearLow?.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </div>
                </div>
            </div>

            {/* Trading Info */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
                <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Volume</div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white mt-1">
                        {quote.totalTradedVolume?.toLocaleString('en-IN')}
                    </div>
                </div>
                <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Value (Cr)</div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white mt-1">
                        ₹{(quote.totalTradedValue / 10000000)?.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </div>
                </div>
                {quote.peRatio > 0 && (
                    <div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">P/E Ratio</div>
                        <div className="text-sm font-semibold text-gray-900 dark:text-white mt-1">
                            {quote.peRatio?.toFixed(2)}
                        </div>
                    </div>
                )}
            </div>

            {/* Indices */}
            {quote.indexList && quote.indexList.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-700">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">Member of Indices</div>
                    <div className="flex flex-wrap gap-2">
                        {quote.indexList.map((index: string) => (
                            <Link
                                key={index}
                                href={`/markets/${encodeURIComponent(index)}`}
                                className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-900/30 transition-colors"
                            >
                                {index}
                            </Link>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
