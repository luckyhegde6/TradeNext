"use client";

import Link from 'next/link';
import { Holding } from '@/lib/services/portfolioService';
import { getChartButton } from "@/lib/charting";
import { isNSEIndexSymbol } from "@/lib/charting";
import { useLivePrices } from "@/lib/hooks/useLivePrices";

interface HoldingsTableProps {
    holdings: Holding[];
    onEditHolding?: (holding: Holding) => void;
}

export default function HoldingsTable({ holdings, onEditHolding }: HoldingsTableProps) {
    // Live price overlay via SSE — falls back to holding.currentPrice when offline
    const { prices, isLive } = useLivePrices(holdings.map((h) => h.ticker));

    const livePriceFor = (holding: Holding) => {
        const live = prices.get(holding.ticker.toUpperCase());
        return live?.price ?? holding.currentPrice;
    };

    const liveChangePercentFor = (holding: Holding) => {
        const live = prices.get(holding.ticker.toUpperCase());
        return live?.changePercent ?? holding.dayChangePercent;
    };

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 2,
        }).format(value);
    };

    const formatPercent = (value: number) => {
        return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
    };

    return (
        <div className="overflow-x-auto">
            <table className="w-full">
                <thead className="bg-gray-50 dark:bg-slate-800/50">
                    <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                            Stock
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                            Qty
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                            Avg Price
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                            Current Price
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                            Current Value
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                            P&#38;L
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                            Returns
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                            Allocation
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                            Chart
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                            Actions
                        </th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-800">
                    {holdings.map((holding) => {
                        const livePrice = livePriceFor(holding);
                        const liveChangePercent = liveChangePercentFor(holding);
                        const liveValue = livePrice * holding.quantity;
                        const livePnl = liveValue - holding.investedValue;
                        const livePnlPercent = holding.investedValue > 0
                            ? (livePnl / holding.investedValue) * 100
                            : 0;
                        return (
                        <tr
                            key={holding.ticker}
                            className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors"
                        >
                            <td className="px-4 py-3 whitespace-nowrap">
                                <Link
                                    href={`/company/${holding.ticker}`}
                                    className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
                                >
                                    {holding.ticker}
                                </Link>
                                {isLive && prices.has(holding.ticker.toUpperCase()) && (
                                    <span className="ml-1.5 inline-flex items-center px-1 py-0.5 rounded text-[9px] font-bold uppercase bg-emerald-500/15 text-emerald-500">
                                        ● Live
                                    </span>
                                )}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-right text-sm text-gray-900 dark:text-white">
                                {holding.quantity}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-right text-sm text-gray-900 dark:text-white">
                                {formatCurrency(holding.avgPrice)}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-right text-sm">
                                <div className="text-gray-900 dark:text-white">
                                    {formatCurrency(livePrice)}
                                </div>
                                {liveChangePercent !== undefined && (
                                    <div className={`text-xs ${liveChangePercent >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                        {liveChangePercent >= 0 ? '↑' : '↓'} {formatPercent(liveChangePercent)}
                                    </div>
                                )}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium text-gray-900 dark:text-white">
                                {formatCurrency(liveValue)}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-right text-sm">
                                <div className={`font-medium ${livePnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                    {formatCurrency(livePnl)}
                                </div>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-right text-sm">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${livePnlPercent >= 0
                                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                        : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                                    }`}>
                                    {livePnlPercent >= 0 ? '↑' : '↓'} {formatPercent(livePnlPercent)}
                                </span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-right text-sm text-gray-900 dark:text-white">
                                {holding.allocation.toFixed(1)}%
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-center">
                                {getChartButton(holding.ticker, isNSEIndexSymbol(holding.ticker))}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-center">
                                {onEditHolding && (
                                    <button
                                        onClick={() => onEditHolding(holding)}
                                        className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 text-sm font-medium"
                                    >
                                        Edit
                                    </button>
                                )}
                            </td>
                        </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
