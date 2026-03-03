"use client";

import { useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Holding, PortfolioSummary } from '@/lib/services/portfolioService';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

interface PnLChartProps {
    portfolio: PortfolioSummary | null;
}

export default function PnLChart({ portfolio }: PnLChartProps) {
    const chartData = useMemo(() => {
        if (!portfolio || !portfolio.holdings || portfolio.holdings.length === 0) {
            return null;
        }

        const holdings = portfolio.holdings;
        
        const totalInvested = holdings.reduce((sum, h) => sum + h.investedValue, 0);
        const totalCurrent = holdings.reduce((sum, h) => sum + h.currentValue, 0);
        const totalPnL = totalCurrent - totalInvested;
        const pnlPercent = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;

        const labels = ['Invested', 'Current'];
        
        return {
            labels,
            datasets: [
                {
                    label: 'Value (₹)',
                    data: [totalInvested, totalCurrent],
                    borderColor: pnlPercent >= 0 ? 'rgb(16, 185, 129)' : 'rgb(239, 68, 68)',
                    backgroundColor: pnlPercent >= 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: pnlPercent >= 0 ? 'rgb(16, 185, 129)' : 'rgb(239, 68, 68)',
                    pointBorderColor: '#fff',
                    pointHoverBackgroundColor: '#fff',
                    pointHoverBorderColor: pnlPercent >= 0 ? 'rgb(16, 185, 129)' : 'rgb(239, 68, 68)',
                },
            ],
        };
    }, [portfolio]);

    if (!chartData || !portfolio || portfolio.holdings.length === 0) {
        return (
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                <h2 className="text-xl font-semibold mb-6 text-gray-900 dark:text-white">
                    P&L Overview
                </h2>
                <div className="h-48 flex items-center justify-center text-gray-500 dark:text-slate-400">
                    No holdings data available
                </div>
            </div>
        );
    }

    const totalInvested = portfolio.totalInvested;
    const totalCurrent = portfolio.totalValue;
    const totalPnL = portfolio.totalPnl;
    const pnlPercent = portfolio.totalPnlPercent;
    const isProfit = totalPnL >= 0;

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: false,
            },
            tooltip: {
                callbacks: {
                    label: (context: { parsed: { y: number | null } }) => {
                        return `₹${(context.parsed.y || 0).toLocaleString('en-IN')}`;
                    },
                },
            },
        },
        scales: {
            y: {
                beginAtZero: false,
                ticks: {
                    callback: (value: number | string) => {
                        return '₹' + Number(value).toLocaleString('en-IN');
                    },
                },
            },
        },
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                    P&L Overview
                </h2>
                <div className={`text-2xl font-bold ${isProfit ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {isProfit ? '+' : ''}₹{totalPnL.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    <span className="text-sm ml-2">({isProfit ? '+' : ''}{pnlPercent.toFixed(2)}%)</span>
                </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-4">
                    <p className="text-sm text-gray-500 dark:text-slate-400 mb-1">Total Invested</p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">
                        ₹{totalInvested.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                </div>
                <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-4">
                    <p className="text-sm text-gray-500 dark:text-slate-400 mb-1">Current Value</p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">
                        ₹{totalCurrent.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                </div>
            </div>

            <div className="h-64">
                <Line data={chartData} options={options} />
            </div>
        </div>
    );
}
