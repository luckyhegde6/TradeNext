"use client";

interface NewsCatalystListProps {
  positive: string[];
  negative: string[];
  neutral: string[];
}

export default function NewsCatalystList({ positive, negative, neutral }: NewsCatalystListProps) {
  const hasData = positive.length > 0 || negative.length > 0 || neutral.length > 0;
  if (!hasData) return null;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-5" data-testid="news-catalyst-list">
      <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">News &amp; Catalysts</h4>
      <div className="space-y-3">
        {positive.map((item, i) => (
          <div key={`p-${i}`} className="flex items-start gap-2 text-sm">
            <span className="text-emerald-500 mt-0.5">▲</span>
            <span className="text-gray-700 dark:text-gray-300">{item}</span>
          </div>
        ))}
        {negative.map((item, i) => (
          <div key={`n-${i}`} className="flex items-start gap-2 text-sm">
            <span className="text-red-500 mt-0.5">▼</span>
            <span className="text-gray-700 dark:text-gray-300">{item}</span>
          </div>
        ))}
        {neutral.map((item, i) => (
          <div key={`u-${i}`} className="flex items-start gap-2 text-sm">
            <span className="text-gray-400 mt-0.5">•</span>
            <span className="text-gray-500 dark:text-gray-400">{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
