"use client";

interface CorporateActionsSummaryProps {
  items: Array<{ type: string; date: string; details: string }>;
}

export default function CorporateActionsSummary({ items }: CorporateActionsSummaryProps) {
  if (items.length === 0) return null;
  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-5" data-testid="corporate-actions">
      <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Corporate Actions</h4>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-3 text-sm">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-20 shrink-0">{item.date}</span>
            <span className="text-xs font-medium bg-gray-100 dark:bg-slate-800 px-2 py-0.5 rounded capitalize">{item.type}</span>
            <span className="text-gray-700 dark:text-gray-300 truncate">{item.details}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
