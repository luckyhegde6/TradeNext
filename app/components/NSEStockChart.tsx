"use client";

import { useState, useMemo } from "react";
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
    ChartOptions,
    ChartDataset,
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

/** Compute a Simple Moving Average series */
function computeSMA(data: number[], period: number): (number | null)[] {
    return data.map((_, i) => {
        if (i < period - 1) return null;
        const slice = data.slice(i - period + 1, i + 1);
        return slice.reduce((a, b) => a + b, 0) / period;
    });
}

type Indicator = "MA20" | "MA50" | "MA200";

const INDICATOR_COLORS: Record<Indicator, string> = {
    MA20: "#f59e0b",   // amber
    MA50: "#8b5cf6",   // violet
    MA200: "#06b6d4",  // cyan
};

const INDICATOR_PERIODS: Record<Indicator, number> = {
    MA20: 20,
    MA50: 50,
    MA200: 200,
};

const ALL_INDICATORS: Indicator[] = ["MA20", "MA50", "MA200"];

export default function NSEStockChart({ symbol }: NSEChartProps) {
    const [timeframe, setTimeframe] = useState('1D');
    const [activeIndicators, setActiveIndicators] = useState<Set<Indicator>>(new Set(["MA20", "MA50"]));

    const toggleIndicator = (ind: Indicator) => {
        setActiveIndicators(prev => {
            const next = new Set(prev);
            next.has(ind) ? next.delete(ind) : next.add(ind);
            return next;
        });
    };

    const { data: chartData, error, isLoading } = useSWR(
        `/api/nse/stock/${symbol}/chart?days=${timeframe}`,
        fetcher,
        { refreshInterval: timeframe === '1D' ? 60000 : 3600000 }
    );

    const { labels, values, isUp } = useMemo(() => {
        if (!chartData || !Array.isArray(chartData)) return { labels: [], values: [], isUp: true };

        const labels = chartData.map((item: [number, number, string]) => {
            const date = new Date(item[0]);
            if (timeframe === '1D') {
                return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
            }
            return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        });

        const values = chartData.map((item: [number, number, string]) => item[1]);
        const isUp = values.length > 1 ? values[values.length - 1] >= values[0] : true;

        return { labels, values, isUp };
    }, [chartData, timeframe]);

    const mainColor = isUp ? "#10b981" : "#ef4444";

    const datasets = useMemo((): ChartDataset<'line'>[] => {
        if (values.length === 0) return [];

        const ds: ChartDataset<'line'>[] = [
            {
                label: symbol,
                data: values,
                borderColor: mainColor,
                backgroundColor: (context: any) => {
                    const chart = context.chart;
                    const { ctx, chartArea } = chart;
                    if (!chartArea) return isUp ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)";
                    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                    gradient.addColorStop(0, isUp ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)");
                    gradient.addColorStop(1, "rgba(16,185,129,0)");
                    return gradient;
                },
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4,
                fill: true,
                tension: 0.1,
                order: 1,
            },
        ];

        // MA overlays
        for (const ind of ALL_INDICATORS) {
            if (!activeIndicators.has(ind)) continue;
            const period = INDICATOR_PERIODS[ind];
            if (values.length < period) continue;
            const maValues = computeSMA(values, period);
            ds.push({
                label: ind,
                data: maValues as any[],
                borderColor: INDICATOR_COLORS[ind],
                borderWidth: 1.5,
                borderDash: [4, 4],
                pointRadius: 0,
                pointHoverRadius: 0,
                fill: false,
                tension: 0.1,
                order: 2,
                spanGaps: true,
            });
        }

        return ds;
    }, [values, symbol, mainColor, isUp, activeIndicators]);

    const options: ChartOptions<'line'> = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            mode: 'index',
            intersect: false,
        },
        plugins: {
            legend: {
                display: false,
            },
            tooltip: {
                backgroundColor: "rgba(15,23,42,0.95)",
                titleColor: "#e2e8f0",
                bodyColor: "#94a3b8",
                padding: 12,
                cornerRadius: 10,
                borderColor: "rgba(148,163,184,0.1)",
                borderWidth: 1,
                callbacks: {
                    label: function (context: any) {
                        const val = context.parsed.y ?? 0;
                        return ` ${context.dataset.label}: ₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
                    color: "#64748b",
                    font: { size: 10 },
                },
                border: { display: false },
            },
            y: {
                position: 'right' as const,
                grid: {
                    color: "rgba(148,163,184,0.07)",
                },
                ticks: {
                    color: "#64748b",
                    font: { size: 10 },
                    callback: function (value: any) {
                        return '₹' + value.toLocaleString('en-IN');
                    }
                },
                border: { display: false },
            },
        },
    };

    if (error) return (
        <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-red-100 dark:border-red-900/30 text-center">
            <p className="text-red-500 font-bold">Failed to load chart</p>
            <button onClick={() => window.location.reload()} className="mt-2 text-sm text-blue-500 hover:underline">Try again</button>
        </div>
    );

    return (
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 sm:p-6 shadow-xl border border-gray-100 dark:border-slate-800 transition-all">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">Price Chart</h3>

                {/* Timeframe Selector */}
                <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-slate-800 rounded-xl overflow-x-auto no-scrollbar">
                    {TIMEFRAMES.map((tf) => (
                        <button
                            key={tf.value}
                            onClick={() => setTimeframe(tf.value)}
                            className={`px-3 py-1.5 text-xs font-black rounded-lg transition-all whitespace-nowrap ${timeframe === tf.value
                                ? "bg-white dark:bg-slate-700 text-primary shadow-sm"
                                : "text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
                                }`}
                        >
                            {tf.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Indicator toggles */}
            <div className="flex items-center gap-2 mb-6 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-slate-500 mr-1">Indicators</span>
                {ALL_INDICATORS.map((ind) => {
                    const active = activeIndicators.has(ind);
                    const period = INDICATOR_PERIODS[ind];
                    if (values.length < period && values.length > 0) return null;
                    return (
                        <button
                            key={ind}
                            onClick={() => toggleIndicator(ind)}
                            style={active ? { borderColor: INDICATOR_COLORS[ind], color: INDICATOR_COLORS[ind], backgroundColor: INDICATOR_COLORS[ind] + "18" } : {}}
                            className={`px-2.5 py-0.5 text-[10px] font-black rounded-full border transition-all ${active
                                ? "border-current"
                                : "border-gray-200 dark:border-slate-700 text-gray-400 dark:text-slate-500 hover:border-gray-400"
                                }`}
                        >
                            {ind}
                        </button>
                    );
                })}
            </div>

            <div className="h-96 relative w-full">
                {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/50 dark:bg-slate-900/50 z-10 rounded-xl">
                        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
                    </div>
                )}
                {values.length > 0 ? (
                    <Line data={{ labels, datasets }} options={options} />
                ) : !isLoading && (
                    <div className="w-full h-full flex items-center justify-center text-gray-400 dark:text-slate-600 text-sm italic">
                        No chart data available for this timeframe
                    </div>
                )}
            </div>

            {/* Legend for active indicators */}
            {activeIndicators.size > 0 && values.length > 0 && (
                <div className="flex items-center gap-4 mt-6 flex-wrap border-t border-gray-50 dark:border-slate-800 pt-4">
                    <div className="flex items-center gap-1.5">
                        <div className="w-4 h-0.5 rounded" style={{ backgroundColor: mainColor }} />
                        <span className="text-[10px] font-bold text-gray-500 dark:text-slate-400">{symbol}</span>
                    </div>
                    {ALL_INDICATORS.filter(i => activeIndicators.has(i)).map(ind => (
                        <div key={ind} className="flex items-center gap-1.5">
                            <div className="w-4 border-t-2 border-dashed" style={{ borderColor: INDICATOR_COLORS[ind] }} />
                            <span className="text-[10px] font-bold" style={{ color: INDICATOR_COLORS[ind] }}>{ind}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
