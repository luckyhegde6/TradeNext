"use client";

import Link from "next/link";
import { PaginatedDataTable } from "@/app/components/PaginatedDataTable";

type Meta = {
  fetchedAt: string;
  stale?: boolean;
};

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

type StockData = {
  symbol: string;
  lastPrice: number;
  pchange: number;
  change: number;
  previousClose: number;
};

export function AdvanceDeclineCards({
  data,
  meta,
  stocksData,
}: {
  data: { identifier: string; count: number }[];
  meta?: { fetchedAt: string; stale?: boolean };
  stocksData?: StockData[];
}) {
  if (!Array.isArray(data) || data.length === 0) {
    return <p className="text-gray-500">No advance/decline data</p>;
  }

  // Make counts clickable links
  const handleCountClick = (identifier: string) => {
    // Scroll to stocks table if available
    const tableId = "advance-decline-stocks";
    const element = document.getElementById(tableId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div className="space-y-6">
      {meta && <Freshness meta={meta} />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {data.map((item) => (
          <div
            key={item.identifier}
            className="rounded-lg border p-4 bg-white dark:bg-slate-900"
          >
            <p className="text-sm text-gray-500">{item.identifier}</p>
            <button
              onClick={() => handleCountClick(item.identifier)}
              className="text-2xl font-bold hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
              title={`Click to view ${item.identifier} stocks`}
            >
              {item.count}
            </button>
          </div>
        ))}
      </div>

      {stocksData && stocksData.length > 0 && (
        <div id="advance-decline-stocks" className="space-y-3">
          <h3 className="text-lg font-semibold">Stocks</h3>
          <PaginatedDataTable<StockData>
            data={stocksData}
            defaultSort="pchange"
            itemsPerPage={20}
            columns={[
              {
                key: "symbol",
                label: "Symbol",
                render: (v) => (
                  <Link
                    href={`/company/${v}`}
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
                  >
                    {v}
                  </Link>
                ),
              },
              {
                key: "lastPrice",
                label: "Last Price",
                align: "right",
                render: (v) => v?.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00",
              },
              {
                key: "change",
                label: "Change",
                align: "right",
                render: (v) => (
                  <span className={v >= 0 ? "text-green-600" : "text-red-600"}>
                    {v >= 0 ? "+" : ""}
                    {v?.toFixed(2) || "0.00"}
                  </span>
                ),
              },
              {
                key: "pchange",
                label: "% Change",
                align: "right",
                render: (v) => (
                  <span className={v >= 0 ? "text-green-600" : "text-red-600"}>
                    {v >= 0 ? "+" : ""}
                    {v?.toFixed(2) || "0.00"}%
                  </span>
                ),
              },
              {
                key: "previousClose",
                label: "Prev Close",
                align: "right",
                render: (v) => v?.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00",
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
  