"use client";

import { useState, useEffect } from "react";

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
    Filler
} from "chart.js";
import { Line } from "react-chartjs-2";

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

export default function HomeChart() {
    const { data: chartData } = useSWR("/api/nse/index/NIFTY%2050/chart", fetcher, {
        refreshInterval: 60000,
    });

    const { data: quoteData } = useSWR("/api/nse/index/NIFTY%2050", fetcher, {
        refreshInterval: 30000,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const labels = chartData?.grapthData?.map((pt: any) => {
        const d = new Date(pt[0]);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }) || [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const values = chartData?.grapthData?.map((pt: any) => pt[1]) || [];

    // Determine color based on latest change (green/red)
    // If no quote data, fallback to last chart point comparison
    const isPositive = quoteData ? quoteData.pChange >= 0 : (values[values.length - 1] >= values[0]);
    const lineColor = isPositive ? 'rgb(22, 163, 74)' : 'rgb(220, 38, 38)'; // green-600 or red-600
    const fillColor = isPositive ? 'rgba(22, 163, 74, 0.1)' : 'rgba(220, 38, 38, 0.1)';

    const data = {
        labels,
        datasets: [
            {
                label: 'NIFTY 50',
                data: values,
                borderColor: lineColor,
                backgroundColor: fillColor,
                tension: 0.2,
                fill: true,
                pointRadius: 0,
                borderWidth: 2,
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
            },
        },
        scales: {
            x: {
                display: true,
                grid: {
                    display: false,
                },
                ticks: {
                    maxTicksLimit: 8,
                }
            },
            y: {
                display: true,
                position: 'right' as const,
                grid: {
                    color: 'rgba(0, 0, 0, 0.05)',
                },
            },
        },
        interaction: {
            mode: 'nearest' as const,
            axis: 'x' as const,
            intersect: false
        }
    };

    const [currentTime, setCurrentTime] = useState<string>("");

    useEffect(() => {
        setCurrentTime(`${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()} IST`);
    }, []);

    return (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-800 p-6 h-[600px]">
            <div className="flex justify-between items-start mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        NIFTY 50
                        <span className="text-xs font-normal text-gray-500 bg-gray-100 px-2 py-1 rounded">NSE Indices</span>
                    </h2>
                    {quoteData && (
                        <div className="mt-2 flex items-baseline gap-3">
                            <span className="text-4xl font-extrabold text-gray-900 dark:text-white">
                                {quoteData.lastPrice}
                            </span>
                            <span className={`text-xl font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                                {isPositive ? '+' : ''}{quoteData.change} ({quoteData.pChange}%)
                            </span>
                        </div>
                    )}
                    <div className="text-xs text-gray-500 mt-1">
                        As on {currentTime}
                    </div>
                </div>
                <div className="flex gap-2">
                    {/* Add time range buttons if needed later */}
                    <button className="px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded">1D</button>
                </div>
            </div>
            <div className="h-[450px] w-full">
                <Line data={data} options={options} />
            </div>
        </div>
    );
}
