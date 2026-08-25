"use client";

interface ShareholdingTrendProps {
  summary: string;
}

export default function ShareholdingTrend({ summary }: ShareholdingTrendProps) {
  if (!summary) return null;
  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-5" data-testid="shareholding-trend">
      <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Shareholding Trend</h4>
      <p className="text-sm text-gray-700 dark:text-gray-300">{summary}</p>
    </div>
  );
}
