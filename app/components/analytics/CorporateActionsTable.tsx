"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { formatDateWithDay, getUrgencyClass, getDaysRemaining } from "@/lib/utils/date-utils";

interface CorporateAction {
  symbol: string;
  companyName: string;
  series: string;
  subject: string;
  exDate: string;
  recDate: string;
  faceValue: string;
  type: string;
  dividendPerShare?: number | null;
  dividendYield?: number | null;
  isUpcoming?: boolean;
  currentPrice?: number | null;
}

interface Props {
  data: CorporateAction[];
  pageSize?: number;
}

// Helper to format date with day of week and urgency label
function formatExDate(dateStr: string): { text: string; highlight: boolean; label: string } {
  if (!dateStr) return { text: "-", highlight: false, label: "" };
  
  const days = getDaysRemaining(dateStr);
  if (days === Infinity) return { text: dateStr, highlight: false, label: "" };
  
  let label = "";
  if (days >= 0 && days <= 2) {
    label = "Very Soon!";
  } else if (days > 2 && days <= 7) {
    label = "This Week";
  } else if (days > 7 && days <= 30) {
    label = "This Month";
  }
  
  const highlight = days >= 0 && days <= 7;
  
  return { 
    text: formatDateWithDay(dateStr), 
    highlight, 
    label 
  };
}

// Get type icon
function getTypeIcon(type: string): string {
  switch (type) {
    case "Dividend":
      return "💰";
    case "Split":
      return "✂️";
    case "Bonus":
      return "🎁";
    case "Rights":
      return "📈";
    case "Buyback":
      return "🔄";
    default:
      return "📌";
  }
}

export function CorporateActionsTable({ data, pageSize = 10 }: Props) {
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);

  // Filter by type and search term
  const filteredData = useMemo(() => {
    let result = data;
    
    // Apply type filter
    if (selectedType) {
      result = result.filter(action => action.type === selectedType);
    }
    
    // Apply search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      result = result.filter(action => 
        action.symbol.toLowerCase().includes(term) ||
        action.companyName.toLowerCase().includes(term)
      );
    }
    
    return result;
  }, [data, selectedType, searchTerm]);

  // Pagination
  const totalPages = Math.ceil(filteredData.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedData = filteredData.slice(startIndex, startIndex + pageSize);

  // Reset to page 1 when filter changes
  useMemo(() => {
    setCurrentPage(1);
  }, [selectedType]);

  const { upcoming, older } = useMemo(() => {
    const upcomingList: CorporateAction[] = [];
    const olderList: CorporateAction[] = [];
    
    paginatedData.forEach((action) => {
      if (action.isUpcoming) {
        upcomingList.push(action);
      } else {
        olderList.push(action);
      }
    });
    
    return { upcoming: upcomingList, older: olderList };
  }, [paginatedData]);

  // Compute type counts for summary (from original data, not filtered)
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    data.forEach(action => {
      const t = action.type;
      counts[t] = (counts[t] || 0) + 1;
    });
    return counts;
  }, [data]);

  const total = filteredData.length;

  const getTypeColor = (type: string) => {
    switch (type) {
      case "Dividend":
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800";
      case "Split":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800";
      case "Bonus":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-800";
      case "Rights":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 border-orange-200 dark:border-orange-800";
      case "Buyback":
        return "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400 border-teal-200 dark:border-teal-800";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400 border-gray-200 dark:border-gray-800";
    }
  };

  const formatExDate = (dateStr: string): { text: string; highlight: boolean; label: string } => {
    if (!dateStr) return { text: "-", highlight: false, label: "" };
    
    const days = getDaysRemaining(dateStr);
    if (days === Infinity) {
      return { text: dateStr, highlight: false, label: "" };
    }
    
    let label = "";
    if (days >= 0 && days <= 2) {
      label = "Very Soon!";
    } else if (days > 2 && days <= 7) {
      label = "This Week";
    } else if (days > 7 && days <= 30) {
      label = "This Month";
    }
    
    const highlight = days >= 0 && days <= 7;
    
    return { 
      text: formatDateWithDay(dateStr), 
      highlight, 
      label 
    };
  };

  const renderRow = (action: CorporateAction, isHighlighted = false, index: number = 0) => {
    const exDateInfo = formatExDate(action.exDate);
    const urgencyClass = isHighlighted ? getUrgencyClass(action.exDate) : "";
    
    return (
      <tr 
        key={`${action.symbol}-${action.exDate}-${index}`} 
        className={`hover:bg-gray-50 dark:hover:bg-slate-800/50 ${isHighlighted ? urgencyClass : ""}`}
      >
        {/* Symbol */}
        <td className="px-4 py-3 whitespace-nowrap">
          <Link
            href={`/company/${action.symbol}`}
            className="font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            {action.symbol}
          </Link>
        </td>
        
        {/* Company */}
        <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 max-w-xs truncate font-medium">
          {action.companyName}
        </td>
        
        {/* Type with icon */}
        <td className="px-4 py-3 whitespace-nowrap">
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full border ${getTypeColor(action.type)}`}>
            <span>{getTypeIcon(action.type)}</span>
            <span>{action.type}</span>
          </span>
        </td>
        
        {/* Dividend (₹) */}
        <td className="px-4 py-3 whitespace-nowrap text-sm">
          {action.type === "DIVIDEND" && action.dividendPerShare !== null && action.dividendPerShare !== undefined ? (
            <span className="font-semibold text-green-700 dark:text-green-400">
              ₹{action.dividendPerShare.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            </span>
          ) : (
            <span className="text-gray-400">-</span>
          )}
        </td>
        
        {/* Yield */}
        <td className="px-4 py-3 whitespace-nowrap text-sm">
          {action.type === "DIVIDEND" && action.dividendYield !== null && action.dividendYield !== undefined ? (
            <span className="font-semibold text-green-600 dark:text-green-400">
              {action.dividendYield.toFixed(2)}%
            </span>
          ) : (
            <span className="text-gray-400">-</span>
          )}
        </td>
        
        {/* Subject */}
        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 max-w-md truncate">
          {action.subject}
        </td>
        
        {/* Ex Date with enhanced formatting */}
        <td className="px-4 py-3 whitespace-nowrap">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${exDateInfo.highlight ? "text-red-600 dark:text-red-400" : "text-gray-700 dark:text-gray-300"}`}>
              {exDateInfo.text}
            </span>
            {exDateInfo.label && (
              <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${
                exDateInfo.label === "Very Soon!" 
                  ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 animate-pulse"
                  : exDateInfo.label === "This Week"
                  ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                  : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
              }`}>
                {exDateInfo.label}
              </span>
            )}
          </div>
        </td>
        
        {/* Record Date */}
        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
          {action.recDate ? formatDateWithDay(action.recDate) : "-"}
        </td>
        
        {/* Face Value */}
        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300 font-mono">
          ₹{action.faceValue}
        </td>
        
        {/* Current Price with trend indicator */}
        <td className="px-4 py-3 whitespace-nowrap text-sm text-right">
          {action.currentPrice ? (
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              ₹{action.currentPrice.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            </span>
          ) : (
            <span className="text-gray-400">-</span>
          )}
        </td>
      </tr>
    );
  };

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <div className="text-4xl mb-4">📭</div>
        <p>No corporate actions available</p>
      </div>
    );
  }

  // Summary statistics component - now clickable to filter
  const SummaryStats = () => (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
      {Object.entries(typeCounts)
        .sort((a, b) => b[1] - a[1]) // sort by count descending
        .map(([type, count]) => (
          <button
            key={type}
            onClick={() => setSelectedType(selectedType === type ? null : type)}
            className={`p-4 rounded-lg border-2 transition-all duration-200 ${
              selectedType === type
                ? "border-blue-500 dark:border-blue-400 ring-2 ring-blue-300 dark:ring-blue-600 bg-blue-50 dark:bg-blue-900/20 scale-105"
                : "border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 bg-white dark:bg-gray-800"
            }`}
          >
            <div className="text-3xl font-bold text-gray-900 dark:text-white mb-1">{count}</div>
            <div className="text-sm font-medium text-gray-600 dark:text-gray-300 flex items-center gap-1">
              <span>{getTypeIcon(type)}</span>
              <span>{type}</span>
            </div>
          </button>
        ))}
      <div className="p-4 rounded-lg border-2 border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <div className="text-3xl font-bold text-gray-700 dark:text-gray-300 mb-1">
          {selectedType ? filteredData.length : total}
        </div>
        <div className="text-sm font-medium text-gray-600 dark:text-gray-400">
          {selectedType ? "Filtered" : "Total"}
        </div>
      </div>
    </div>
  );

  // Pagination controls
  const PaginationControls = () => {
    if (totalPages <= 1) return null;

    const getPageNumbers = () => {
      const pages: (number | string)[] = [];
      const showPages = 5; // Maximum page numbers to show
      
      if (totalPages <= showPages + 2) {
        // Show all pages if total is small
        for (let i = 1; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        // Always show first page
        pages.push(1);
        
        // Calculate start and end of visible range
        let start = Math.max(2, currentPage - 1);
        let end = Math.min(totalPages - 1, currentPage + 1);
        
        // Adjust if we're near the edges
        if (currentPage <= 2) {
          end = Math.min(totalPages - 1, 3);
        } else if (currentPage >= totalPages - 1) {
          start = Math.max(2, totalPages - 2);
        }
        
        // Add ellipsis before if needed
        if (start > 2) {
          pages.push('...');
        }
        
        // Add middle pages
        for (let i = start; i <= end; i++) {
          pages.push(i);
        }
        
        // Add ellipsis after if needed
        if (end < totalPages - 1) {
          pages.push('...');
        }
        
        // Always show last page
        pages.push(totalPages);
      }
      
      return pages;
    };

    return (
      <div className="flex items-center justify-center gap-2 mt-6">
        <button
          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
          disabled={currentPage === 1}
          className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          ← Previous
        </button>

        {getPageNumbers().map((page, idx) => (
          <React.Fragment key={idx}>
            {page === '...' ? (
              <span className="px-3 py-2 text-gray-400">...</span>
            ) : (
              <button
                onClick={() => setCurrentPage(page as number)}
                className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  currentPage === page
                    ? "bg-blue-600 text-white"
                    : "text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700"
                }`}
              >
                {page}
              </button>
            )}
          </React.Fragment>
        ))}

        <button
          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
          disabled={currentPage === totalPages}
          className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Next →
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <SummaryStats />

      {/* Search and Filter Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Search by symbol or company name..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1); // Reset to page 1 on search
              }}
              className="block w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
              >
                <svg className="h-5 w-5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Active Filters */}
          <div className="flex items-center gap-2">
            {selectedType && (
              <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm">
                {selectedType}
                <button onClick={() => setSelectedType(null)} className="ml-1 hover:text-blue-900 dark:hover:text-blue-100 font-bold">×</button>
              </span>
            )}
            {(searchTerm || selectedType) && (
              <button
                onClick={() => {
                  setSearchTerm("");
                  setSelectedType(null);
                }}
                className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 underline"
              >
                Clear all filters
              </button>
            )}
          </div>
        </div>
        
        {/* Results count */}
        <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          {searchTerm && (
            <span>
              Searching for "<strong>{searchTerm}</strong>": {filteredData.length} results
            </span>
          )}
          {!searchTerm && selectedType && (
            <span>
              Showing {filteredData.length} {selectedType} actions
            </span>
          )}
          {!searchTerm && !selectedType && (
            <span>
              Showing all {filteredData.length} records
            </span>
          )}
        </div>
      </div>

      {/* Upcoming Actions */}
      {upcoming.length > 0 && (
        <div className="bg-gradient-to-br from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20 border-2 border-yellow-200 dark:border-yellow-700 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-yellow-900 dark:text-yellow-200 flex items-center gap-2">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
              </svg>
              Upcoming Actions ({upcoming.length})
            </h3>
            <span className="text-sm font-medium text-yellow-700 dark:text-yellow-300 bg-yellow-100 dark:bg-yellow-900/40 px-3 py-1 rounded-full">
              Next 7 days
            </span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-yellow-200 dark:border-yellow-700">
            <table className="min-w-full divide-y divide-yellow-200 dark:divide-yellow-700">
              <thead className="bg-yellow-100 dark:bg-yellow-900/30">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-bold text-yellow-800 dark:text-yellow-200 uppercase tracking-wider">Symbol</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-yellow-800 dark:text-yellow-200 uppercase tracking-wider">Company</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-yellow-800 dark:text-yellow-200 uppercase tracking-wider">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-yellow-800 dark:text-yellow-200 uppercase tracking-wider">Dividend (₹)</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-yellow-800 dark:text-yellow-200 uppercase tracking-wider">Yield</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-yellow-800 dark:text-yellow-200 uppercase tracking-wider">Ex Date</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-yellow-800 dark:text-yellow-200 uppercase tracking-wider">Record Date</th>
                </tr>
              </thead>
               <tbody className="divide-y divide-yellow-200 dark:divide-yellow-700 bg-white dark:bg-slate-900">
                 {(showAllUpcoming ? upcoming : upcoming.slice(0, 5)).map((action, idx) => (
                   <tr key={`${action.symbol}-${action.exDate}-${idx}`} className="hover:bg-yellow-25 dark:hover:bg-yellow-900/5 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link href={`/company/${action.symbol}`} className="font-semibold text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
                        {action.symbol}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 max-w-xs truncate font-medium">{action.companyName}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-full border ${getTypeColor(action.type)}`}>
                        {getTypeIcon(action.type)}
                        {action.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      {action.type === "DIVIDEND" && action.dividendPerShare !== null && action.dividendPerShare !== undefined ? (
                        <span className="font-semibold text-green-600 dark:text-green-400 text-base">
                          ₹{action.dividendPerShare.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      {action.type === "DIVIDEND" && action.dividendYield !== null && action.dividendYield !== undefined ? (
                        <span className="font-semibold text-green-600 dark:text-green-400">
                          {action.dividendYield.toFixed(2)}%
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-red-600 dark:text-red-400">
                      {formatDateWithDay(action.exDate)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
                      {action.recDate ? formatDateWithDay(action.recDate) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
           </div>
           {upcoming.length > 5 && (
             <div className="mt-3 text-center">
               <button 
                 onClick={() => setShowAllUpcoming(!showAllUpcoming)}
                 className="text-sm font-medium text-yellow-700 dark:text-yellow-300 hover:underline focus:outline-none focus:ring-2 focus:ring-yellow-500 rounded"
               >
                 {showAllUpcoming 
                   ? `▲ Show less (${upcoming.length - 5} hidden)`
                   : `▼ View all ${upcoming.length} upcoming actions`
                 }
               </button>
             </div>
           )}
        </div>
      )}

      {/* All Actions Table */}
      <div id="all-actions-table" className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between bg-gray-50 dark:bg-slate-800">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              {selectedType ? `${selectedType} Actions` : 'Historical & Current Actions'}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Showing {startIndex + 1}-{Math.min(startIndex + pageSize, filteredData.length)} of {filteredData.length} records
              {upcoming.length > 0 && ` • ${upcoming.length} upcoming actions shown above`}
            </p>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
            <thead className="bg-gray-50 dark:bg-slate-800">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Symbol</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Company</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Dividend (₹)</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Yield</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Subject</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Ex Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Record Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Face Value</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Price (₹)</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-slate-900 divide-y divide-gray-200 dark:divide-slate-700">
              {older.length === 0 && upcoming.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-gray-500">
                    No corporate actions match your filter
                  </td>
                </tr>
              ) : (
                older.map((action, idx) => renderRow(action, false, idx))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <PaginationControls />
    </div>
  );
}
