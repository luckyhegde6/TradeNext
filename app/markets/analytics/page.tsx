"use client";

import MarketAnalyticsTabs from "@/app/components/MarketAnalyticsTabs";
function Freshness({ meta }: { meta: any }) {
    return (
      <div className="text-xs text-gray-500 mb-2 flex gap-2">
        <span>
          As of {new Date(meta.fetchedAt).toLocaleTimeString("en-IN")}
        </span>
        {meta.stale && (
          <span className="text-amber-500">
            (Updating…)
          </span>
        )}
      </div>
    );
  }
export default function MarketAnalyticsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-4xl font-extrabold text-gray-900 dark:text-white">
          Market Analytics
        </h1>
        <p className="mt-2 text-lg text-gray-600 dark:text-gray-400">
          Market-wide insights across all NSE-listed stocks.
        </p>
      </header>

      <MarketAnalyticsTabs />
    </div>
  );
}
