"use client";

interface TechnicalSummaryProps {
  trend: string;
  support: number | null;
  resistance: number | null;
  indicators: string;
}

export default function TechnicalSummary({ trend, support, resistance, indicators }: TechnicalSummaryProps) {
  const trendColor = trend.toLowerCase().includes("up") || trend.toLowerCase().includes("bull")
    ? "text-emerald-600 dark:text-emerald-400"
    : trend.toLowerCase().includes("down") || trend.toLowerCase().includes("bear")
      ? "text-red-600 dark:text-red-400"
      : "text-gray-600 dark:text-gray-400";

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-5" data-testid="technical-summary">
      <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Technical Analysis</h4>
      <div className="grid grid-cols-2 gap-4 mb-3">
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Trend</div>
          <div className={`font-semibold ${trendColor}`}>{trend || "—"}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Support / Resistance</div>
          <div className="font-medium text-gray-900 dark:text-white text-sm">
            {support != null ? `₹${support.toLocaleString()}` : "—"} / {resistance != null ? `₹${resistance.toLocaleString()}` : "—"}
          </div>
        </div>
      </div>
      {indicators && (
        <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-slate-800 rounded p-2">{indicators}</div>
      )}
    </div>
  );
}
