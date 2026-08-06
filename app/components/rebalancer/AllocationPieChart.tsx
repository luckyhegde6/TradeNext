"use client";

import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { Doughnut } from "react-chartjs-2";

ChartJS.register(ArcElement, Tooltip, Legend);

interface AllocationItem {
  name: string;
  percent: number;
  value: number;
}

interface Props {
  current: AllocationItem[];
  target: AllocationItem[];
  title?: string;
}

const COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#06B6D4", "#84CC16", "#F97316", "#6366F1",
  "#14B8A6", "#D946EF", "#0EA5E9", "#22C55E", "#EAB308",
];

export default function AllocationPieChart({ current, target, title }: Props) {
  // Ensure we have data
  if (current.length === 0 && target.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 bg-gray-50 dark:bg-slate-800/50 rounded-lg border border-gray-200 dark:border-slate-700">
        <p className="text-gray-400 text-sm">No allocation data</p>
      </div>
    );
  }

  const chartData = (items: AllocationItem[], label: string) => ({
    labels: items.map((i) => i.name),
    datasets: [
      {
        label,
        data: items.map((i) => i.percent),
        backgroundColor: items.map((_, idx) => COLORS[idx % COLORS.length]),
        borderWidth: 1,
        borderColor: "#fff",
      },
    ],
  });

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "bottom" as const,
        labels: { boxWidth: 12, padding: 12, font: { size: 11 } },
      },
      tooltip: {
        callbacks: {
          label: (ctx: any) => {
            const item = itemsForTooltip(ctx.dataset.label === "Current" ? current : target)[ctx.dataIndex];
            return `${ctx.label}: ${ctx.parsed.toFixed(1)}% (₹${(item?.value || 0).toLocaleString("en-IN")})`;
          },
        },
      },
    },
  };

  const itemsForTooltip = (items: AllocationItem[]) => items;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-slate-700">
      {title && (
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">{title}</h3>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 text-center">Current</p>
          <div className="h-56">
            <Doughnut data={chartData(current, "Current")} options={options} />
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 text-center">Target</p>
          <div className="h-56">
            <Doughnut data={chartData(target, "Target")} options={options} />
          </div>
        </div>
      </div>
    </div>
  );
}
