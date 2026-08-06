"use client";

import { DividendEvent } from "@/lib/services/dividendCalendarService";

interface Props {
  dividends: DividendEvent[];
  month: number;
  year: number;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

export default function DividendMonthView({
  dividends,
  month,
  year,
  onPrevMonth,
  onNextMonth,
  onToday,
}: Props) {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const startPadding = firstDay.getDay(); // 0=Sun
  const totalDays = lastDay.getDate();

  // Build dividend map: dateKey -> DividendEvent[]
  const dividendMap = new Map<string, DividendEvent[]>();
  for (const d of dividends) {
    if (!d.exDate) continue;
    const dateKey = new Date(d.exDate).toISOString().split("T")[0];
    const existing = dividendMap.get(dateKey) || [];
    existing.push(d);
    dividendMap.set(dateKey, existing);
  }

  const monthName = firstDay.toLocaleString("default", { month: "long" });
  const gridCells: (number | null)[] = [
    ...Array(startPadding).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-slate-700/50 border-b border-gray-200 dark:border-slate-600">
        <button
          onClick={onPrevMonth}
          className="p-2 hover:bg-gray-200 dark:hover:bg-slate-600 rounded-lg transition-colors"
          aria-label="Previous month"
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {monthName} {year}
          </h3>
          <button
            onClick={onToday}
            className="text-xs px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full hover:bg-blue-200 dark:hover:bg-blue-800/40 transition-colors"
          >
            Today
          </button>
        </div>
        <button
          onClick={onNextMonth}
          className="p-2 hover:bg-gray-200 dark:hover:bg-slate-600 rounded-lg transition-colors"
          aria-label="Next month"
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Day labels */}
      <div className="grid grid-cols-7 border-b border-gray-200 dark:border-slate-600">
        {DAYS.map((day) => (
          <div key={day} className="px-2 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7">
        {gridCells.map((day, idx) => {
          if (day === null) {
            return <div key={`empty-${idx}`} className="min-h-[80px] p-1 border-b border-r border-gray-100 dark:border-slate-700/50" />;
          }

          const date = new Date(year, month - 1, day);
          const dateKey = date.toISOString().split("T")[0];
          const dayDividends = dividendMap.get(dateKey) || [];
          const todayClass = isToday(date) ? "bg-blue-100 dark:bg-blue-900/30" : "";

          return (
            <div
              key={dateKey}
              className={`min-h-[80px] p-1 border-b border-r border-gray-100 dark:border-slate-700/50 relative group ${todayClass}`}
            >
              <span className={`text-xs font-medium ${isToday(date) ? "text-blue-700 dark:text-blue-300" : "text-gray-600 dark:text-gray-400"}`}>
                {day}
              </span>

              {/* Dividend dots */}
              {dayDividends.length > 0 && (
                <div className="mt-1">
                  <div className="flex flex-wrap gap-0.5">
                    {dayDividends.slice(0, 3).map((d) => (
                      <span
                        key={d.id}
                        className="w-1.5 h-1.5 rounded-full bg-green-500 dark:bg-green-400"
                        title={`${d.symbol}: ₹${d.dividendPerShare || 0}`}
                      />
                    ))}
                    {dayDividends.length > 3 && (
                      <span className="text-[10px] text-gray-400 ml-0.5">+{dayDividends.length - 3}</span>
                    )}
                  </div>

                  {/* Hover popup */}
                  <div className="absolute z-10 left-0 top-full mt-1 w-64 bg-white dark:bg-slate-700 rounded-lg shadow-lg border border-gray-200 dark:border-slate-600 p-3 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none">
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
                      {date.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric" })}
                    </p>
                    <div className="space-y-2">
                      {dayDividends.map((d) => (
                        <div key={d.id} className="flex items-center justify-between text-sm">
                          <div>
                            <span className="font-medium text-gray-900 dark:text-white">{d.symbol}</span>
                            <span className="text-gray-500 dark:text-gray-400 ml-1 text-xs">{d.companyName}</span>
                          </div>
                          <div className="text-right">
                            <span className="font-medium text-green-600 dark:text-green-400">
                              ₹{d.dividendPerShare?.toFixed(2) || "—"}
                            </span>
                            {d.currentPrice && (
                              <span className="text-xs text-gray-400 ml-1">
                                {d.dividendYield?.toFixed(2)}%
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-4 py-2 text-xs text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-slate-700">
        {dividends.length} dividend{dividends.length !== 1 ? "s" : ""} this month &middot; Hover for details
      </div>
    </div>
  );
}
