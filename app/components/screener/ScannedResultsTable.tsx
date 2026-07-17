"use client";

import type { ScannedStock } from "@/lib/screener/condition-tree";

interface ScannedResultsTableProps {
  stocks: ScannedStock[];
  loading: boolean;
  total: number;
  executionMs: number;
  onSort: (field: string) => void;
  sortBy: string;
  sortOrder: "asc" | "desc";
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onExport: () => void;
  exporting: boolean;
}

function formatNumber(val: unknown, decimals = 2): string {
  if (val === null || val === undefined) return "-";
  const n = Number(val);
  if (isNaN(n)) return "-";
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatMarketCap(val: unknown): string {
  if (val === null || val === undefined) return "-";
  const n = Number(val);
  if (isNaN(n)) return "-";
  // TV returns market_cap_basic in INR (divide by 10M for Cr)
  return `₹${(n / 10000000).toFixed(0)} Cr`;
}

function formatVolume(val: unknown): string {
  if (val === null || val === undefined) return "-";
  const n = Number(val);
  if (isNaN(n)) return "-";
  if (n >= 10000000) return `${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `${(n / 100000).toFixed(1)}L`;
  return n.toLocaleString();
}

const SORTABLE_COLUMNS = [
  { key: "symbol", label: "Symbol", align: "left" },
  { key: "close", label: "Price", align: "right" },
  { key: "change", label: "Change", align: "right" },
  { key: "change_percent", label: "% Change", align: "right" },
  { key: "volume", label: "Volume", align: "right" },
  { key: "market_cap_basic", label: "Market Cap", align: "right" },
  { key: "price_earnings_ttm", label: "P/E", align: "right" },
  { key: "price_book_ratio", label: "P/B", align: "right" },
  { key: "dividend_yield_recent", label: "Div.Yield", align: "right" },
  { key: "RSI", label: "RSI", align: "right" },
  { key: "SMA50", label: "SMA(50)", align: "right" },
  { key: "SMA200", label: "SMA(200)", align: "right" },
] as const;

export default function ScannedResultsTable({
  stocks,
  loading,
  total,
  executionMs,
  onSort,
  sortBy,
  sortOrder,
  page,
  totalPages,
  onPageChange,
  onExport,
  exporting,
}: ScannedResultsTableProps) {
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border flex justify-between items-center flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold">Results</h3>
          {!loading && (
            <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded">
              {total} stocks found {executionMs > 0 && `· ${executionMs}ms`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {total > 0 && (
            <button
              onClick={onExport}
              disabled={exporting}
              className="px-3 py-1.5 text-xs font-medium bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 rounded-md hover:bg-green-100 transition-colors disabled:opacity-50"
            >
              {exporting ? "Exporting..." : "Export CSV"}
            </button>
          )}
        </div>
      </div>

      {/* Loading state */}
      {loading ? (
        <div className="p-12 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent mb-3" />
          <p className="text-sm text-muted-foreground animate-pulse">Scanning 2000+ NSE stocks with TradingView...</p>
        </div>
      ) : stocks.length === 0 ? (
        /* Empty state */
        <div className="p-12 text-center">
          <svg className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-sm text-muted-foreground">No stocks match your filters. Try adjusting your criteria.</p>
        </div>
      ) : (
        <>
          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  {SORTABLE_COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      className={`p-3 ${col.align === "right" ? "text-right" : "text-left"} text-xs font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none`}
                      onClick={() => onSort(col.key)}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {sortBy === col.key && (
                          <span className="text-blue-500">{sortOrder === "asc" ? "↑" : "↓"}</span>
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stocks.map((stock, idx) => {
                  const change = Number(stock.change ?? stock.change_percent ?? 0);
                  const changeIsPositive = change >= 0;
                  const changePct = Number(stock.change_percent ?? 0);
                  return (
                    <tr
                      key={stock.symbol || idx}
                      className="border-t border-border/60 hover:bg-muted/30 transition-colors"
                    >
                      <td className="p-3">
                        <span className="font-bold text-sm">{stock.symbol?.toString().replace("NSE:", "") || "-"}</span>
                        {stock.name && (
                          <p className="text-[10px] text-muted-foreground truncate max-w-[140px]" title={String(stock.name)}>
                            {String(stock.name).substring(0, 25)}
                          </p>
                        )}
                      </td>
                      <td className="p-3 text-right font-medium">
                        ₹{formatNumber(stock.close, 1)}
                      </td>
                      <td className={`p-3 text-right font-bold text-sm ${changeIsPositive ? "text-green-600" : "text-red-600"}`}>
                        <div className="flex flex-col items-end">
                          <span>{changeIsPositive ? "+" : ""}{formatNumber(change, 1)}</span>
                          <span className="text-[10px] opacity-75">
                            {changeIsPositive ? "+" : ""}{formatNumber(changePct, 2)}%
                          </span>
                        </div>
                      </td>
                      <td className={`p-3 text-right font-bold text-sm ${changeIsPositive ? "text-green-600" : "text-red-600"}`}>
                        {changeIsPositive ? "+" : ""}{formatNumber(changePct, 2)}%
                      </td>
                      <td className="p-3 text-right text-xs text-muted-foreground">
                        {formatVolume(stock.volume)}
                      </td>
                      <td className="p-3 text-right text-xs text-muted-foreground">
                        {formatMarketCap(stock.market_cap_basic)}
                      </td>
                      <td className="p-3 text-right text-xs">
                        <span className={`font-medium ${Number(stock.price_earnings_ttm) > 0 && Number(stock.price_earnings_ttm) <= 25 ? "text-green-600" : Number(stock.price_earnings_ttm) > 60 ? "text-red-600" : ""}`}>
                          {formatNumber(stock.price_earnings_ttm, 1)}
                        </span>
                      </td>
                      <td className="p-3 text-right text-xs text-muted-foreground">
                        {formatNumber(stock.price_book_ratio, 1)}
                      </td>
                      <td className={`p-3 text-right text-xs font-medium ${Number(stock.dividend_yield_recent) >= 3 ? "text-green-600" : Number(stock.dividend_yield_recent) >= 1.5 ? "text-yellow-600" : ""}`}>
                        {stock.dividend_yield_recent ? `${formatNumber(stock.dividend_yield_recent, 1)}%` : "-"}
                      </td>
                      <td className="p-3 text-right text-xs">
                        <span className={Number(stock.RSI) >= 70 ? "text-red-600 font-medium" : Number(stock.RSI) <= 30 ? "text-green-600 font-medium" : "text-muted-foreground"}>
                          {formatNumber(stock.RSI, 0)}
                        </span>
                      </td>
                      <td className="p-3 text-right text-xs text-muted-foreground">
                        {formatNumber(stock.SMA50, 0)}
                      </td>
                      <td className="p-3 text-right text-xs text-muted-foreground">
                        {formatNumber(stock.SMA200, 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="p-4 border-t border-border flex justify-center items-center gap-3">
              <button
                onClick={() => onPageChange(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="px-4 py-1.5 text-sm font-medium border border-border rounded-lg disabled:opacity-40 hover:bg-muted transition-colors"
              >
                ← Prev
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  // Show pages around current
                  let pageNum: number;
                  if (totalPages <= 7) {
                    pageNum = i + 1;
                  } else if (page <= 4) {
                    pageNum = i + 1;
                  } else if (page >= totalPages - 3) {
                    pageNum = totalPages - 6 + i;
                  } else {
                    pageNum = page - 3 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => onPageChange(pageNum)}
                      className={`w-8 h-8 text-xs font-medium rounded-md transition-colors ${
                        pageNum === page
                          ? "bg-blue-600 text-white"
                          : "hover:bg-muted text-muted-foreground"
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="px-4 py-1.5 text-sm font-medium border border-border rounded-lg disabled:opacity-40 hover:bg-muted transition-colors"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
