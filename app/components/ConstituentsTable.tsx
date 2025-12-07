"use client";

import useSWR from "swr";
import Link from "next/link";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

interface ConstituentItem {
    cmSymbol: string;
    symbol?: string;
    weightage: number;
    lasttradedPrice: number;
    change: number;
    pchange: number;
    totaltradedquantity: number;
    totaltradedvalue: number;
}

export default function ConstituentsTable({ symbol = "NIFTY 50" }: { symbol?: string }) {
    const encodedSymbol = encodeURIComponent(symbol);
    const { data: constituents, error } = useSWR(`/api/nse/index/${encodedSymbol}/heatmap`, fetcher, {
        refreshInterval: 60000,
    });

    if (error) return <div className="text-red-500">Failed to load constituents</div>;
    if (!constituents) return <div className="animate-pulse bg-gray-100 h-96 rounded"></div>;

    // Sort by weightage descending
    const sortedConstituents = [...constituents].sort((a: ConstituentItem, b: ConstituentItem) =>
        (b.weightage || 0) - (a.weightage || 0)
    );

    return (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-800 overflow-hidden h-full flex flex-col">
            <div className="p-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-950">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Constituents</h3>
                <p className="text-xs text-gray-500 mt-1">Index composition and performance</p>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-950 border-b border-gray-200 dark:border-slate-800">
                        <tr>
                            <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">Symbol</th>
                            <th className="px-4 py-3 text-right font-semibold text-gray-700 dark:text-gray-300">Weightage (%)</th>
                            <th className="px-4 py-3 text-right font-semibold text-gray-700 dark:text-gray-300">LTP</th>
                            <th className="px-4 py-3 text-right font-semibold text-gray-700 dark:text-gray-300">Change</th>
                            <th className="px-4 py-3 text-right font-semibold text-gray-700 dark:text-gray-300">%Change</th>
                            <th className="px-4 py-3 text-right font-semibold text-gray-700 dark:text-gray-300">Volume (Lakh)</th>
                            <th className="px-4 py-3 text-right font-semibold text-gray-700 dark:text-gray-300">Value (Cr)</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-slate-800">
                        {sortedConstituents.map((stock: ConstituentItem) => {
                            const stockSymbol = stock.cmSymbol || stock.symbol || '';
                            const isPositive = stock.pchange >= 0;
                            const changeColor = isPositive ? 'text-green-600' : 'text-red-600';

                            return (
                                <tr
                                    key={stockSymbol}
                                    className="hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                                >
                                    <td className="px-4 py-3">
                                        <Link
                                            href={`/company/${stockSymbol}`}
                                            className="font-semibold text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                                        >
                                            {stockSymbol}
                                        </Link>
                                    </td>
                                    <td className="px-4 py-3 text-right text-gray-900 dark:text-gray-100">
                                        {stock.weightage?.toFixed(2) || '-'}
                                    </td>
                                    <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-gray-100">
                                        {stock.lasttradedPrice?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '-'}
                                    </td>
                                    <td className={`px-4 py-3 text-right font-medium ${changeColor}`}>
                                        {isPositive ? '+' : ''}{stock.change?.toFixed(2) || '0.00'}
                                    </td>
                                    <td className={`px-4 py-3 text-right font-bold ${changeColor}`}>
                                        {isPositive ? '+' : ''}{stock.pchange?.toFixed(2) || '0.00'}%
                                    </td>
                                    <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                                        {stock.totaltradedquantity?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '-'}
                                    </td>
                                    <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                                        {stock.totaltradedvalue?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '-'}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {sortedConstituents.length === 0 && (
                <div className="p-8 text-center text-gray-500">
                    No constituents data available
                </div>
            )}
        </div>
    );
}
