"use client";

import useSWR from "swr";
import { ArrowUpIcon, ArrowDownIcon } from "@heroicons/react/24/solid";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function IndexDetailsHeader({ symbol = "NIFTY 50" }: { symbol?: string }) {
    const encodedSymbol = encodeURIComponent(symbol);

    // Fetch index quote data
    const { data, error } = useSWR(`/api/nse/index/${encodedSymbol}`, fetcher, {
        refreshInterval: 30000,
    });

    // Fetch advance/decline data
    const { data: advDecData } = useSWR(`/api/nse/index/${encodedSymbol}/advance-decline`, fetcher, {
        refreshInterval: 60000, // Refresh every minute
    });

    if (error) return <div className="p-4 bg-red-50 text-red-500 rounded">Failed to load data</div>;
    if (!data) return <div className="p-4 animate-pulse bg-gray-100 dark:bg-slate-800 rounded h-48"></div>;

    const safeNumber = (val: string | number | undefined) => {
        if (val === undefined || val === null || val === "NaN") return "-";
        const num = typeof val === 'string' ? parseFloat(val) : val;
        return isNaN(num) ? "-" : num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    };

    const isPositive = parseFloat(data.pChange || "0") >= 0;
    const textCol = isPositive ? "text-green-600" : "text-red-600";
    const bgCol = isPositive ? "bg-green-100 dark:bg-green-900/30" : "bg-red-100 dark:bg-red-900/30";
    const Icon = isPositive ? ArrowUpIcon : ArrowDownIcon;

    // specific parsing for timestamp
    let timestampStr = "Unknown";
    try {
        if (data.timestamp) {
            const d = new Date(data.timestamp);
            if (!isNaN(d.getTime())) {
                timestampStr = d.toLocaleString();
            }
        }
    } catch (e) {
        console.error("Error parsing timestamp:", e);
    }

    return (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-800 p-6 mb-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">{symbol}</h1>
                    <div className="flex items-baseline gap-4">
                        <span className="text-5xl font-extrabold text-gray-900 dark:text-white">
                            {safeNumber(data.lastPrice)}
                        </span>
                        <div className={`flex items-center gap-1 px-3 py-1 rounded-full ${bgCol} ${textCol}`}>
                            <Icon className="w-5 h-5" />
                            <span className="text-xl font-bold">{data.change}</span>
                            <span className="text-lg font-medium">({data.pChange}%)</span>
                        </div>
                    </div>
                    <p className="text-sm text-gray-500 mt-2">
                        Updated: {timestampStr}
                    </p>
                </div>

                <div className="flex gap-8 mt-4 md:mt-0 text-center">
                    <div>
                        <p className="text-xs text-gray-500 uppercase font-semibold">Advance</p>
                        <p className="text-xl font-bold text-green-600">{advDecData?.advances ?? "-"}</p>
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 uppercase font-semibold">Decline</p>
                        <p className="text-xl font-bold text-red-600">{advDecData?.declines ?? "-"}</p>
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 uppercase font-semibold">Unchanged</p>
                        <p className="text-xl font-bold text-gray-600">{advDecData?.unchanged ?? "-"}</p>
                    </div>
                </div>
            </div>

            {/* Key Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6 py-6 border-t border-gray-100 dark:border-slate-800">
                <MetricItem label="Open" value={safeNumber(data.open)} />
                <MetricItem label="Previous Close" value={safeNumber(data.previousClose)} />
                <MetricItem label="High" value={safeNumber(data.high)} />
                <MetricItem label="Low" value={safeNumber(data.low)} />
                <MetricItem label="P/E Ratio" value={safeNumber(data.peRatio)} />
                <MetricItem label="P/B Ratio" value={safeNumber(data.pbRatio)} />
            </div>

            {/* Range Bars */}
            <div className="grid md:grid-cols-2 gap-8 py-6 border-t border-gray-100 dark:border-slate-800">
                <RangeBar
                    label="Day Range"
                    low={data.low}
                    high={data.high}
                    current={data.lastPrice}
                />
                <RangeBar
                    label="52 Week Range"
                    low={data.yearLow}
                    high={data.yearHigh}
                    current={data.lastPrice}
                />
            </div>
        </div>
    );
}

function MetricItem({ label, value }: { label: string, value: string | number }) {
    return (
        <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">
                {value}
            </p>
        </div>
    );
}

function RangeBar({ label, low, high, current }: { label: string, low: string, high: string, current: string }) {
    const l = parseFloat(low);
    const h = parseFloat(high);
    const c = parseFloat(current);

    if (isNaN(l) || isNaN(h) || isNaN(c)) return null;

    const range = h - l;
    const pct = range === 0 ? 0 : Math.min(100, Math.max(0, ((c - l) / range) * 100));

    return (
        <div>
            <div className="flex justify-between text-sm mb-2">
                <span className="font-semibold dark:text-white">{label}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>{low} L</span>
                <span className="font-bold text-gray-900 dark:text-white">{current}</span>
                <span>{high} H</span>
            </div>
            <div className="h-2 bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden relative">
                <div
                    className="h-full bg-gradient-to-r from-red-500 via-yellow-400 to-green-500"
                    style={{ width: '100%' }}
                ></div>
                <div
                    className="absolute top-0 w-1 h-full bg-black dark:bg-white border text-transparent"
                    style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}
                />
            </div>
        </div>
    )
}
