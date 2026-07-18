"use client";

import { useState, useEffect, useCallback } from "react";
import DividendMonthView from "@/app/components/dividends/DividendMonthView";
import DividendListView from "@/app/components/dividends/DividendListView";
import DividendSummaryCards from "@/app/components/dividends/DividendSummaryCards";
import DividendIncomeChart from "@/app/components/dividends/DividendIncomeChart";
import type {
  DividendCalendarData,
  DividendEvent,
  MonthlyIncome,
} from "@/lib/services/dividendCalendarService";

type ViewTab = "calendar" | "list" | "income";

export default function DividendsPage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [activeTab, setActiveTab] = useState<ViewTab>("calendar");

  const [calendarData, setCalendarData] = useState<DividendCalendarData | null>(null);
  const [allDividends, setAllDividends] = useState<DividendEvent[]>([]);
  const [incomeData, setIncomeData] = useState<MonthlyIncome[]>([]);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(true);
  const [incomeLoading, setIncomeLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [calRes, listRes, incRes] = await Promise.all([
        fetch(`/api/dividends/calendar?month=${month}&year=${year}&view=calendar`),
        fetch(`/api/dividends/calendar?month=${month}&year=${year}&view=upcoming`),
        fetch(`/api/dividends/calendar?month=${month}&year=${year}&view=income`),
      ]);

      if (calRes.ok) setCalendarData(await calRes.json());
      else throw new Error(`Calendar API: ${calRes.status}`);

      if (listRes.ok) {
        const listData = await listRes.json();
        setAllDividends(listData.dividends || []);
      }

      if (incRes.ok) {
        const incData = await incRes.json();
        setIncomeData(incData.income || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dividend data");
    } finally {
      setLoading(false);
      setListLoading(false);
      setIncomeLoading(false);
    }
  }, [month, year]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handlePrevMonth = () => {
    if (month === 1) { setMonth(12); setYear(year - 1); }
    else { setMonth(month - 1); }
  };

  const handleNextMonth = () => {
    if (month === 12) { setMonth(1); setYear(year + 1); }
    else { setMonth(month + 1); }
  };

  const handleToday = () => {
    const today = new Date();
    setMonth(today.getMonth() + 1);
    setYear(today.getFullYear());
  };

  const tabs: { key: ViewTab; label: string }[] = [
    { key: "calendar", label: "Calendar" },
    { key: "list", label: "List" },
    { key: "income", label: "Income" },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dividend Calendar</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Track upcoming dividends and projected income
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <DividendSummaryCards
        summary={calendarData?.summary || { upcomingCount: 0, estMonthlyIncome: 0, estAnnualIncome: 0, avgYield: null, totalDividends: 0 }}
        loading={loading}
      />

      {/* Error state */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-sm text-red-700 dark:text-red-300">
          {error}
          <button onClick={fetchData} className="ml-3 underline hover:no-underline">
            Retry
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-slate-700 rounded-lg p-1 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === tab.key
                ? "bg-white dark:bg-slate-600 text-gray-900 dark:text-white shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Calendar view */}
      {activeTab === "calendar" && (
        <DividendMonthView
          dividends={calendarData?.dividends || []}
          month={month}
          year={year}
          onPrevMonth={handlePrevMonth}
          onNextMonth={handleNextMonth}
          onToday={handleToday}
        />
      )}

      {/* List view */}
      {activeTab === "list" && (
        <DividendListView
          dividends={allDividends}
          loading={listLoading}
        />
      )}

      {/* Income chart view */}
      {activeTab === "income" && (
        <DividendIncomeChart data={incomeData} loading={incomeLoading} />
      )}
    </div>
  );
}
