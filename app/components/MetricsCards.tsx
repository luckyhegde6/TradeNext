"use client";

import { PortfolioSummary } from '@/lib/services/portfolioService';

interface MetricsCardsProps {
    data: PortfolioSummary;
}

export default function MetricsCards({ data }: MetricsCardsProps) {
    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 0,
        }).format(value);
    };

    const formatPercent = (value: number) => {
        return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
    };

    const metrics = [
        {
            label: 'Total Value',
            value: formatCurrency(data.totalValue),
            icon: '💰',
            bgColor: 'bg-blue-100 dark:bg-blue-900/30',
            textColor: 'text-blue-600 dark:text-blue-400',
        },
        {
            label: 'Total P&L',
            value: formatCurrency(data.totalPnl),
            subValue: formatPercent(data.totalPnlPercent),
            icon: data.totalPnl >= 0 ? '📈' : '📉',
            bgColor: data.totalPnl >= 0 ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30',
            textColor: data.totalPnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400',
        },
        {
            label: "Today's Change",
            value: formatCurrency(data.todayChange),
            subValue: formatPercent(data.todayChangePercent),
            icon: data.todayChange >= 0 ? '⬆️' : '⬇️',
            bgColor: data.todayChange >= 0 ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-orange-100 dark:bg-orange-900/30',
            textColor: data.todayChange >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-orange-600 dark:text-orange-400',
        },
        {
            label: 'Holdings',
            value: data.holdings.length.toString(),
            subValue: 'Stocks',
            icon: '📊',
            bgColor: 'bg-purple-100 dark:bg-purple-900/30',
            textColor: 'text-purple-600 dark:text-purple-400',
        },
    ];

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {metrics.map((metric, idx) => (
                <div
                    key={idx}
                    className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 hover:shadow-md transition-shadow"
                >
                    <div className="flex items-center justify-between mb-4">
                        <span className="text-sm font-medium text-gray-600 dark:text-slate-400">
                            {metric.label}
                        </span>
                        <div className={`w-10 h-10 ${metric.bgColor} rounded-lg flex items-center justify-center text-xl`}>
                            {metric.icon}
                        </div>
                    </div>
                    <div className={`text-2xl font-bold ${metric.textColor} mb-1`}>
                        {metric.value}
                    </div>
                    {metric.subValue && (
                        <div className={`text-sm font-medium ${metric.textColor}`}>
                            {metric.subValue}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
