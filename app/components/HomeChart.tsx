"use client";

import React, { useState, useEffect } from "react";
import { MAJOR_INDICES } from "@/lib/constants";

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

export default function HomeChart({ symbol: initialSymbol = "NIFTY 50" }: { symbol?: string }) {
    // State for selected index
    const [selectedIndex, setSelectedIndex] = useState(initialSymbol);

    // Encode symbol once
    const encodedSymbol = encodeURIComponent(selectedIndex);

    const { data: chartData } = useSWR(`/api/nse/index/${encodedSymbol}/chart`, fetcher, {
        refreshInterval: 60000,
    });

    const { data: quoteData } = useSWR(`/api/nse/index/${encodedSymbol}`, fetcher, {
        refreshInterval: 30000,
    });

    // Debug logging
    useEffect(() => {
        if (quoteData) {
            console.log('HomeChart quoteData:', {
                symbol: selectedIndex,
                lastPrice: quoteData.lastPrice,
                change: quoteData.change,
                pChange: quoteData.pChange,
                changeType: typeof quoteData.change,
                pChangeType: typeof quoteData.pChange
            });
        }
    }, [quoteData, selectedIndex]);

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
                label: selectedIndex,
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
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                titleColor: 'white',
                bodyColor: 'white',
                borderColor: 'rgba(255, 255, 255, 0.2)',
                borderWidth: 1,
                cornerRadius: 8,
                displayColors: false,
                padding: 12,
            },
        },
        scales: {
            x: {
                display: true,
                grid: {
                    display: false,
                },
                ticks: {
                    maxTicksLimit: 6,
                    font: {
                        size: 11,
                    },
                }
            },
            y: {
                display: true,
                position: 'right' as const,
                grid: {
                    color: 'rgba(0, 0, 0, 0.05)',
                },
                ticks: {
                    font: {
                        size: 11,
                    },
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
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-800 p-4 sm:p-6 h-[400px] sm:h-[500px] lg:h-[600px]">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start mb-4 sm:mb-6 gap-4">
                <div className="flex-1">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-2">
                        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                            {selectedIndex}
                        </h2>
                        <select
                            value={selectedIndex}
                            onChange={(e) => setSelectedIndex(e.target.value)}
                            className="text-sm font-medium bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-auto"
                        >
                            {MAJOR_INDICES.map((idx) => (
                                <option key={idx.key} value={idx.key}>
                                    {idx.name}
                                </option>
                            ))}
                        </select>
                        <span className="text-xs font-normal text-gray-500 bg-gray-100 px-2 py-1 rounded">NSE Indices</span>
                    </div>
                    {quoteData && (
                        <div className="mt-2 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3">
                            <span className="text-3xl sm:text-4xl font-extrabold text-gray-900 dark:text-white">
                                {parseFloat(quoteData.lastPrice).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                            </span>
                            <span className={`text-lg sm:text-xl font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                                {isPositive ? '+' : ''}{parseFloat(quoteData.change).toFixed(2)} ({parseFloat(quoteData.pChange).toFixed(2)}%)
                            </span>
                        </div>
                    )}
                    <div className="text-xs text-gray-500 mt-1">
                        As on {currentTime}
                    </div>
                </div>
                <div className="flex gap-2 mt-4 sm:mt-0">
                    {/* Add time range buttons if needed later */}
                    <button className="px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">
                        1D
                    </button>
                </div>
            </div>
            <div className="h-[450px] w-full">
                <Line data={data} options={options} />
            </div>
        </div>
    );
}
