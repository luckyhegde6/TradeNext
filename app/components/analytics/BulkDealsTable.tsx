"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { PaginatedDataTable } from "@/app/components/PaginatedDataTable";
import { useFilter } from "@/hooks/useFilter";

type BulkDeal = {
  id?: number;
  date?: string;
  symbol: string;
  securityName?: string;
  clientName?: string;
  client_name?: string;
  client?: string;
  quantity: number | string;
  quantityTraded?: number;
  price: number | string;
  tradePrice?: number;
  buySell?: string;
};

type Meta = {
  fetchedAt: string;
  stale?: boolean;
};

type DealType = "block_deal" | "bulk_deal" | "short_selling";

const TIME_RANGES = [
  { key: "1D", label: "1D", days: 1 },
  { key: "1W", label: "1W", days: 7 },
  { key: "1M", label: "1M", days: 30 },
  { key: "3M", label: "3M", days: 90 },
  { key: "6M", label: "6M", days: 180 },
  { key: "1Y", label: "1Y", days: 365 },
];

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

export function BulkDealsTable({
  data,
  meta,
  dealType = "bulk_deal",
}: {
  data: BulkDeal[];
  meta?: Meta;
  dealType?: DealType;
}) {
  const [timeRange, setTimeRange] = useState("1M");
  const [customDate, setCustomDate] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [dbData, setDbData] = useState<BulkDeal[]>([]);
  const [loadingDb, setLoadingDb] = useState(false);
  const [source, setSource] = useState<"nse" | "db">("db");
  
  const { query, setQuery, filtered } = useFilter(
    source === "db" ? dbData : data,
    (row, q) => {
      const searchTerm = q.toLowerCase();
      const clientName = row.clientName || row.client_name || row.client || "";
      return (
        row.symbol?.toLowerCase().includes(searchTerm) ||
        row.securityName?.toLowerCase().includes(searchTerm) ||
        clientName.toLowerCase().includes(searchTerm)
      );
    }
  );

  useEffect(() => {
    if (source === "db") {
      fetchDbData();
    }
  }, [timeRange, customDate, dealType]);

  const fetchDbData = async () => {
    setLoadingDb(true);
    try {
      const params = new URLSearchParams();
      params.set("dealType", dealType);
      
      if (showCustom && customDate) {
        params.set("date", customDate);
      } else if (timeRange !== "all") {
        const range = TIME_RANGES.find(r => r.key === timeRange);
        if (range) {
          const startDate = new Date();
          startDate.setDate(startDate.getDate() - range.days);
          params.set("date", startDate.toISOString().split("T")[0]);
        }
      }
      
      const response = await fetch(`/api/admin/ingest/deals?${params}`);
      const result = await response.json();
      setDbData(result.data || []);
    } catch (err) {
      console.error("Failed to fetch DB data:", err);
    } finally {
      setLoadingDb(false);
    }
  };

  const handleTimeRange = (range: string) => {
    if (range === "Custom") {
      setShowCustom(true);
    } else if (range === "Clear") {
      setTimeRange("all");
      setShowCustom(false);
      setCustomDate("");
    } else {
      setShowCustom(false);
      setTimeRange(range);
    }
  };

  const getDateRangeLabel = () => {
    if (showCustom && customDate) {
      return new Date(customDate).toLocaleDateString("en-GB");
    }
    const range = TIME_RANGES.find(r => r.key === timeRange);
    if (range) {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - range.days);
      return `${startDate.toLocaleDateString("en-GB")} - ${new Date().toLocaleDateString("en-GB")}`;
    }
    return "All Time";
  };

  return (
    <div className="space-y-3">
      {meta && <Freshness meta={meta} />}

      {/* Source Toggle */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="flex gap-2">
          <button
            onClick={() => setSource("db")}
            className={`px-3 py-1.5 text-sm rounded-lg ${
              source === "db"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200"
            }`}
          >
            📊 Database
          </button>
          <button
            onClick={() => setSource("nse")}
            className={`px-3 py-1.5 text-sm rounded-lg ${
              source === "nse"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200"
            }`}
          >
            🌐 NSE Live
          </button>
        </div>

        {source === "db" && (
          <>
            {/* Time Range Selector */}
            <div className="flex gap-1 items-center">
              {TIME_RANGES.map((range) => (
                <button
                  key={range.key}
                  onClick={() => handleTimeRange(range.key)}
                  className={`px-3 py-1.5 text-sm rounded-lg ${
                    timeRange === range.key && !showCustom
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200"
                  }`}
                >
                  {range.label}
                </button>
              ))}
              <button
                onClick={() => handleTimeRange("Custom")}
                className={`px-3 py-1.5 text-sm rounded-lg ${
                  showCustom
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200"
                }`}
              >
                Custom
              </button>
              {timeRange !== "1M" && (
                <button
                  onClick={() => handleTimeRange("Clear")}
                  className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Custom Date Picker */}
            {showCustom && (
              <input
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                className="px-3 py-1.5 text-sm border rounded-lg bg-white dark:bg-slate-800 dark:border-slate-600"
              />
            )}

            {/* Date Range Label */}
            <span className="text-sm text-gray-500">
              {getDateRangeLabel()}
            </span>

            {/* Record Count */}
            <span className="text-sm text-gray-500 ml-auto">
              {loadingDb ? "Loading..." : `${dbData.length} records`}
            </span>
          </>
        )}
      </div>

      {/* Search */}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search symbol, security name or client…"
        className="w-full max-w-sm px-3 py-2 border rounded text-sm"
      />

      {source === "db" && loadingDb ? (
        <div className="text-center py-8 text-gray-500">Loading data...</div>
      ) : source === "db" && dbData.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No {dealType.replace("_", " ")} data found. 
          <a href="/admin/utils/ingest-csv" className="text-blue-600 hover:underline ml-1">
            Upload CSV to import data
          </a>
        </div>
      ) : (
        <PaginatedDataTable<BulkDeal>
          data={filtered}
          itemsPerPage={20}
          columns={[
            ...(dealType !== "short_selling" ? [{
              key: "date",
              label: "Date",
              render: (v) => v ? new Date(v).toLocaleDateString("en-GB") : "-",
            }] : []),
            {
              key: "symbol",
              label: "Symbol",
              render: (v, row) => (
                <Link
                  href={`/company/${v}`}
                  className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
                >
                  {v}
                </Link>
              ),
            },
            {
              key: "securityName",
              label: "Security Name",
              render: (v) => v || "-",
            },
            ...(dealType !== "short_selling" ? [{
              key: "clientName",
              label: "Client",
              render: (v, row) => v || row.client_name || row.client || "-",
            }] : []),
            ...(dealType !== "short_selling" ? [{
              key: "buySell",
              label: "Type",
              render: (v) => (
                <span className={v === "BUY" ? "text-green-600 font-medium" : v === "SELL" ? "text-red-600 font-medium" : ""}>
                  {v || "-"}
                </span>
              ),
            }] : []),
            {
              key: "quantity",
              label: "Quantity",
              align: "right",
              render: (v) => {
                const qty = Number(v || row.quantityTraded || 0);
                return qty?.toLocaleString("en-IN") || "0";
              },
            },
            ...(dealType !== "short_selling" ? [{
              key: "price",
              label: "Price",
              align: "right",
              render: (v, row) => {
                const p = Number(v || row.tradePrice || 0);
                return p ? `₹${p.toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "-";
              },
            }] : []),
          ]}
        />
      )}
    </div>
  );
}
