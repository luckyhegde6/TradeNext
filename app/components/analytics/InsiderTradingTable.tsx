"use client";

import { useMemo } from "react";
import Link from "next/link";

interface InsiderTrade {
  symbol: string;
  companyName: string;
  regulation: string;
  acqName: string;
  secType: string;
  securities: number;
  transactionType: string;
  broadcastDate: string;
  xbrl: string;
  personCategory: string;
  acqMode: string;
  exchange: string;
  secVal: number;
  beforeShares: string;
  beforePer: string;
  afterShares: string;
  afterPer: string;
}

interface Props {
  data: InsiderTrade[];
}

export function InsiderTradingTable({ data }: Props) {
  const buyTrades = useMemo(() => data.filter(d => d.transactionType?.toLowerCase().includes("buy")), [data]);
  const sellTrades = useMemo(() => data.filter(d => d.transactionType?.toLowerCase().includes("sell")), [data]);

  const formatNumber = (num: number | null | undefined) => {
    if (num === null || num === undefined) return "-";
    return num.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  };

  const formatValue = (value: number | null | undefined) => {
    if (value === null || value === undefined || value === 0) return "-";
    if (value >= 10000000) {
      return `₹${(value / 10000000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr`;
    } else if (value >= 100000) {
      return `₹${(value / 100000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} L`;
    }
    return `₹${value.toLocaleString("en-IN")}`;
  };

  const getTransactionColor = (type: string) => {
    const t = type?.toLowerCase() || "";
    if (t.includes("buy")) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
    if (t.includes("sell")) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
    return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400";
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "-";
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
      return dateStr;
    }
  };

  const renderRow = (trade: InsiderTrade, index: number) => (
    <tr key={`${trade.symbol}-${trade.broadcastDate}-${index}`} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
      <td className="px-3 py-2.5 whitespace-nowrap">
        <Link
          href={`/company/${trade.symbol}`}
          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium text-sm"
        >
          {trade.symbol}
        </Link>
      </td>
      <td className="px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 max-w-[150px] truncate">
        {trade.companyName}
      </td>
      <td className="px-3 py-2.5 text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
        {trade.regulation || "-"}
      </td>
      <td className="px-3 py-2.5 text-sm text-gray-600 dark:text-gray-300 max-w-[180px] truncate">
        {trade.acqName || "-"}
      </td>
      <td className="px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400">
        {trade.secType || "-"}
      </td>
      <td className="px-3 py-2.5 text-sm text-gray-600 dark:text-gray-300 text-right">
        {formatNumber(trade.securities)}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getTransactionColor(trade.transactionType)}`}>
          {trade.transactionType || "BUY"}
        </span>
      </td>
      <td className="px-3 py-2.5 text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap">
        {formatDate(trade.broadcastDate)}
      </td>
      <td className="px-3 py-2.5 text-center">
        {trade.xbrl ? (
          <a
            href={trade.xbrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 text-xs"
            title="View XBRL"
          >
            XBRL
          </a>
        ) : (
          <span className="text-gray-400 text-xs">-</span>
        )}
      </td>
    </tr>
  );

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No insider trading data available
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-4">
          <div className="text-sm text-gray-500 dark:text-gray-400">Total Transactions</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{data.length}</div>
        </div>
        <div className="bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <div className="text-sm text-green-600 dark:text-green-400">Buy Transactions</div>
          <div className="text-2xl font-bold text-green-700 dark:text-green-300">{buyTrades.length}</div>
        </div>
        <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="text-sm text-red-600 dark:text-red-400">Sell Transactions</div>
          <div className="text-2xl font-bold text-red-700 dark:text-red-300">{sellTrades.length}</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
          <thead className="bg-gray-50 dark:bg-slate-800">
            <tr>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Symbol</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Company</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Regulation</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Acquirer/Disposer</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Security</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Qty</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Broadcast</th>
              <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">XBRL</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-slate-900 divide-y divide-gray-200 dark:divide-slate-700">
            {data.map((trade, idx) => renderRow(trade, idx))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
