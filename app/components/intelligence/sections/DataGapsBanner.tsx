"use client";

interface DataGapsBannerProps {
  gaps?: string[];
}

export default function DataGapsBanner({ gaps }: DataGapsBannerProps) {
  if (!gaps || gaps.length === 0) return null;

  return (
    <div className="bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded-lg p-4" data-testid="data-gaps-banner">
      <div className="text-xs font-semibold text-sky-700 dark:text-sky-300 uppercase tracking-wide mb-1.5">
        Data gaps — treated as assumptions
      </div>
      <ul className="space-y-1">
        {gaps.map((g, i) => (
          <li key={i} className="text-xs text-sky-800 dark:text-sky-200 flex items-start gap-1.5">
            <span className="text-sky-500 mt-0.5">◌</span> {g}
          </li>
        ))}
      </ul>
    </div>
  );
}
