"use client";

import useSWR from "swr";
import { useState, useMemo } from "react";
import Link from "next/link";

import { TableSkeleton } from "@/app/components/TableSkeleton";
import { GainersTable } from "@/app/components/analytics/GainersTable";
import { LosersTable } from "@/app/components/analytics/LosersTable";
import { BulkDealsTable } from "@/app/components/analytics/BulkDealsTable";
import { MostActiveTable } from "@/app/components/analytics/MostActiveTable";
import { AdvanceDeclineCards } from "@/app/components/analytics/AdvanceDeclineCards";
import { CorporateInfoTable } from "@/app/components/analytics/CorporateInfoTable";
import { CorporateActionsTable } from "@/app/components/analytics/CorporateActionsTable";
import { CorporateNewsTable } from "@/app/components/analytics/CorporateNewsTable";
import { CorporateEventsTable } from "@/app/components/analytics/CorporateEventsTable";
import { InsiderTradingTable } from "@/app/components/analytics/InsiderTradingTable";

const fetcher = (url: string) => fetch(url).then(res => res.json());

const TABS = [
  { key: "advance", label: "Advances / Declines", api: "/api/nse/advance-decline" },
  { key: "corporate-info", label: "Corporate Info", api: "/api/nse/corporate-info" },
  { key: "corporate-announcements", label: "Corporate Announcements", api: "/api/nse/corporate-announcements" },
  { key: "corporate-events", label: "Corp Events", api: "/api/nse/corporate-events" },
  { key: "corporate-actions", label: "Dividends / Splits / Bonus", api: "/api/corporate-actions/combined" },
  { key: "insider-trading", label: "Insider Trading", api: "/api/nse/insider-trading" },
  { key: "results-comparison", label: "Financial Results", api: null }, // Custom tab - no default API
  { key: "block_deals", label: "Block Deals", api: "/api/nse/deals?dealType=block_deal", dealType: "block_deal", defaultSource: "nse" },
  { key: "bulk_deals", label: "Bulk Deals", api: "/api/nse/deals?dealType=bulk_deal", dealType: "bulk_deal", defaultSource: "nse" },
  { key: "short_selling", label: "Short Selling", api: "/api/nse/deals?dealType=short_selling", dealType: "short_selling", defaultSource: "nse" },
  { key: "deals", label: "Bulk / Large Deals (NSE)", api: "/api/nse/deals", defaultSource: "nse" },
  { key: "active", label: "Most Active", api: "/api/nse/most-active" },
  { key: "gainers", label: "Top Gainers", api: "/api/nse/gainers" },
  { key: "losers", label: "Top Losers", api: "/api/nse/losers" },
];

export default function MarketAnalyticsTabs() {
  const [active, setActive] = useState(TABS[0]);
  
  // Advance-decline specific state
  const [advanceParams, setAdvanceParams] = useState<{
    page?: number;
    limit?: number;
    filter?: string;
    sortBy?: string;
    sortOrder?: string;
  }>({});

  // Build API URL for advance-decline with query params
  const advanceApiUrl = useMemo(() => {
    if (active.key !== "advance") return active.api;
    const params = new URLSearchParams();
    if (advanceParams.page) params.set("page", advanceParams.page.toString());
    if (advanceParams.limit) params.set("limit", advanceParams.limit.toString());
    if (advanceParams.filter) params.set("filter", advanceParams.filter);
    if (advanceParams.sortBy) params.set("sortBy", advanceParams.sortBy);
    if (advanceParams.sortOrder) params.set("sortOrder", advanceParams.sortOrder);
    const query = params.toString();
    return `${active.api}${query ? `?${query}` : ""}`;
  }, [active, advanceParams]);

  const { data, error, isLoading } = useSWR(active.key === "advance" ? advanceApiUrl : active.api, fetcher, {
    refreshInterval: 20000,
  });

  // Handler for page changes from AdvanceDeclineCards
  const handleAdvancePageChange = (newPage: number) => {
    setAdvanceParams((prev) => ({ ...prev, page: newPage }));
  };

  // Handler for filter changes from AdvanceDeclineCards
  const handleAdvanceFilterChange = (filter: string | null) => {
    setAdvanceParams((prev) => ({ 
      ...prev, 
      filter: filter || undefined, 
      page: 1 // Reset to page 1 on filter change
    }));
  };

  // Handler for sort changes from AdvanceDeclineCards
  const handleAdvanceSortChange = (sortBy: string, sortOrder: string) => {
    setAdvanceParams((prev) => ({ 
      ...prev, 
      sortBy, 
      sortOrder,
      page: 1 // Reset to page 1 on sort change
    }));
  };

  return (
    <div className="space-y-4">
      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-gray-200 dark:border-slate-700 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActive(tab)}
            className={`px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${active.key === tab.key
              ? "border-b-2 border-blue-500 text-blue-600 dark:text-blue-400"
              : "text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {isLoading && <TableSkeleton />}
      {error && <p className="text-red-500">Failed to load data</p>}
      {!isLoading && !error && (

        <>
          {/* Handle advance-decline data structure */}
          {active.key === "advance" && (() => {
            if (!data || !data.data) {
              return <p className="text-gray-500">No advance/decline data available</p>;
            }

            const meta = data.meta || { fetchedAt: data.timestamp || new Date().toISOString() };
            const summary = data.summary || {
              Advances: 0,
              Declines: 0,
              Unchanged: 0,
              Total: 0,
            };

            return (
              <AdvanceDeclineCards
                data={data.data}
                meta={meta}
                summary={summary}
                page={data.page}
                totalPages={data.totalPages}
                total={data.total}
                onPageChange={handleAdvancePageChange}
                onFilterChange={handleAdvanceFilterChange}
                onSortChange={handleAdvanceSortChange}
              />
            );
          })()}

          {/* Handle corporate info data structure */}
          {active.key === "corporate-info" && (() => {
            const rawItems = Array.isArray(data) ? data : (data?.data || []);
            if (!data || rawItems.length === 0) {
              return <p className="text-gray-500">No corporate info data available</p>;
            }

            const meta = { fetchedAt: new Date().toISOString() };

            // Transform corporate announcement data to match CorporateInfoTable expectations
            // Use attchmntText (full text) if available, otherwise use desc (short description)
            const transformedData = rawItems.map((item: any) => ({
              symbol: item.symbol || "",
              sm_name: item.companyName || "",
              desc: `Issue: ${item.startDate} to ${item.endDate} | Price: ${item.priceRange} | Status: ${item.status}`,
              an_dt: item.startDate || "",
            }));

            return (
              <CorporateInfoTable
                data={transformedData}
                meta={meta}
              />
            );
          })()}

          {/* Handle corporate announcements */}
          {active.key === "corporate-announcements" && (() => {
            const rawItems = Array.isArray(data) ? data : (data?.data || []);
            if (!data || rawItems.length === 0) {
              return <p className="text-gray-500">No corporate announcements available</p>;
            }

            return (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                  <thead className="bg-gray-50 dark:bg-slate-800">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Symbol</th>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Company</th>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Subject</th>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Details</th>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Attachment</th>
                      <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">XBRL</th>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Broadcast</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-slate-900 divide-y divide-gray-200 dark:divide-slate-700">
                    {rawItems.map((ann: any, i: number) => (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <Link
                            href={`/company/${ann.symbol}`}
                            className="text-blue-600 dark:text-blue-400 hover:underline font-medium text-sm"
                          >
                            {ann.symbol}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 max-w-[150px] truncate">
                          {ann.companyName}
                        </td>
                        <td className="px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 max-w-[180px] truncate">
                          {ann.desc || "-"}
                        </td>
                        <td className="px-3 py-2.5 text-sm text-gray-600 dark:text-gray-400 max-w-[250px] truncate">
                          {ann.attchmntText || "-"}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {ann.attchmntFile ? (
                            <a
                              href={ann.attchmntFile}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                              </svg>
                              PDF
                              {ann.attFileSize && <span className="text-gray-400">({ann.attFileSize})</span>}
                            </a>
                          ) : (
                            <span className="text-gray-400 text-xs">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {ann.hasXbrl ? (
                            <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
                              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              Yes
                            </span>
                          ) : (
                            <span className="text-gray-400 text-xs">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {ann.an_dt || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}

          {/* Handle corporate actions - Dividends, Splits, Bonus */}
          {active.key === "corporate-actions" && (() => {
            const actionsData = Array.isArray(data) ? data : (data?.data || []);
            if (!data || actionsData.length === 0) {
              return <p className="text-gray-500">No corporate actions available</p>;
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);

             const transformedActions = actionsData.map((item: any) => ({
               symbol: item.symbol || "",
               companyName: item.companyName || "",
               series: item.series || "",
               subject: item.subject || "",
               exDate: item.exDate || "",
               recDate: item.recordDate || "",
               faceValue: item.faceValue || "",
               type: item.actionType || "",
               dividendPerShare: item.dividendPerShare ?? null,
               dividendYield: item.dividendYield ?? null,
               currentPrice: item.currentPrice ?? null,
               isUpcoming: item.exDate ? new Date(item.exDate) >= today : false,
             }));

            return <CorporateActionsTable data={transformedActions} />;
          })()}

          {/* Handle insider trading */}
          {active.key === "insider-trading" && (() => {
            const insiderData = Array.isArray(data) ? data : (data?.data || []);
            if (!data || insiderData.length === 0) {
              return <p className="text-gray-500">No insider trading data available</p>;
            }

            const transformedInsider = insiderData.map((item: any) => ({
              symbol: item.symbol || "",
              companyName: item.companyName || "",
              acqName: item.acqName || "",
              transactionType: item.transactionType || "",
              securities: Number(item.securities || 0),
              price: item.price ? Number(item.price) : null,
              value: item.value ? Number(item.value) : null,
              secAcqPromoter: item.secAcqPromoter || "",
              secType: item.secType || "",
              afterSec: item.afterSec ? Number(item.afterSec) : null,
              mode: item.mode || "",
              remarks: item.remarks || "",
              broadcastDate: item.broadcastDate || "",
              currentPrice: item.currentPrice ? Number(item.currentPrice) : null,
            }));

            return <InsiderTradingTable data={transformedInsider} />
          })()}

          {/* Handle Financial Results Comparison */}
          {active.key === "results-comparison" && (
            <FinancialResultsComparison />
          )}

          {/* Handle corporate events */}
          {active.key === "corporate-events" && (() => {
            const eventsData = Array.isArray(data) ? data : (data?.data || []);
            if (!data || eventsData.length === 0) {
              return <p className="text-gray-500">No corporate events available</p>;
            }

            const transformedEvents = eventsData.map((item: any) => ({
              symbol: item.symbol || item.SYMBOL || "",
              companyName: item.company || item.COMPANY || "",
              purpose: item.purpose || item.PURPOSE || "",
              details: item.bm_desc || item.details || item.DETAILS || "",
              date: item.date || item.DATE || "",
            }));

            return <CorporateEventsTable data={transformedEvents} />;
          })()}

          {/* Handle deals - normalized data structure */}
          {active.key === "deals" && (() => {
            if (!data || !data.data || !Array.isArray(data.data)) {
              return <p className="text-gray-500">No deals data available</p>;
            }

            // Data from NSE includes dealType; preserve it for stats
            const transformedDeals = data.data.map((item: any) => ({
              symbol: item.symbol || "",
              clientName: item.clientName || "",
              quantity: Number(item.quantity || 0),
              price: Number(item.price || 0),
              buySell: item.buySell || "",
              dealType: item.dealType,
            }));

            const meta = data.meta || { fetchedAt: new Date().toISOString() };

            return (
              <BulkDealsTable data={transformedDeals} meta={meta} />
            );
          })()}

          {/* Handle Block Deals - from NSE API with database fallback */}
          {(active.key === "block_deals" || active.key === "bulk_deals" || active.key === "short_selling") && (() => {
            const dealType = (active as any).dealType || active.key;
            
            // For these specific tabs, we fetch from NSE API and pass as NSE data
            // The BulkDealsTable will show NSE data by default and allow switching to DB
            const nseData = Array.isArray(data) ? data : (data?.data || []);
            
            return (
              <BulkDealsTable 
                data={nseData}
                meta={data?.meta || { fetchedAt: new Date().toISOString() }}
                dealType={dealType}
              />
            );
          })()}

          {/* Handle gainers */}
          {active.key === "gainers" && (() => {
            if (!data || !data.data) {
              return <p className="text-gray-500">No data available</p>;
            }

            const meta = data.meta || (data.stale !== undefined ? {
              fetchedAt: new Date().toISOString(),
              stale: data.stale
            } : undefined);

            return (
              <GainersTable
                data={Array.isArray(data.data) ? data.data : []}
                meta={meta}
              />
            );
          })()}

          {/* Handle losers */}
          {active.key === "losers" && (() => {
            if (!data || !data.data) {
              return <p className="text-gray-500">No data available</p>;
            }

            const meta = data.meta || (data.stale !== undefined ? {
              fetchedAt: new Date().toISOString(),
              stale: data.stale
            } : undefined);

            return (
              <LosersTable
                data={Array.isArray(data.data) ? data.data : []}
                meta={meta}
              />
            );
          })()}

          {/* Handle most active */}
          {active.key === "active" && (() => {
            if (!data || !data.data || !Array.isArray(data.data)) {
              return <p className="text-gray-500">No data available</p>;
            }

            const meta = data.meta || {
              fetchedAt: data.timestamp || new Date().toISOString()
            };

            return (
              <MostActiveTable
                data={data.data}
                meta={meta}
              />
            );
          })()}
        </>
      )}
    </div>
  );
}

// Financial Results Comparison Component
function FinancialResultsComparison() {
  const [searchInput, setSearchInput] = useState("");
  const [suggestions, setSuggestions] = useState<{ symbol: string; name: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [resultsData, setResultsData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch stock suggestions
  const fetchSuggestions = async (query: string) => {
    if (query.length < 1) {
      setSuggestions([]);
      return;
    }
    try {
      const res = await fetch(`/api/symbols/search?q=${encodeURIComponent(query)}&limit=10`);
      const data = await res.json();
      setSuggestions(data.symbols || []);
    } catch {
      setSuggestions([]);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchInput(value);
    fetchSuggestions(value);
    setShowSuggestions(true);
  };

  const handleSelectSuggestion = (symbol: string) => {
    setSearchInput(symbol);
    setShowSuggestions(false);
    handleSearch(symbol);
  };

  const handleSearch = async (symbol?: string) => {
    const searchSymbol = symbol || searchInput.trim().toUpperCase();
    if (!searchSymbol) return;

    setLoading(true);
    setError(null);
    setResultsData(null);

    try {
      const response = await fetch(`/api/admin/nse/results-comparison?symbol=${encodeURIComponent(searchSymbol)}`);
      const data = await response.json();
      
      if (data.error) {
        setError(data.error);
      } else {
        setResultsData(data);
      }
    } catch (err) {
      setError("Failed to fetch financial results");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowSuggestions(false);
    handleSearch();
  };

  // Format numbers in Lakhs (NSE format)
  const formatLakhs = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "-";
    return `₹${(value / 100000).toFixed(2)} Lakhs`;
  };

  // Format numbers in Crores
  const formatCrore = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "-";
    return `₹${(value / 10000000).toFixed(2)} Cr`;
  };

  // Format EPS
  const formatEps = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "-";
    return `₹${value.toFixed(2)}`;
  };

  // Format percentage
  const formatPercent = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "-";
    return `${value.toFixed(2)}%`;
  };

  // Get period label from API data
  const getPeriodLabel = (period: string) => {
    if (!period) return "-";
    // If it's a date range, extract just the end date or format it
    return period;
  };

  // Transpose data: quarters as columns, metrics as rows
  const getTransposedData = (data: any[]) => {
    if (!data || !Array.isArray(data) || data.length === 0) return null;
    
    const metrics = [
      { key: 'revenue', label: 'Revenue from Operations', format: formatLakhs, highlight: true },
      { key: 'otherIncome', label: 'Other Income', format: formatLakhs },
      { key: 'totalIncome', label: 'Total Income', format: formatLakhs, bold: true },
      { key: 'totalExpenses', label: 'Total Expenses', format: formatLakhs },
      { key: 'profitBeforeTax', label: 'Profit Before Tax (PBT)', format: formatLakhs, bold: true, highlight: true },
      { key: 'tax', label: 'Tax Expenses', format: formatLakhs },
      { key: 'profit', label: 'Net Profit', format: formatLakhs, bold: true, highlight: true, isProfit: true },
      { key: 'basicEps', label: 'Basic EPS (₹)', format: formatEps, bold: true },
      { key: 'dilutedEps', label: 'Diluted EPS (₹)', format: formatEps },
      { key: 'depreciation', label: 'Depreciation & Amortisation', format: formatLakhs },
      { key: 'interest', label: 'Finance Costs', format: formatLakhs },
    ];

    return { metrics, quarters: data };
  };

  const transposedData = resultsData?.data ? getTransposedData(resultsData.data) : null;

  return (
    <div className="space-y-4">
      {/* Search Form with Autocomplete */}
      <div className="relative">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={searchInput}
              onChange={handleInputChange}
              onFocus={() => searchInput && setShowSuggestions(true)}
              placeholder="Enter stock symbol (e.g., ITC, RELIANCE, TCS)"
              className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoComplete="off"
            />
            {/* Autocomplete Suggestions */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {suggestions.map((s) => (
                  <button
                    key={s.symbol}
                    type="button"
                    onClick={() => handleSelectSuggestion(s.symbol)}
                    className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-slate-700 flex justify-between items-center"
                  >
                    <span className="font-medium text-blue-600 dark:text-blue-400">{s.symbol}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 truncate ml-2">{s.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={loading || !searchInput.trim()}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium rounded-lg transition-colors"
          >
            {loading ? "Loading..." : "Search"}
          </button>
        </form>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      )}

      {/* Results Data */}
      {resultsData && !loading && (
        <div className="space-y-4">
          {/* Company Info */}
          {resultsData.symbol && (
            <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <h3 className="text-xl font-bold text-blue-900 dark:text-blue-300">
                {resultsData.symbol}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">{resultsData.companyName}</p>
            </div>
          )}

          {/* Financial Data Table - NSE Format: Quarters as columns, Metrics as rows */}
          {transposedData ? (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gradient-to-r from-slate-800 to-slate-900 dark:from-slate-900 dark:to-slate-800">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-bold text-white uppercase tracking-wider sticky left-0 bg-slate-800 dark:bg-slate-900 z-10">
                      Parameter (₹ in Lakhs)
                    </th>
                    {transposedData.quarters.slice(0, 5).map((quarter: any, idx: number) => (
                      <th key={idx} className="px-3 py-3 text-center text-xs font-bold text-white uppercase tracking-wider min-w-[120px]">
                        <div>{quarter.periodType === 'Annual' ? 'FY' : 'Q'}{quarter.period?.match(/\d{2}$/)?.[0] || idx + 1}</div>
                        <div className="text-[10px] font-normal opacity-75">{quarter.periodType}</div>
                        <div className="text-[9px] font-normal opacity-60">{quarter.resultType}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-slate-900 divide-y divide-gray-200 dark:divide-gray-700">
                  {transposedData.metrics.map((metric: any, rowIdx: number) => (
                    <tr key={metric.key} className={`hover:bg-gray-50 dark:hover:bg-slate-800/50 ${metric.bold ? 'bg-slate-50 dark:bg-slate-800/30' : ''}`}>
                      <td className={`px-3 py-2.5 text-sm font-medium sticky left-0 z-10 ${metric.bold ? 'text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'} ${metric.highlight ? 'bg-white dark:bg-slate-900' : ''}`}>
                        {metric.label}
                      </td>
                      {transposedData.quarters.slice(0, 5).map((quarter: any, colIdx: number) => {
                        const value = quarter[metric.key];
                        const formatted = metric.format(value);
                        const isNegative = metric.isProfit && value !== null && value !== undefined && value < 0;
                        
                        return (
                          <td key={colIdx} className={`px-3 py-2.5 text-sm text-center font-mono ${metric.bold ? 'font-semibold' : ''} ${metric.highlight ? (isNegative ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400') : 'text-gray-700 dark:text-gray-300'}`}>
                            {formatted}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              
              {/* Note about data source */}
              <div className="p-3 bg-gray-50 dark:bg-slate-800 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
                * All values are in ₹ Lakhs as per NSE financial results data
              </div>
            </div>
          ) : (
            <p className="text-gray-500 text-center py-4">No financial data available for this symbol</p>
          )}
        </div>
      )}

      {/* Initial State */}
      {!resultsData && !loading && !error && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-lg">Enter a stock symbol to view financial results comparison</p>
          <p className="text-sm mt-2">Example: ITC, RELIANCE, TCS, HINDUNILVR, HDFCBANK</p>
        </div>
      )}
    </div>
  );
}
