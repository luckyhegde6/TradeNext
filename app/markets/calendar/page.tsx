"use client";

import { useState, useEffect, useMemo } from "react";
import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then(res => res.json());

interface CorporateAction {
  id: number;
  symbol: string;
  companyName: string;
  actionType: string;
  exDate: string | null;
  dividendPerShare: number | null;
  dividendYield: number | null;
}

interface CorporateEvent {
  symbol: string;
  companyName: string;
  purpose: string;
  details: string;
  date: string;
}

type CalendarDay = {
  date: Date;
  actions: CorporateAction[];
  events: CorporateEvent[];
};

const ACTION_COLORS: Record<string, string> = {
  DIVIDEND: "bg-green-500",
  BONUS: "bg-orange-500",
  SPLIT: "bg-pink-500",
  RIGHTS: "bg-indigo-500",
  BUYBACK: "bg-cyan-500",
  INTEREST: "bg-yellow-500",
  OTHER: "bg-gray-500",
};

const ACTION_ICONS: Record<string, string> = {
  DIVIDEND: "💰",
  BONUS: "🎁",
  SPLIT: "✂️",
  RIGHTS: "📈",
  BUYBACK: "🔄",
  INTEREST: "📊",
  OTHER: "📌",
};

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<"month" | "week">("month");
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null);
  const [filterType, setFilterType] = useState<string>("all");

  // Fetch corporate actions
  const { data: actionsData, isLoading: actionsLoading } = useSWR(
    "/api/corporate-actions/combined?limit=5000",
    fetcher,
    { refreshInterval: 60000 }
  );

  // Fetch corporate events
  const { data: eventsData, isLoading: eventsLoading } = useSWR(
    "/api/nse/corporate-events",
    fetcher,
    { refreshInterval: 60000 }
  );

  // Get raw arrays from response objects
  const actions: CorporateAction[] = Array.isArray(actionsData) 
    ? actionsData 
    : (actionsData as any)?.data || [];
  const events: CorporateEvent[] = Array.isArray(eventsData) 
    ? eventsData 
    : (eventsData as any)?.data || [];

  // Get days in month
  const daysInMonth = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days: CalendarDay[] = [];

    // Add padding for first week
    const startPadding = firstDay.getDay();
    for (let i = startPadding - 1; i >= 0; i--) {
      const date = new Date(year, month, -i);
      days.push({ date, actions: [], events: [] });
    }

    // Add days of month
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const date = new Date(year, month, day);
      const dateStr = date.toISOString().split("T")[0];

      // Filter actions for this day
      const dayActions = actions.filter((action) => {
        if (!action.exDate) return false;
        const actionDate = new Date(action.exDate).toISOString().split("T")[0];
        const matches = actionDate === dateStr;
        const typeMatch = filterType === "all" || action.actionType === filterType;
        return matches && typeMatch;
      });

      // Filter events for this day
      const dayEvents = events.filter((event) => {
        if (!event.date) return false;
        const eventDate = new Date(event.date).toISOString().split("T")[0];
        return eventDate === dateStr;
      });

      days.push({ date, actions: dayActions, events: dayEvents });
    }

    // Add padding for last week
    const endPadding = 6 - lastDay.getDay();
    for (let i = 1; i <= endPadding; i++) {
      const date = new Date(year, month + 1, i);
      days.push({ date, actions: [], events: [] });
    }

    return days;
  }, [currentDate, actions, events, filterType]);

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const goToPreviousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const isSelected = (date: Date) => {
    return selectedDay?.date.toDateString() === date.toDateString();
  };

  const getActionTypes = () => {
    const types = new Set<string>();
    actions.forEach((a) => types.add(a.actionType));
    return Array.from(types).sort();
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        {/* Compact Header */}
        <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">
              Corporate Actions Calendar
            </h1>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Dividends, bonuses, splits & events
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Filter by type */}
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-2 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            >
              <option value="all">All Types</option>
              {getActionTypes().map((type) => (
                <option key={type} value={type}>
                  {ACTION_ICONS[type] || "📌"} {type}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Calendar Navigation */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <button
              onClick={goToPreviousMonth}
              className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={goToToday}
              className="px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-800 rounded-lg"
            >
              Today
            </button>
            <button
              onClick={goToNextMonth}
              className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white ml-2">
              {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
            </h2>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setView("month")}
              className={`px-2 py-1 rounded-lg text-xs font-medium ${
                view === "month"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300"
              }`}
            >
              Month
            </button>
            <button
              onClick={() => setView("week")}
              className={`px-2 py-1 rounded-lg text-xs font-medium ${
                view === "week"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300"
              }`}
            >
              Week
            </button>
          </div>
        </div>

        {/* Loading State */}
        {(actionsLoading || eventsLoading) && (
          <div className="flex justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          </div>
        )}

        {/* Calendar and Details - Side by Side */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Compact Calendar Grid */}
          <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden">
            {/* Week day headers */}
            <div className="grid grid-cols-7 bg-gray-50 dark:bg-slate-800">
              {weekDays.map((day) => (
                <div
                  key={day}
                  className="px-1 py-2 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase"
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar days */}
            <div className="grid grid-cols-7">
              {daysInMonth.map((day, index) => {
                const hasActions = day.actions.length > 0;
                const hasEvents = day.events.length > 0;
                const isCurrentMonth = day.date.getMonth() === currentDate.getMonth();

                return (
                  <button
                    key={index}
                    onClick={() => setSelectedDay(day)}
                    className={`
                      min-h-[50px] p-1 border-t border-r border-gray-100 dark:border-slate-800 text-left text-xs
                      ${!isCurrentMonth ? "bg-gray-50 dark:bg-slate-800/50" : "bg-white dark:bg-slate-900"}
                      ${isToday(day.date) ? "bg-blue-50 dark:bg-blue-900/20" : ""}
                      ${isSelected(day.date) ? "ring-2 ring-blue-500" : ""}
                      hover:bg-gray-50 dark:hover:bg-slate-800
                      transition-colors
                    `}
                  >
                    <div className={`text-xs font-medium ${
                      isToday(day.date)
                        ? "text-blue-600 dark:text-blue-400"
                        : isCurrentMonth
                          ? "text-gray-900 dark:text-white"
                          : "text-gray-400 dark:text-gray-600"
                    }`}>
                      {day.date.getDate()}
                    </div>
                    
                    {/* Indicators */}
                    <div className="flex flex-wrap gap-0.5 mt-0.5">
                      {day.actions.slice(0, 2).map((action, i) => (
                        <span
                          key={i}
                          className={`inline-block w-1.5 h-1.5 rounded-full ${
                            ACTION_COLORS[action.actionType] || "bg-gray-500"
                          }`}
                          title={`${action.symbol} - ${action.actionType}`}
                        />
                      ))}
                      {day.actions.length > 2 && (
                        <span className="text-[10px] text-gray-500">+{day.actions.length - 2}</span>
                      )}
                      {hasEvents && (
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-500" title="Events" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected Day Details Panel */}
          <div className="lg:col-span-1">
            {selectedDay ? (
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-4 h-full">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                    {selectedDay.date.toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </h3>
                  <button
                    onClick={() => setSelectedDay(null)}
                    className="p-1 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {selectedDay.actions.length === 0 && selectedDay.events.length === 0 ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400">No actions or events</p>
                ) : (
                  <div className="space-y-2 text-xs overflow-y-auto max-h-[300px]">
                    {/* Corporate Actions */}
                    {selectedDay.actions.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                          Actions ({selectedDay.actions.length})
                        </h4>
                        <div className="space-y-1.5">
                          {selectedDay.actions.map((action) => (
                            <div
                              key={action.id}
                              className="flex items-center justify-between p-2 bg-gray-50 dark:bg-slate-800 rounded-lg"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-sm">
                                  {ACTION_ICONS[action.actionType] || "📌"}
                                </span>
                                <div>
                                  <div className="font-medium text-gray-900 dark:text-white text-xs">
                                    {action.symbol}
                                  </div>
                                  <div className="text-[10px] text-gray-500 dark:text-gray-400">
                                    {action.actionType}
                                  </div>
                                </div>
                              </div>
                              {action.dividendPerShare && (
                                <div className="text-right">
                                  <div className="text-xs font-medium text-green-600 dark:text-green-400">
                                    ₹{action.dividendPerShare}
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Corporate Events */}
                    {selectedDay.events.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                          Events ({selectedDay.events.length})
                        </h4>
                        <div className="space-y-1.5">
                          {selectedDay.events.slice(0, 5).map((event, i) => (
                            <div
                              key={i}
                              className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg"
                            >
                              <div className="font-medium text-gray-900 dark:text-white text-xs">
                                {event.symbol}
                              </div>
                              <div className="text-[10px] text-purple-600 dark:text-purple-400 truncate">
                                {event.purpose}
                              </div>
                            </div>
                          ))}
                          {selectedDay.events.length > 5 && (
                            <div className="text-[10px] text-gray-500 text-center">
                              +{selectedDay.events.length - 5} more
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-4 h-full flex items-center justify-center">
                <p className="text-xs text-gray-500 dark:text-gray-400">Click a day to see details</p>
              </div>
            )}
          </div>
        </div>

        {/* Compact Legend */}
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-600 dark:text-gray-400">
          <div className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500"></span>
            <span>Dividend</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-orange-500"></span>
            <span>Bonus</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-pink-500"></span>
            <span>Split</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-indigo-500"></span>
            <span>Rights</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-cyan-500"></span>
            <span>Buyback</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-purple-500"></span>
            <span>Events</span>
          </div>
        </div>
      </div>
    </div>
  );
}
