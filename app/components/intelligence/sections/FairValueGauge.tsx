"use client";

interface FairValueGaugeProps {
  low: number;
  mid: number;
  high: number;
  currentPrice?: number;
}

export default function FairValueGauge({ low, mid, high, currentPrice }: FairValueGaugeProps) {
  const range = high - low || 1;
  const midPct = ((mid - low) / range) * 100;
  const pricePct = currentPrice ? Math.min(100, Math.max(0, ((currentPrice - low) / range) * 100)) : null;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-5" data-testid="fair-value-gauge">
      <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">Fair Value Range</h4>
      <div className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500 dark:text-gray-400">Low</span>
          <span className="font-medium text-gray-900 dark:text-white">₹{low.toLocaleString()}</span>
        </div>
        <div className="relative h-3 bg-gray-200 dark:bg-slate-700 rounded-full overflow-visible">
          <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-red-400 via-amber-400 to-emerald-400 rounded-full" style={{ width: "100%" }} />
          <div className="absolute top-1/2 -translate-y-1/2 w-1 h-5 bg-gray-800 dark:bg-white rounded" style={{ left: `${midPct}%` }} />
          {pricePct !== null && (
            <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-blue-500 rounded-full border-2 border-white dark:border-slate-900 shadow" style={{ left: `${pricePct}%` }} title={`Current: ₹${currentPrice?.toLocaleString()}`} />
          )}
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500 dark:text-gray-400">Mid</span>
          <span className="font-semibold text-gray-900 dark:text-white">₹{mid.toLocaleString()}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500 dark:text-gray-400">High</span>
          <span className="font-medium text-gray-900 dark:text-white">₹{high.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
