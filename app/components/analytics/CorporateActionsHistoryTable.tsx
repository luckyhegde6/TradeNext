"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface CorporateAction {
  id: number;
  symbol: string;
  companyName: string;
  series: string | null;
  subject: string;
  actionType: string;
  exDate: Date | null;
  recordDate: Date | null;
  effectiveDate: Date | null;
  faceValue: string | null;
  oldFV: string | null;
  newFV: string | null;
  ratio: string | null;
  dividendPerShare: number | null;
  dividendYield: number | null;
  isin: string | null;
}

interface Props {
  initialSymbol?: string;
  showSearch?: boolean;
}

const ACTION_TYPES = [
  { value: "all", label: "All Types" },
  { value: "DIVIDEND", label: "Dividend" },
  { value: "SPLIT", label: "Split" },
  { value: "BONUS", label: "Bonus" },
  { value: "RIGHTS", label: "Rights" },
  { value: "BUYBACK", label: "Buyback" },
];

export function CorporateActionsHistoryTable({ initialSymbol, showSearch = true }: Props) {
  const [data, setData] = useState<CorporateAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [symbol, setSymbol] = useState(initialSymbol || "");
  const [actionType, setActionType] = useState("all");
  const [totalPages, setTotalPages] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("limit", limit.toString());
      if (symbol) params.set("symbol", symbol);
      if (actionType !== "all") params.set("actionType", actionType);

      const res = await fetch(`/api/corporate-actions?${params}`);
      const result = await res.json();
      
      if (result.data) {
        setData(result.data);
        setTotal(result.total);
        setTotalPages(result.totalPages);
      }
    } catch (err) {
      console.error("Failed to fetch corporate actions:", err);
    } finally {
      setLoading(false);
    }
  }, [page, limit, symbol, actionType]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getTypeColor = (type: string) => {
    switch (type) {
      case "DIVIDEND":
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
      case "SPLIT":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
      case "BONUS":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400";
      case "RIGHTS":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400";
      case "BUYBACK":
        return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400";
    }
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return "-";
    const d = new Date(date);
    return d.toLocaleDateString("en-GB");
  };

  const formatDividend = (value: number | null) => {
    if (value === null) return "-";
    return `₹${value.toFixed(2)}`;
  };

  const formatRatio = (action: CorporateAction) => {
    if (action.actionType === "SPLIT" && action.oldFV && action.newFV) {
      return `${action.oldFV} → ₹${action.newFV}`;
    }
    if (action.actionType === "BONUS" && action.ratio) {
      return action.ratio;
    }
    return action.faceValue || "-";
  };

  return (
    <div className="space-y-4">
      {/* Search Filters */}
      {showSearch && (
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Search Symbol
            </label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => {
                setSymbol(e.target.value.toUpperCase());
                setPage(1);
              }}
              placeholder="e.g., SBIN"
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="min-w-[150px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Action Type
            </label>
            <select
              value={actionType}
              onChange={(e) => {
                setActionType(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
            >
              {ACTION_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Results Count */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {loading ? "Loading..." : `${total} corporate actions found`}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
          <thead className="bg-gray-50 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Symbol
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Company
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Type
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Details
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Ex Date
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Record Date
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Split/Bonus
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Dividend
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-slate-900 divide-y divide-gray-200 dark:divide-slate-700">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  No corporate actions found
                </td>
              </tr>
            ) : (
              data.map((action) => (
                <tr
                  key={action.id}
                  className="hover:bg-gray-50 dark:hover:bg-slate-800/50"
                >
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Link
                      href={`/company/${action.symbol}`}
                      className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                    >
                      {action.symbol}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 max-w-[150px] truncate">
                    {action.companyName}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className={`px-2 py-1 text-xs font-medium rounded-full ${getTypeColor(
                        action.actionType
                      )}`}
                    >
                      {action.actionType}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 max-w-[200px] truncate">
                    {action.subject}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
                    {formatDate(action.exDate)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
                    {formatDate(action.recordDate)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
                    {formatRatio(action)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300 text-right">
                    {formatDividend(action.dividendPerShare)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 text-sm rounded-lg bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 text-sm rounded-lg bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
