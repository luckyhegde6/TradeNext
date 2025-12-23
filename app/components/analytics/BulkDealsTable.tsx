"use client";

import Link from "next/link";
import { PaginatedDataTable } from "@/app/components/PaginatedDataTable";
import { useFilter } from "@/hooks/useFilter";

type BulkDeal = {
  symbol: string;
  clientName?: string;
  client_name?: string;
  client?: string;
  quantity: number;
  price: number;
  buySell?: string;
};

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

export function BulkDealsTable({
  data,
  meta,
}: {
  data: BulkDeal[];
  meta?: Meta;
}) {
  const { query, setQuery, filtered } = useFilter(
    data,
    (row, q) => {
      const searchTerm = q.toLowerCase();
      const clientName = row.clientName || row.client_name || row.client || "";
      return (
        row.symbol?.toLowerCase().includes(searchTerm) ||
        clientName.toLowerCase().includes(searchTerm)
      );
    }
  );

  return (
    <div className="space-y-3">
      {meta && <Freshness meta={meta} />}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search symbol or client…"
        className="w-full max-w-sm px-3 py-2 border rounded text-sm"
      />

      <PaginatedDataTable<BulkDeal>
        data={filtered}
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
            key: "clientName",
            label: "Client",
            render: (v, row) => row.clientName || row.client_name || row.client || "-",
          },
          {
            key: "buySell",
            label: "Type",
            render: (v) => (
              <span className={v === "BUY" ? "text-green-600" : v === "SELL" ? "text-red-600" : ""}>
                {v || "-"}
              </span>
            ),
          },
          {
            key: "quantity",
            label: "Quantity",
            align: "right",
            render: (v) => v?.toLocaleString("en-IN") || "0",
          },
          {
            key: "price",
            label: "Price",
            align: "right",
            render: (v) => v?.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00",
          },
        ]}
      />
    </div>
  );
}
