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
  dealType?: 'bulk' | 'block';
};

type Meta = {
  fetchedAt: string;
  stale?: boolean;
};

type Column<T> = {
  key: keyof T;
  label: string;
  align?: "left" | "right";
  render?: (value: unknown, row: T) => React.ReactNode;
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
  defaultSource,
}: {
  data: BulkDeal[];
  meta?: Meta;
  dealType?: DealType;
  defaultSource?: "nse" | "db";
}) {
  const [timeRange, setTimeRange] = useState("1Y");
  const [customDate, setCustomDate] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [dbData, setDbData] = useState<BulkDeal[]>([]);
  const [loadingDb, setLoadingDb] = useState(false);
  const [source, setSource] = useState<"nse" | "db">(defaultSource || "nse");
  
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
  }, [timeRange, customDate, dealType, source]);

   // Auto-switch to NSE source when NSE data is received (for NSE tab)
   useEffect(() => {
     if (data.length > 0 && (data[0] as any).dealType && source === "db") {
       setSource("nse");
     }
   }, [data]);

    const fetchDbData = async () => {
      setLoadingDb(true);
      try {
        const params = new URLSearchParams();
        params.set("source", "db"); // Explicitly request database source
        params.set("dealType", dealType);
        
        if (showCustom && customDate) {
          params.set("fromDate", customDate);
        } else if (timeRange !== "all") {
          const range = TIME_RANGES.find(r => r.key === timeRange);
          if (range) {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - range.days);
            params.set("fromDate", startDate.toISOString().split("T")[0]);
          }
        }
        
        const response = await fetch(`/api/deals?${params}`);
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

      {/* Summary Stats Tiles (for combined NSE data) */}
      {source === "nse" && data.length > 0 && (data[0] as any).dealType && (() => {
        const bulk = data.filter(d => (d as any).dealType === 'bulk');
        const block = data.filter(d => (d as any).dealType === 'block');
        const bulkBuy = bulk.filter(d => d.buySell === 'BUY').length;
        const bulkSell = bulk.filter(d => d.buySell === 'SELL').length;
        const blockBuy = block.filter(d => d.buySell === 'BUY').length;
        const blockSell = block.filter(d => d.buySell === 'SELL').length;
        
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="text-sm text-gray-600 dark:text-gray-300 font-medium">Bulk Deals</div>
              <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">{bulk.length}</div>
              <div className="text-xs text-gray-500 mt-1">BUY: {bulkBuy} | SELL: {bulkSell}</div>
            </div>
            <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
              <div className="text-sm text-gray-600 dark:text-gray-300 font-medium">Block Deals</div>
              <div className="text-3xl font-bold text-green-600 dark:text-green-400">{block.length}</div>
              <div className="text-xs text-gray-500 mt-1">BUY: {blockBuy} | SELL: {blockSell}</div>
            </div>
            <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
              <div className="text-sm text-gray-600 dark:text-gray-300 font-medium">Total Transactions</div>
              <div className="text-3xl font-bold text-purple-600 dark:text-purple-400">{data.length}</div>
              <div className="text-xs text-gray-500 mt-1">Combined Bulk + Block</div>
            </div>
          </div>
        );
      })()}

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
          No {dealType.replace("_", " ")} data available. Try fetching from NSE Live.
        </div>
      ) : (
        <PaginatedDataTable<BulkDeal>
          data={filtered}
          itemsPerPage={20}
          columns={
            ((): Column<BulkDeal>[] => {
              const cols: Column<BulkDeal>[] = [];

              if (dealType !== "short_selling") {
                cols.push({
                  key: "date",
                  label: "Date",
                  render: (v: unknown) => v ? new Date(v as string).toLocaleDateString("en-GB") : "-",
                });
              }

              cols.push({
                key: "symbol",
                label: "Symbol",
                render: (v, row) => (
                  <Link
                    href={`/company/${v}`}
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
                  >
                    {v as string}
                  </Link>
                ),
              });

              cols.push({
                key: "securityName",
                label: "Security Name",
                render: (v: unknown): React.ReactNode => v ? String(v) : "-",
              });

              if (dealType !== "short_selling") {
                cols.push({
                  key: "clientName",
                  label: "Client",
                  render: (v: unknown, row: BulkDeal): React.ReactNode => (v ? String(v) : row.client_name ? String(row.client_name) : row.client ? String(row.client) : "-"),
                });
                cols.push({
                  key: "buySell",
                  label: "Type",
                  render: (v: unknown): React.ReactNode => (
                    <span className={v === "BUY" ? "text-green-600 font-medium" : v === "SELL" ? "text-red-600 font-medium" : ""}>
                      {v ? String(v) : "-"}
                    </span>
                  ),
                });
              }

              cols.push({
                key: "quantity",
                label: "Quantity",
                align: "right",
                render: (v, row) => {
                  const qty = Number(v || row.quantityTraded || 0);
                  return qty?.toLocaleString("en-IN") || "0";
                },
              });

              if (dealType !== "short_selling") {
                cols.push({
                  key: "price",
                  label: "Price",
                  align: "right",
                  render: (v, row) => {
                    const p = Number(v || row.tradePrice || 0);
                    return p ? `₹${p.toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "-";
                  },
                });
              }

              return cols;
            })()
          }
        />
      )}
    </div>
  );
}
