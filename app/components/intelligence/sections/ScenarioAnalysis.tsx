"use client";

interface ScenarioAnalysisProps {
  bull: string;
  base: string;
  bear: string;
}

export default function ScenarioAnalysis({ bull, base, bear }: ScenarioAnalysisProps) {
  const hasData = bull || base || bear;
  if (!hasData) return null;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-5" data-testid="scenario-analysis">
      <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Scenario Analysis</h4>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {bull && (
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-3">
            <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-1">Bull Case</div>
            <div className="text-sm text-gray-700 dark:text-gray-300">{bull}</div>
          </div>
        )}
        {base && (
          <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-3">
            <div className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">Base Case</div>
            <div className="text-sm text-gray-700 dark:text-gray-300">{base}</div>
          </div>
        )}
        {bear && (
          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3">
            <div className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">Bear Case</div>
            <div className="text-sm text-gray-700 dark:text-gray-300">{bear}</div>
          </div>
        )}
      </div>
    </div>
  );
}
