"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import DailyPicksTab from "@/app/components/recommendations/DailyPicksTab";
import HistoryTab from "@/app/components/recommendations/HistoryTab";
import PerformanceTab from "@/app/components/recommendations/PerformanceTab";
import SubscribeTab from "@/app/components/recommendations/SubscribeTab";
import IposTab from "@/app/components/recommendations/IposTab";
import IdeasTab from "@/app/components/recommendations/IdeasTab";
import SwingTab from "@/app/components/recommendations/SwingTab";
import DividendMonthView from "@/app/components/dividends/DividendMonthView";
import DividendSummaryCards from "@/app/components/dividends/DividendSummaryCards";
import DividendListView from "@/app/components/dividends/DividendListView";
import DividendIncomeChart from "@/app/components/dividends/DividendIncomeChart";
import type {
  DividendCalendarData,
  DividendEvent,
  DividendSummary,
  MonthlyIncome,
} from "@/lib/services/dividendCalendarService";

type Tab = "picks" | "swing" | "history" | "performance" | "dividends" | "ipos" | "ideas" | "subscribe";
type DividendViewTab = "calendar" | "list" | "income";

interface Stock {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  screenerAttribution: string[];
  screenerCount: number;
  aiRecommendation: string;
  confidence: number;
  targetPrice: number;
  stopLoss: number;
  timeHorizon: string;
  reasoning: string;
  riskFactors: string[];
  // Tracker status fields
  trackerStatus?: string;
  entryPrice?: number;
  currentPrice?: number;
  createdAt?: string;
}

interface RunInfo {
  id: string;
  runDate: string;
  status: string;
  uniqueStocks: number;
  aiProcessed: number;
  executionTimeMs: number;
}

// Newest run row — when its id differs from the shown run (a newer AI-
// unavailable run with zero picks, v3.11.1), the UI shows a notice while
// still displaying the last good run's picks.
interface LatestRunInfo {
  id: string;
  runDate: string;
  status: string;
}

export default function RecommendationsPage() {
  const { data: session } = useSession();
  const isLoggedIn = !!session?.user;

  const [activeTab, setActiveTab] = useState<Tab>("picks");
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [runInfo, setRunInfo] = useState<RunInfo | null>(null);
const [latestRunInfo, setLatestRunInfo] = useState<LatestRunInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dividend state
  const now = new Date();
  const [divMonth, setDivMonth] = useState(now.getMonth() + 1);
  const [divYear, setDivYear] = useState(now.getFullYear());
  const [divActiveTab, setDivActiveTab] = useState<DividendViewTab>("calendar");
  const [calendarData, setCalendarData] = useState<DividendCalendarData | null>(null);
  const [allDividends, setAllDividends] = useState<DividendEvent[]>([]);
  const [upcomingSummary, setUpcomingSummary] = useState<DividendSummary | null>(null);
  const [incomeData, setIncomeData] = useState<MonthlyIncome[]>([]);
  const [divLoading, setDivLoading] = useState(true);
  const [divError, setDivError] = useState("");

  useEffect(() => {
    fetchRecommendations();
  }, []);

  const fetchRecommendations = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/recommendations");
      const data = await res.json();
      if (data.success) {
        setStocks(data.stocks || []);
        setRunInfo(data.run);
        setLatestRunInfo(data.latestRun || null);
      } else {
        setError("Failed to load recommendations");
      }
    } catch (e) {
      setError("Failed to load recommendations");
    } finally {
      setLoading(false);
    }
  };

  // Fetch dividend data when tab is selected
  const fetchDividendData = useCallback(async () => {
    setDivLoading(true);
    setDivError("");
    try {
      const [calRes, listRes, incRes] = await Promise.all([
        fetch(`/api/dividends/calendar?month=${divMonth}&year=${divYear}&view=calendar`),
        fetch(`/api/dividends/calendar?month=${divMonth}&year=${divYear}&view=upcoming`),
        fetch(`/api/dividends/calendar?month=${divMonth}&year=${divYear}&view=income`),
      ]);

      if (calRes.ok) setCalendarData(await calRes.json());
      else throw new Error(`Calendar API: ${calRes.status}`);
      if (listRes.ok) {
        const listData = await listRes.json();
        setAllDividends(listData.dividends || []);
        setUpcomingSummary(listData.summary || null);
      }
      if (incRes.ok) {
        const incData = await incRes.json();
        setIncomeData(incData.income || []);
      }
    } catch (err) {
      setDivError(err instanceof Error ? err.message : "Failed to load dividend data");
    } finally {
      setDivLoading(false);
    }
  }, [divMonth, divYear]);

  useEffect(() => {
    if (activeTab === "dividends") {
      fetchDividendData();
    }
  }, [activeTab, fetchDividendData]);

  const handlePrevMonth = () => {
    if (divMonth === 1) { setDivMonth(12); setDivYear(divYear - 1); }
    else { setDivMonth(divMonth - 1); }
  };

  const handleNextMonth = () => {
    if (divMonth === 12) { setDivMonth(1); setDivYear(divYear + 1); }
    else { setDivMonth(divMonth + 1); }
  };

  const handleToday = () => {
    const today = new Date();
    setDivMonth(today.getMonth() + 1);
    setDivYear(today.getFullYear());
  };

  const dividendTabs: { key: DividendViewTab; label: string }[] = [
    { key: "calendar", label: "Calendar" },
    { key: "list", label: "List" },
    { key: "income", label: "Income" },
  ];

  const tabs: { id: Tab; label: string; icon: string; authRequired?: boolean }[] = [
    { id: "picks", label: "Today's Picks", icon: "🎯" },
    { id: "swing", label: "Swing", icon: "🌊" },
    { id: "history", label: "History", icon: "📜" },
    { id: "performance", label: "Performance", icon: "📈" },
    { id: "dividends", label: "Dividends", icon: "💰" },
    { id: "ipos", label: "IPOs", icon: "🚀" },
    { id: "ideas", label: "Ideas", icon: "💡" },
    { id: "subscribe", label: "Subscribe", icon: "🔔", authRequired: true },
  ];

  // Summary stats
  const buyCount = stocks.filter(s => s.aiRecommendation === "BUY").length;
  const holdCount = stocks.filter(s => s.aiRecommendation === "HOLD").length;
  const sellCount = stocks.filter(s => s.aiRecommendation === "SELL").length;

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">📈</span>
            <h1 className="text-3xl font-bold text-white">Daily Recommendations</h1>
          </div>
          <p className="text-gray-400 text-sm">
            AI-powered stock recommendations from 7 Chartink screeners with performance tracking
          </p>
        </div>

        {/* Summary Cards — only on Today's Picks */}
        {activeTab === "picks" && !loading && stocks.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-white">{stocks.length}</div>
              <div className="text-xs text-gray-400">Total Stocks</div>
            </div>
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-emerald-400">{buyCount}</div>
              <div className="text-xs text-gray-400">Buy</div>
            </div>
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-amber-400">{holdCount}</div>
              <div className="text-xs text-gray-400">Hold</div>
            </div>
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-red-400">{sellCount}</div>
              <div className="text-xs text-gray-400">Sell</div>
            </div>
          </div>
        )}

        {/* Sidebar Navigation + Content */}
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar nav — sticky on desktop */}
          <aside className="lg:w-56 shrink-0">
            <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible rounded-xl bg-gray-900/60 border border-gray-800 p-1.5 lg:p-2 lg:sticky lg:top-24">
              <div className="hidden lg:block px-3 pt-1.5 pb-2 text-[11px] font-semibold uppercase tracking-widest text-gray-500">
                Sections
              </div>
              {tabs.map(tab => {
                // Skip subscribe tab for non-logged-in users
                if (tab.authRequired && !isLoggedIn) return null;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg transition-all whitespace-nowrap ${
                      active
                        ? "bg-blue-500/15 text-blue-300 border border-blue-500/20 shadow-sm"
                        : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/60 border border-transparent"
                    }`}
                  >
                    <span className="text-base">{tab.icon}</span>
                    <span>{tab.label}</span>
                    {active && (
                      <span className="ml-auto hidden lg:block w-1.5 h-1.5 rounded-full bg-blue-400" />
                    )}
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Content */}
          <div className="flex-1 min-w-0 min-h-[400px]">
          {activeTab === "picks" && (
            <DailyPicksTab
              stocks={stocks}
              runDate={runInfo?.runDate || null}
              loading={loading}
              aiUnavailable={
                !!latestRunInfo && !!runInfo && latestRunInfo.id !== runInfo.id
              }
              aiUnavailableDate={latestRunInfo?.runDate ?? null}
            />
          )}

          {activeTab === "swing" && (
            <SwingTab />
          )}

          {activeTab === "history" && (
            <HistoryTab loading={loading} />
          )}

          {activeTab === "performance" && (
            <PerformanceTab loading={loading} />
          )}

          {activeTab === "dividends" && (
            <div className="space-y-6">
              {/* Dividend Summary — from the upcoming view (today → next 12 months),
                  so the cards don't zero out once the viewed month's ex-dates pass. */}
              <DividendSummaryCards
                summary={upcomingSummary || calendarData?.summary || { upcomingCount: 0, estMonthlyIncome: 0, estAnnualIncome: 0, avgYield: null, totalDividends: 0 }}
                loading={divLoading}
              />

              {/* Dividend Error */}
              {divError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-sm text-red-300">
                  {divError}
                  <button onClick={fetchDividendData} className="ml-3 underline hover:no-underline">
                    Retry
                  </button>
                </div>
              )}

              {/* Dividend Sub-tabs */}
              <div className="flex gap-1 bg-gray-800/50 rounded-lg p-1 w-fit">
                {dividendTabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setDivActiveTab(tab.key)}
                    className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                      divActiveTab === tab.key
                        ? "bg-gray-700 text-white shadow-sm"
                        : "text-gray-400 hover:text-gray-300"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Dividend Views */}
              {divActiveTab === "calendar" && (
                <DividendMonthView
                  dividends={calendarData?.dividends || []}
                  month={divMonth}
                  year={divYear}
                  onPrevMonth={handlePrevMonth}
                  onNextMonth={handleNextMonth}
                  onToday={handleToday}
                />
              )}
              {divActiveTab === "list" && (
                <DividendListView dividends={allDividends} loading={divLoading} />
              )}
              {divActiveTab === "income" && (
                <DividendIncomeChart data={incomeData} loading={divLoading} />
              )}
            </div>
          )}

          {activeTab === "ipos" && (
            <IposTab loading={loading} />
          )}

          {activeTab === "ideas" && (
            <IdeasTab loading={loading} />
          )}

          {activeTab === "subscribe" && (
            <SubscribeTab isLoggedIn={isLoggedIn} />
          )}

            {/* Error state */}
            {error && (
              <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-center">
                <p className="text-sm text-red-300">{error}</p>
                <button
                  onClick={fetchRecommendations}
                  className="mt-2 px-4 py-1.5 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 rounded text-xs text-red-300 transition-colors"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
