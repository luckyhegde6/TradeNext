"use client";

import { useMemo } from "react";
import Link from "next/link";

interface CorporateAction {
  symbol: string;
  companyName: string;
  series: string;
  subject: string;
  exDate: string;
  recDate: string;
  faceValue: string;
  type: string;
  isUpcoming?: boolean;
  currentPrice?: number | null;
}

interface Props {
  data: CorporateAction[];
}

export function CorporateActionsTable({ data }: Props) {
  const { upcoming, older } = useMemo(() => {
    const upcomingList: CorporateAction[] = [];
    const olderList: CorporateAction[] = [];
    
    data.forEach((action) => {
      if (action.isUpcoming) {
        upcomingList.push(action);
      } else {
        olderList.push(action);
      }
    });
    
    return { upcoming: upcomingList, older: olderList };
  }, [data]);

  const getTypeColor = (type: string) => {
    switch (type) {
      case "Dividend":
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
      case "Split":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
      case "Bonus":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400";
      case "Rights":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400";
    }
  };

  const formatExDate = (dateStr: string): { text: string; highlight: boolean; label: string } => {
    if (!dateStr) return { text: "-", highlight: false, label: "" };
    try {
      const [day, month, year] = dateStr.split("-");
      const date = new Date(`${month} ${day}, ${year}`);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const diffDays = Math.ceil((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diffDays >= 0 && diffDays <= 2) {
        return { text: dateStr, highlight: true, label: "Very Soon!" };
      } else if (diffDays > 2 && diffDays <= 7) {
        return { text: dateStr, highlight: true, label: "This Week" };
      } else if (diffDays > 7 && diffDays <= 30) {
        return { text: dateStr, highlight: false, label: "This Month" };
      }
      return { text: dateStr, highlight: false, label: "" };
    } catch {
      return { text: dateStr, highlight: false, label: "" };
    }
  };

  const renderRow = (action: CorporateAction, isHighlighted = false, index = 0) => {
    const exDateInfo = formatExDate(action.exDate);
    
    return (
      <tr key={`${action.symbol}-${action.exDate}-${index}`} className={`hover:bg-gray-50 dark:hover:bg-slate-800/50 ${isHighlighted ? "bg-yellow-50 dark:bg-yellow-900/10" : ""}`}>
        <td className="px-4 py-3 whitespace-nowrap">
          <Link
            href={`/company/${action.symbol}`}
            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
          >
            {action.symbol}
          </Link>
        </td>
        <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 max-w-xs truncate">
          {action.companyName}
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          <span className={`px-2 py-1 text-xs font-medium rounded-full ${getTypeColor(action.type)}`}>
            {action.type}
          </span>
        </td>
        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 max-w-md truncate">
          {action.subject}
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          <div className="flex items-center gap-2">
            <span className={`text-sm ${exDateInfo.highlight ? "font-bold text-green-600 dark:text-green-400" : "text-gray-600 dark:text-gray-300"}`}>
              {exDateInfo.text}
            </span>
            {exDateInfo.label && (
              <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${exDateInfo.highlight ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"}`}>
                {exDateInfo.label}
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
          {action.recDate || "-"}
        </td>
        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
          ₹{action.faceValue}
        </td>
        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300 text-right">
          {action.currentPrice ? `₹${action.currentPrice.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "-"}
        </td>
      </tr>
    );
  };

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No corporate actions available
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Upcoming Actions */}
      {upcoming.length > 0 && (
        <div className="bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-yellow-800 dark:text-yellow-200 mb-3 flex items-center gap-2">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
            </svg>
            Upcoming ({upcoming.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-yellow-200 dark:divide-yellow-800">
              <thead className="bg-yellow-100 dark:bg-yellow-900/20">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-yellow-800 dark:text-yellow-200 uppercase">Symbol</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-yellow-800 dark:text-yellow-200 uppercase">Company</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-yellow-800 dark:text-yellow-200 uppercase">Type</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-yellow-800 dark:text-yellow-200 uppercase">Subject</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-yellow-800 dark:text-yellow-200 uppercase">Ex Date</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-yellow-800 dark:text-yellow-200 uppercase">Record Date</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-yellow-800 dark:text-yellow-200 uppercase">Face Value</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-yellow-800 dark:text-yellow-200 uppercase">Current Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-yellow-200 dark:divide-yellow-800">
                {upcoming.map((action, idx) => renderRow(action, true, idx))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* All Actions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            All Corporate Actions ({older.length + upcoming.length})
          </h3>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Showing {data.length} records
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
            <thead className="bg-gray-50 dark:bg-slate-800">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Symbol
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Company
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Subject
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Ex Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Record Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Face Value
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Current Price
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-slate-900 divide-y divide-gray-200 dark:divide-slate-700">
              {older.map((action, idx) => renderRow(action, false, idx))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
