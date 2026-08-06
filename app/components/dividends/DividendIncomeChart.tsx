"use client";

import { useEffect, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { MonthlyIncome } from "@/lib/services/dividendCalendarService";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

interface Props {
  data: MonthlyIncome[];
  loading?: boolean;
}

export default function DividendIncomeChart({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-gray-200 dark:border-slate-700 animate-pulse">
        <div className="h-4 w-40 bg-gray-200 dark:bg-slate-600 rounded mb-4" />
        <div className="h-48 bg-gray-200 dark:bg-slate-600 rounded" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-gray-200 dark:border-slate-700 text-center">
        <div className="text-3xl mb-2">📊</div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No projected dividend income data available.
        </p>
      </div>
    );
  }

  const chartData = {
    labels: data.map((m) => m.label),
    datasets: [
      {
        label: "Est. Dividend Income (₹)",
        data: data.map((m) => m.income),
        backgroundColor: data.map((m) =>
          m.income > 0
            ? "rgba(34, 197, 94, 0.7)"
            : "rgba(156, 163, 175, 0.3)"
        ),
        borderColor: data.map((m) =>
          m.income > 0
            ? "rgb(34, 197, 94)"
            : "rgb(156, 163, 175)"
        ),
        borderWidth: 1,
        borderRadius: 4,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context: any) => `₹${context.parsed.y.toLocaleString("en-IN")}`,
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          callback: (value: any) => `₹${value.toLocaleString("en-IN")}`,
        },
        grid: {
          color: "rgba(156, 163, 175, 0.15)",
        },
      },
      x: {
        grid: { display: false },
      },
    },
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-gray-200 dark:border-slate-700">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
        Projected Monthly Dividend Income
      </h3>
      <div className="h-48 md:h-64">
        <Bar data={chartData} options={options} />
      </div>
    </div>
  );
}
