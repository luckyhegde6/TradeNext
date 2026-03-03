"use client";

import { useMemo } from 'react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import { Holding } from '@/lib/services/portfolioService';

ChartJS.register(ArcElement, Tooltip, Legend);

interface SectorAllocationChartProps {
    holdings: Holding[];
}

export default function SectorAllocationChart({ holdings }: SectorAllocationChartProps) {
    const sectorData = useMemo(() => {
        if (!holdings || holdings.length === 0) {
            return null;
        }

        const sectorMap = new Map<string, number>();
        let totalValue = 0;

        holdings.forEach(holding => {
            const sector = holding.sector || 'Other';
            const currentValue = holding.currentValue || 0;
            sectorMap.set(sector, (sectorMap.get(sector) || 0) + currentValue);
            totalValue += currentValue;
        });

        const sectors = Array.from(sectorMap.entries()).map(([sector, value]) => ({
            sector,
            value,
            percentage: totalValue > 0 ? (value / totalValue) * 100 : 0,
        }));

        return sectors.sort((a, b) => b.value - a.value);
    }, [holdings]);

    const chartColors = [
        'rgba(59, 130, 246, 0.8)',   // blue
        'rgba(16, 185, 129, 0.8)',   // green
        'rgba(245, 158, 11, 0.8)',   // amber
        'rgba(239, 68, 68, 0.8)',    // red
        'rgba(139, 92, 246, 0.8)',   // purple
        'rgba(236, 72, 153, 0.8)',   // pink
        'rgba(20, 184, 166, 0.8)',   // teal
        'rgba(249, 115, 22, 0.8)',  // orange
        'rgba(34, 197, 94, 0.8)',    // emerald
        'rgba(168, 85, 247, 0.8)',   // violet
    ];

    if (!sectorData || sectorData.length === 0) {
        return (
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                <h2 className="text-xl font-semibold mb-6 text-gray-900 dark:text-white">
                    Sector Allocation
                </h2>
                <div className="h-48 flex items-center justify-center text-gray-500 dark:text-slate-400">
                    No holdings data available
                </div>
            </div>
        );
    }

    const data = {
        labels: sectorData.map(s => s.sector),
        datasets: [
            {
                data: sectorData.map(s => s.value),
                backgroundColor: chartColors.slice(0, sectorData.length),
                borderColor: 'rgba(255, 255, 255, 0.8)',
                borderWidth: 2,
            },
        ],
    };

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'right' as const,
                labels: {
                    color: 'rgb(156, 163, 175)',
                    font: {
                        size: 12,
                    },
                    padding: 15,
                    generateLabels: (chart: ChartJS) => {
                        const chartData = chart.data;
                        if (chartData.labels && chartData.datasets.length) {
                            const bgColors = chartData.datasets[0].backgroundColor as string[];
                            return chartData.labels.map((label, i) => {
                                const value = chartData.datasets[0].data[i] as number;
                                const sector = sectorData[i];
                                return {
                                    text: `${label}: ${sector.percentage.toFixed(1)}%`,
                                    fillStyle: bgColors[i],
                                    hidden: false,
                                    index: i,
                                };
                            });
                        }
                        return [];
                    },
                },
            },
            tooltip: {
                callbacks: {
                    label: (context: { label?: string; parsed?: number; dataIndex: number }) => {
                        const label = context.label || '';
                        const value = context.parsed || 0;
                        const sector = sectorData[context.dataIndex];
                        return [
                            `${label}: ₹${value.toLocaleString('en-IN')}`,
                            `${sector.percentage.toFixed(2)}% of portfolio`,
                        ];
                    },
                },
            },
        },
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
            <h2 className="text-xl font-semibold mb-6 text-gray-900 dark:text-white">
                Sector Allocation
            </h2>
            <div className="h-80">
                <Doughnut data={data} options={options} />
            </div>
        </div>
    );
}
