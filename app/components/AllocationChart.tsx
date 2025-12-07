"use client";


import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import { Holding } from '@/lib/services/portfolioService';

ChartJS.register(ArcElement, Tooltip, Legend);

interface AllocationChartProps {
    holdings: Holding[];
}

export default function AllocationChart({ holdings }: AllocationChartProps) {
    const chartColors = [
        'rgba(59, 130, 246, 0.8)',   // blue
        'rgba(16, 185, 129, 0.8)',   // green
        'rgba(245, 158, 11, 0.8)',   // amber
        'rgba(239, 68, 68, 0.8)',    // red
        'rgba(139, 92, 246, 0.8)',   // purple
        'rgba(236, 72, 153, 0.8)',   // pink
        'rgba(20, 184, 166, 0.8)',   // teal
    ];

    const data = {
        labels: holdings.map(h => h.ticker),
        datasets: [
            {
                data: holdings.map(h => h.allocation),
                backgroundColor: chartColors.slice(0, holdings.length),
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
                        const data = chart.data;
                        if (data.labels && data.datasets.length) {
                            const bgColors = data.datasets[0].backgroundColor as string[];
                            return data.labels.map((label, i) => {
                                const value = data.datasets[0].data[i] as number;
                                return {
                                    text: `${label}: ${value.toFixed(1)}%`,
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
                        const holding = holdings[context.dataIndex];
                        return [
                            `${label}: ${value.toFixed(2)}%`,
                            `Value: ₹${holding.currentValue.toLocaleString('en-IN')}`,
                        ];
                    },
                },
            },
        },
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
            <h2 className="text-xl font-semibold mb-6 text-gray-900 dark:text-white">
                Portfolio Allocation
            </h2>
            <div className="h-80">
                <Doughnut data={data} options={options} />
            </div>
        </div>
    );
}
