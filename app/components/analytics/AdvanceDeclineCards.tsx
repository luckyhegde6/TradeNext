"use client";

import { useMemo } from "react";
import Link from "next/link";

type Meta = {
  fetchedAt: string;
  stale?: boolean;
};

type StockData = {
  symbol: string;
  lastPrice: number;
  pchange: number;
  change: number;
  previousClose: number;
  identifier: "Advances" | "Declines" | "Unchanged";
};

interface Props {
  data: StockData[];
  meta: Meta;
  summary: {
    Advances: number;
    Declines: number;
    Unchanged: number;
    Total: number;
  };
  page: number;
  totalPages: number;
  total: number;
  activeFilter?: string | null;
  activeSortBy?: string;
  activeSortOrder?: "asc" | "desc";
  onPageChange?: (page: number) => void;
  onFilterChange?: (filter: string | null) => void;
  onSortChange?: (sortBy: string, sortOrder: "asc" | "desc") => void;
}

function Freshness({ meta }: { meta: Meta }) {
  return (
    <div className="text-xs text-gray-500 mb-3 flex gap-2">
      <span>
        As of {new Date(meta.fetchedAt).toLocaleTimeString("en-IN")}
      </span>
      {meta.stale && (
        <span className="text-amber-500">(Updating…)</span>
      )}
    </div>
  );
}

export function AdvanceDeclineCards({
  data,
  meta,
  summary,
  page,
  totalPages,
  total,
  activeFilter,
  activeSortBy = "symbol",
  activeSortOrder = "asc",
  onPageChange,
  onFilterChange,
  onSortChange,
}: Props) {
  // Filter tile click
  const handleTileClick = (key: string) => {
    if (onFilterChange) {
      if (activeFilter === key) {
        onFilterChange(null);
      } else {
        onFilterChange(key);
      }
    }
  };

  // Sort header click
  const handleSort = (column: string) => {
    if (!onSortChange) return;
    if (activeSortBy === column) {
      onSortChange(column, activeSortOrder === "asc" ? "desc" : "asc");
    } else {
      onSortChange(column, "asc");
    }
  };

  const getSortIndicator = (column: string) => {
    if (activeSortBy !== column) return "↕";
    return activeSortOrder === "asc" ? "↑" : "↓";
  };

  const getIdentifierColor = (identifier: string) => {
    switch (identifier) {
      case "Advances":
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800";
      case "Declines":
        return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800";
      case "Unchanged":
        return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400 border-gray-200 dark:border-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <div className="space-y-6">
      {meta && <Freshness meta={meta} />}

      {/* Summary Tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(["Advances", "Declines", "Unchanged", "Total"] as const).map((key) => {
          const count = summary[key];
          const isSelected = activeFilter === key;
          const isTotal = key === "Total";
          return (
            <button
              key={key}
              onClick={() => handleTileClick(key)}
              className={`p-4 rounded-lg border-2 transition-all duration-200 ${
                isSelected
                  ? "border-blue-500 dark:border-blue-400 ring-2 ring-blue-300 dark:ring-blue-600 bg-blue-50 dark:bg-blue-900/20 scale-105"
                  : "border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 bg-white dark:bg-slate-800"
              }`}
            >
              <div className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
                {count.toLocaleString("en-IN")}
              </div>
              <div
                className={`text-sm font-medium flex items-center gap-1 ${
                  isSelected
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-gray-600 dark:text-gray-300"
                }`}
              >
                {!isTotal && (
                  <span
                    className={`w-2 h-2 rounded-full ${getIdentifierColor(key).split(" ")[0]}`}
                  />
                )}
                <span>{key}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Active filter display */}
      {activeFilter && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm">
            {activeFilter}
            <button 
              onClick={() => onFilterChange?.(null)}
              className="ml-1 hover:text-blue-900 dark:hover:text-blue-100 font-bold"
            >
              ×
            </button>
          </span>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Showing {total} stocks
          </span>
        </div>
      )}

      {/* Stocks Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between bg-gray-50 dark:bg-slate-800">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              Market Activity Details
            </h3>
            {activeFilter && (
              <p className="text-sm text-blue-600 dark:text-blue-400 mt-1">
                Filtered by {activeFilter}
              </p>
            )}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            Page {page} of {totalPages}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
            <thead className="bg-gray-50 dark:bg-slate-800">
              <tr>
                <th
                  className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700"
                  onClick={() => handleSort("symbol")}
                >
                  Symbol {getSortIndicator("symbol")}
                </th>
                <th
                  className="px-4 py-3 text-right text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700"
                  onClick={() => handleSort("lastPrice")}
                >
                  LTP (₹) {getSortIndicator("lastPrice")}
                </th>
                <th
                  className="px-4 py-3 text-right text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700"
                  onClick={() => handleSort("pchange")}
                >
                  % Change {getSortIndicator("pchange")}
                </th>
                <th
                  className="px-4 py-3 text-right text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700"
                  onClick={() => handleSort("change")}
                >
                  Change (₹) {getSortIndicator("change")}
                </th>
                <th
                  className="px-4 py-3 text-right text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700"
                  onClick={() => handleSort("previousClose")}
                >
                  Prev Close {getSortIndicator("previousClose")}
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-slate-900 divide-y divide-gray-200 dark:divide-slate-700">
              {data.map((stock) => (
                <tr key={stock.symbol} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Link
                      href={`/company/${stock.symbol}`}
                      className="font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      {stock.symbol}
                    </Link>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900 dark:text-gray-100">
                    ₹{stock.lastPrice.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  </td>
                  <td
                    className={`px-4 py-3 whitespace-nowrap text-sm text-right font-semibold ${
                      stock.pchange > 0
                        ? "text-green-600 dark:text-green-400"
                        : stock.pchange < 0
                        ? "text-red-600 dark:text-red-400"
                        : "text-gray-600 dark:text-gray-400"
                    }`}
                  >
                    {stock.pchange > 0 ? "+" : ""}
                    {stock.pchange.toFixed(2)}%
                  </td>
                  <td
                    className={`px-4 py-3 whitespace-nowrap text-sm text-right font-semibold ${
                      stock.change > 0
                        ? "text-green-600 dark:text-green-400"
                        : stock.change < 0
                        ? "text-red-600 dark:text-red-400"
                        : "text-gray-600 dark:text-gray-400"
                    }`}
                  >
                    {stock.change > 0 ? "+" : ""}
                    ₹{stock.change.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-600 dark:text-gray-300">
                    ₹{stock.previousClose.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-200 dark:border-slate-700 flex items-center justify-between">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Showing {((page - 1) * 50) + 1}-{Math.min(page * 50, total)} of {total} stocks
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => onPageChange?.(page - 1)}
                disabled={page <= 1}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => onPageChange?.(page + 1)}
                disabled={page >= totalPages}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
