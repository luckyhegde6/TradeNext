"use client";

import { useState } from "react";
import useSWR from "swr";
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

const fetcher = (url: string) => fetch(url).then((res) => res.json());

const TIMEFRAMES = [
    { label: '1D', value: '1D' },
    { label: '1W', value: '1W' },
    { label: '1M', value: '1M' },
    { label: '3M', value: '3M' },
    { label: '6M', value: '6M' },
    { label: '1Y', value: '1Y' },
];

interface NSEChartProps {
    symbol: string;
}

export default function NSEStockChart({ symbol }: NSEChartProps) {
    const [timeframe, setTimeframe] = useState('1D');

    const { data: chartData, error } = useSWR(
        `/api/nse/stock/${symbol}/chart?days=${timeframe}`,
        fetcher,
        { refreshInterval: 60000 }
    );

    if (error) return <div className="text-red-500">Failed to load chart</div>;
    if (!chartData || chartData.length === 0) {
        return <div className="animate-pulse bg-gray-100 h-96 rounded"></div>;
    }

    // Parse chart data
    // eslint-disable-next-line
    const labels = chartData.map((item: [number, number, string]) => {
        const date = new Date(item[0]);
        if (timeframe === '1D') {
            return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        }
        return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    });
    // eslint-disable-next-line
    const prices = chartData.map((item: [number, number, string]) => item[1]);

    const data = {
        labels,
        datasets: [
            {
                label: symbol,
                data: prices,
                borderColor: 'rgb(59, 130, 246)',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                fill: true,
                tension: 0.1,
                pointRadius: 0,
                pointHoverRadius: 4,
            },
        ],
    };

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: false,
            },
            tooltip: {
                mode: 'index' as const,
                intersect: false,
                callbacks: {
                    // eslint-disable-next-line
                    label: function (context: { parsed: { y: number | null } }) {
                        const val = context.parsed.y ?? 0;
                        return `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                    }
                }
            },
        },
        scales: {
            x: {
                grid: {
                    display: false,
                },
                ticks: {
                    maxTicksLimit: 8,
                },
            },
            y: {
                position: 'right' as const,
                grid: {
                    color: 'rgba(0, 0, 0, 0.05)',
                },
                ticks: {
                    // eslint-disable-next-line
                    callback: function (value: number | string) {
                        const numericValue = typeof value === 'string' ? parseFloat(value) : value;
                        return '₹' + numericValue.toLocaleString('en-IN');
                    }
                }
            },
        },
        interaction: {
            mode: 'nearest' as const,
            axis: 'x' as const,
            intersect: false,
        },
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-800 p-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">Price Chart</h3>

                {/* Timeframe Selector */}
                <div className="flex gap-2">
                    {TIMEFRAMES.map((tf) => (
                        <button
                            key={tf.value}
                            onClick={() => setTimeframe(tf.value)}
                            className={`px-3 py-1 text-sm font-medium rounded transition-colors ${timeframe === tf.value
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-700'
                                }`}
                        >
                            {tf.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="h-96">
                <Line data={data} options={options} />
            </div>
        </div>
    );
}
