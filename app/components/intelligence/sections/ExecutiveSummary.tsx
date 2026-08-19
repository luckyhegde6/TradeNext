"use client";

interface ExecutiveSummaryProps {
  summary: string;
  modelUsed: string | null;
  generatedAt: string;
  isCacheHit: boolean;
  version: number;
}

export default function ExecutiveSummary({ summary, modelUsed, generatedAt, isCacheHit, version }: ExecutiveSummaryProps) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-5" data-testid="executive-summary">
      <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Executive Summary</h4>
      <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{summary || "No summary available."}</p>
      <div className="mt-3 flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
        <span>Model: {modelUsed || "unknown"}</span>
        <span>•</span>
        <span>{new Date(generatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
        <span>•</span>
        <span>v{version}</span>
        {isCacheHit && <span className="bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">cached</span>}
      </div>
    </div>
  );
}
