"use client";

import React, { useState, useMemo, useCallback } from "react";
import useSWR from "swr";
import Link from "next/link";
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
} from "chart.js";
import { Line } from "react-chartjs-2";
import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";

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

export default function HomeChart({ symbol: initialSymbol = "NIFTY 50" }: { symbol?: string }) {
    const [selectedSymbol, setSelectedSymbol] = useState(initialSymbol);
    const [timeframe, setTimeframe] = useState("1D");
    const [activeIndicators, setActiveIndicators] = useState<Set<Indicator>>(new Set(["MA20", "MA50"]));

    const toggleIndicator = useCallback((ind: Indicator) => {
        setActiveIndicators(prev => {
            const next = new Set(prev);
            next.has(ind) ? next.delete(ind) : next.add(ind);
            return next;
        });
    }, []);

    const { data: quoteData } = useSWR(
        `/api/nse/index/${encodeURIComponent(selectedSymbol)}`,
        fetcher,
        { refreshInterval: 30000 }
    );

    const { data: chartData, isLoading } = useSWR(
        `/api/nse/index/${encodeURIComponent(selectedSymbol)}/chart?timeframe=${timeframe}`,
        fetcher,
        { refreshInterval: timeframe === "1D" ? 60000 : 3600000 }
    );

    const { labels, values, isUp } = useMemo(() => {
        const raw: [number, number, ...unknown[]][] = chartData?.grapthData ?? [];
        const labels = raw.map((d) => {
            const date = new Date(d[0]);
            return timeframe === "1D"
                ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                : date.toLocaleDateString([], { day: "2-digit", month: "short" });
        });
        const values = raw.map((d) => typeof d[1] === "number" ? d[1] : parseFloat(String(d[1])));
        const isUp = values.length > 1 ? values[values.length - 1] >= values[0] : true;
        return { labels, values, isUp };
    }, [chartData, timeframe]);

    const mainColor = isUp ? "#10b981" : "#ef4444";

    const datasets = useMemo((): ChartDataset<'line'>[] => {
        if (values.length === 0) return [];

        const ds: ChartDataset<'line'>[] = [
            {
                label: selectedSymbol,
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

        for (const ind of ALL_INDICATORS) {
            if (!activeIndicators.has(ind)) continue;
            const period = INDICATOR_PERIODS[ind];
            if (values.length < period) continue;
            const maValues = computeSMA(values, period);
            ds.push({
                label: ind,
                data: maValues as number[],
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
    }, [values, selectedSymbol, mainColor, isUp, activeIndicators]);

    const chartDataObj = useMemo(() => ({ labels, datasets }), [labels, datasets]);

    const options: ChartOptions<"line"> = useMemo(() => ({
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        plugins: {
            legend: { display: false },
            tooltip: {
                mode: "index",
                intersect: false,
                backgroundColor: "rgba(15,23,42,0.95)",
                titleColor: "#e2e8f0",
                bodyColor: "#94a3b8",
                padding: 12,
                borderRadius: 10,
                borderColor: "rgba(148,163,184,0.1)",
                borderWidth: 1,
                callbacks: {
                    label: (ctx: any) => {
                        if (ctx.parsed.y === null) return "";
                        return ` ${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
                    },
                },
            },
        },
        scales: {
            x: {
                display: true,
                grid: { display: false },
                ticks: {
                    maxRotation: 0,
                    autoSkip: true,
                    maxTicksLimit: timeframe === "1D" ? 8 : 6,
                    color: "#64748b",
                    font: { size: 10 },
                },
                border: { display: false },
            },
            y: {
                display: true,
                position: "right",
                grid: { color: "rgba(148,163,184,0.07)" },
                ticks: {
                    color: "#64748b",
                    font: { size: 10 },
                    callback: (v: any) => v.toLocaleString("en-IN"),
                },
                border: { display: false },
            },
        },
    }), [timeframe]);

    const timeframes = ["1D", "1W", "1M", "3M", "6M", "1Y"];

    const marketStatus = quoteData?.marketStatus;
    const lastPrice = quoteData?.lastPrice ? parseFloat(quoteData.lastPrice) : null;
    const change = quoteData?.change ? parseFloat(quoteData.change) : null;
    const pChange = quoteData?.pChange ? parseFloat(quoteData.pChange) : null;

    return (
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 sm:p-6 shadow-xl border border-gray-100 dark:border-slate-800 transition-all">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
                <div className="flex items-center gap-3 flex-wrap">
                    <select
                        value={selectedSymbol}
                        onChange={(e) => setSelectedSymbol(e.target.value)}
                        className="bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-white text-base font-black border border-gray-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-primary/50 transition-all cursor-pointer py-2 pl-3 pr-8"
                    >
                        <optgroup label="Major Indices">
                            <option value="NIFTY 50">NIFTY 50</option>
                            <option value="NIFTY BANK">NIFTY BANK</option>
                            <option value="NIFTY IT">NIFTY IT</option>
                            <option value="NIFTY NEXT 50">NIFTY NEXT 50</option>
                        </optgroup>
                        <optgroup label="Broad Market">
                            <option value="NIFTY MIDCAP 50">NIFTY MIDCAP 50</option>
                            <option value="NIFTY SMALLCAP 100">NIFTY SMALLCAP 100</option>
                        </optgroup>
                        <optgroup label="Sectoral">
                            <option value="NIFTY AUTO">NIFTY AUTO</option>
                            <option value="NIFTY PHARMA">NIFTY PHARMA</option>
                        </optgroup>
                    </select>

                    {/* Open full chart link */}
                    <Link
                        href={`/markets/${encodeURIComponent(selectedSymbol)}`}
                        title="Open full chart"
                        className="p-2 text-gray-400 hover:text-primary dark:hover:text-primary-400 hover:bg-primary/5 rounded-lg transition-all"
                    >
                        <ArrowTopRightOnSquareIcon className="h-5 w-5" />
                    </Link>
                    
                    {/* Open in TradingView */}
                    <a
                        href={`https://in.tradingview.com/chart/?symbol=NSE:${encodeURIComponent(selectedSymbol)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open in TradingView"
                        className="p-2 text-gray-400 hover:text-green-500 dark:hover:text-green-400 hover:bg-green-500/5 rounded-lg transition-all"
                    >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M15.337 3.415c-.152-.114-.345-.113-.495.003a.622.622 0 00-.202.481v6.924c0 .173.068.34.188.462l3.829 3.829c.128.128.296.197.468.197.171 0 .339-.069.467-.197l3.83-3.83a.622.622 0 00.187-.46V7.418c0-.172-.068-.34-.187-.46l-3.83-3.828a.617.617 0 00-.432-.178.617.617 0 00-.433.178l-3.83 3.829zm-3.83 5.858v2.576l2.576 2.576-2.576 2.576v2.573l4.073-4.073 4.073-4.073-4.073-4.073-4.073 4.073z"/>
                        </svg>
                    </a>

                    {isLoading && (
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent" />
                    )}
                </div>

                {/* Timeframe tabs */}
                <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-slate-800 rounded-xl overflow-x-auto no-scrollbar shrink-0">
                    {timeframes.map((tf) => (
                        <button
                            key={tf}
                            onClick={() => setTimeframe(tf)}
                            className={`px-3 py-1.5 text-xs font-black rounded-lg transition-all whitespace-nowrap ${timeframe === tf
                                ? "bg-white dark:bg-slate-700 text-primary shadow-sm"
                                : "text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
                                }`}
                        >
                            {tf}
                        </button>
                    ))}
                </div>
            </div>

            {/* Price row */}
            {lastPrice !== null && (
                <div className="flex items-baseline gap-3 mb-4">
                    <span className="text-3xl sm:text-4xl font-black text-gray-900 dark:text-white tracking-tight">
                        {lastPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </span>
                    {change !== null && pChange !== null && (
                        <span className={`text-sm font-bold ${pChange >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                            {change >= 0 ? "+" : ""}{change.toFixed(2)} ({pChange >= 0 ? "+" : ""}{pChange.toFixed(2)}%)
                        </span>
                    )}
                </div>
            )}

            {/* Indicator toggles */}
            <div className="flex items-center gap-2 mb-4 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-slate-500 mr-1">Indicators</span>
                {ALL_INDICATORS.map((ind) => {
                    const active = activeIndicators.has(ind);
                    const period = INDICATOR_PERIODS[ind];
                    // hide MA200 / MA50 for 1D where we won't have enough data
                    if (timeframe === "1D" && period > values.length && values.length > 0) return null;
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

            {/* Chart */}
            <div className="w-full" style={{ height: 340 }}>
                {values.length > 0 ? (
                    <Line data={chartDataObj} options={options} />
                ) : isLoading ? (
                    <div className="w-full h-full flex items-center justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
                    </div>
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400 dark:text-slate-600 text-sm">
                        No chart data available
                    </div>
                )}
            </div>

            {/* Legend for active indicators */}
            {activeIndicators.size > 0 && values.length > 0 && (
                <div className="flex items-center gap-4 mt-3 flex-wrap">
                    <div className="flex items-center gap-1.5">
                        <div className="w-4 h-0.5 rounded" style={{ backgroundColor: mainColor }} />
                        <span className="text-[10px] font-bold text-gray-500 dark:text-slate-400">{selectedSymbol}</span>
                    </div>
                    {ALL_INDICATORS.filter(i => activeIndicators.has(i)).map(ind => (
                        <div key={ind} className="flex items-center gap-1.5">
                            <div className="w-4 border-t-2 border-dashed" style={{ borderColor: INDICATOR_COLORS[ind] }} />
                            <span className="text-[10px] font-bold" style={{ color: INDICATOR_COLORS[ind] }}>{ind}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between pt-4 mt-2 border-t border-gray-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${marketStatus === "Open" ? "bg-emerald-500 animate-pulse" : "bg-gray-400 dark:bg-slate-600"}`} />
                    <span className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">
                        Market {marketStatus || "Closed"}
                    </span>
                </div>
                <span className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">
                    {quoteData?.timestamp ? `Updated ${new Date(quoteData.timestamp).toLocaleTimeString()}` : ""}
                </span>
            </div>
        </div>
    );
}
