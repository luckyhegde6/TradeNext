"use client";

import { use } from "react";
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

export default function IndexDetailPage({ params }: { params: Promise<{ index: string }> }) {
    const resolvedParams = use(params);
    const indexKey = decodeURIComponent(resolvedParams.index);

    // Fetch Chart Data
    const { data: chartData, isLoading: chartLoading } = useSWR(
        `/api/nse/index/${encodeURIComponent(indexKey)}/chart`,
        fetcher
    );

    // Fetch Heatmap Data (Constituents)
    const { data: heatmapData, isLoading: heatmapLoading } = useSWR(
        `/api/nse/index/${encodeURIComponent(indexKey)}/heatmap`,
        fetcher
    );

    // Prepare Chart Data
    const formatChartData = () => {
        if (!chartData || !chartData.grapthData) return null;

        // NSE returns timestamps in milliseconds
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const labels = chartData.grapthData.map((pt: any) => {
            const d = new Date(pt[0]);
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prices = chartData.grapthData.map((pt: any) => pt[1]);

        return {
            labels,
            datasets: [
                {
                    label: indexKey,
                    data: prices,
                    fill: true,
                    backgroundColor: "rgba(59, 130, 246, 0.1)",
                    borderColor: "rgb(59, 130, 246)",
                    tension: 0.2,
                    pointRadius: 0,
                },
            ],
        };
    };

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: { mode: 'index' as const, intersect: false },
        },
        scales: {
            x: { display: true, grid: { display: false } },
            y: { display: true, position: 'right' as const },
        },
        interaction: {
            mode: 'nearest' as const,
            axis: 'x' as const,
            intersect: false
        }
    };

    const data = formatChartData();

    return (
        <div className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-7xl mx-auto space-y-8">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">{indexKey}</h1>
                    <p className="text-gray-500">Intraday Performance</p>
                </div>

                {/* Chart Section */}
                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 h-[400px]">
                    {chartLoading ? (
                        <div className="h-full flex items-center justify-center text-gray-400">Loading Chart...</div>
                    ) : data ? (
                        <Line options={chartOptions} data={data} />
                    ) : (
                        <div className="h-full flex items-center justify-center text-red-400">Chart data unavailable</div>
                    )}
                </div>

                {/* Heatmap / Constituents Section */}
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 mb-6">Market Heatmap & Constituents</h2>
                    {heatmapLoading ? (
                        <div className="text-center py-10">Loading Heatmap...</div>
                    ) : heatmapData?.data ? (
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {heatmapData.data.map((stock: any) => {
                                const rawPChange = stock.pChange;
                                let pChange = parseFloat(rawPChange);
                                if (isNaN(pChange)) pChange = 0; // Fallback for invalid numbers

                                const isPos = pChange >= 0;
                                // Color intensity based on magnitude (simple logic)
                                const opacity = Math.min(Math.abs(pChange) / 3, 1) * 0.8 + 0.2;
                                const bg = isPos ? `rgba(34, 197, 94, ${opacity})` : `rgba(239, 68, 68, ${opacity})`;
                                const text = Math.abs(pChange) > 1 ? 'white' : 'gray-900';

                                return (
                                    <div
                                        key={stock.symbol}
                                        className="p-4 rounded shadow-sm flex flex-col items-center justify-center text-center transition-transform hover:scale-105"
                                        style={{ backgroundColor: bg, color: text === 'white' ? '#fff' : '#111' }}
                                    >
                                        <span className="font-bold text-sm truncate w-full">{stock.symbol}</span>
                                        <span className="text-xs">{stock.lastPrice}</span>
                                        <span className="text-xs font-semibold">{pChange > 0 ? '+' : ''}{pChange.toFixed(2)}%</span>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <p>No heatmap data available.</p>
                    )}
                </div>
            </div>
        </div>
    );
}
