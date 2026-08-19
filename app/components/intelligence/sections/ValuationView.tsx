"use client";

interface ValuationViewProps {
  assessment: string;
  relativeValue: string;
}

export default function ValuationView({ assessment, relativeValue }: ValuationViewProps) {
  if (!assessment && !relativeValue) return null;
  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-5" data-testid="valuation-view">
      <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Valuation</h4>
      <div className="space-y-2">
        {assessment && <div className="text-sm text-gray-900 dark:text-white font-medium">{assessment}</div>}
        {relativeValue && <div className="text-xs text-gray-500 dark:text-gray-400">{relativeValue}</div>}
      </div>
    </div>
  );
}
