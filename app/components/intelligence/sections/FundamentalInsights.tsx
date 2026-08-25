"use client";

interface FundamentalInsightsProps {
  strengths: string[];
  weaknesses: string[];
}

export default function FundamentalInsights({ strengths, weaknesses }: FundamentalInsightsProps) {
  const hasData = strengths.length > 0 || weaknesses.length > 0;
  if (!hasData) return null;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-5" data-testid="fundamental-insights">
      <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Fundamental Analysis</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {strengths.length > 0 && (
          <div>
            <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-2">Strengths</div>
            <ul className="space-y-1">
              {strengths.map((s, i) => (
                <li key={i} className="text-sm text-gray-700 dark:text-gray-300 flex items-start gap-1.5">
                  <span className="text-emerald-500 mt-0.5">+</span> {s}
                </li>
              ))}
            </ul>
          </div>
        )}
        {weaknesses.length > 0 && (
          <div>
            <div className="text-xs font-medium text-red-600 dark:text-red-400 mb-2">Weaknesses</div>
            <ul className="space-y-1">
              {weaknesses.map((w, i) => (
                <li key={i} className="text-sm text-gray-700 dark:text-gray-300 flex items-start gap-1.5">
                  <span className="text-red-500 mt-0.5">-</span> {w}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
