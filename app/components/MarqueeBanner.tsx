"use client";
import useSWR from "swr";

export default function MarqueeBanner() {
  const { data, error, isLoading } = useSWR("/api/nse/marquee", (url) => fetch(url).then(r => r.json()));

  if (error) return null;
  // Based on actual API response, data is in data.data array
  const marqueeItems = data?.data || [];

  if (marqueeItems.length === 0 && !isLoading) return null;

  return (
    <div className="bg-yellow-100 dark:bg-yellow-900 text-yellow-900 dark:text-yellow-100 py-2 shadow-inner w-full overflow-hidden relative border-y border-yellow-200 dark:border-yellow-800">
      <div
        className="flex animate-marquee whitespace-nowrap"
        onMouseEnter={(e) => (e.currentTarget.style.animationPlayState = 'paused')}
        onMouseLeave={(e) => (e.currentTarget.style.animationPlayState = 'running')}
      >
        {[...marqueeItems, ...marqueeItems].map((item: any, idx: number) => {
          const symbol = item.symbol;
          const price = item.lastTradedPrice || item.ltp || item.lastPrice || 0;
          const change = item.change || 0;
          const pChange = item.perChange || item.pChange || 0;

          return (
            <span key={idx} className="mx-8 inline-flex items-center">
              <span className="font-bold text-sm tracking-tight">{symbol}</span>
              <span className="ml-2 font-mono text-sm">{price}</span>
              <span className={`ml-2 text-[10px] font-bold px-1 rounded ${change >= 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                {change >= 0 ? '↑' : '↓'} {Math.abs(change).toFixed(2)} ({pChange}%)
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
