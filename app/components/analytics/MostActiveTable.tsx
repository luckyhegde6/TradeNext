// components/analytics/MostActiveTable.tsx
"use client";
import Link from "next/link";
import { PaginatedDataTable } from "@/app/components/PaginatedDataTable";
import { MostActiveDTO } from "@/lib/nse/dto";

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

export function MostActiveTable({
  data,
  meta
}: {
  data: MostActiveDTO[];
  meta?: Meta;
}) {
  return (
    <div className="space-y-3">
      {meta && <Freshness meta={meta} />}

      <PaginatedDataTable
        data={data}
        defaultSort="volume"
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
            key: "ltp",
            label: "Last Price",
            align: "right",
            render: v => v?.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00",
          },
          {
            key: "change",
            label: "Change",
            align: "right",
            render: v => (
              <span className={v >= 0 ? "text-green-600" : "text-red-600"}>{v >= 0 ? "+" : ""}{v?.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}</span>
            ),
          },
          {
            key: "pChange",
            label: "% Change",
            align: "right",
            render: v => (
              <span className={v >= 0 ? "text-green-600" : "text-red-600"}>{v >= 0 ? "+" : ""}{v?.toFixed(2) || "0.00"}%</span>
            ),
          },
          {
            key: "volume",
            label: "Volume",
            align: "right",
            render: v => v?.toLocaleString("en-IN") || "0",
          },
          {
            key: "turnover",
            label: "Turnover (₹ Cr)",
            align: "right",
            render: v => v ? (v / 1e7).toFixed(2) : "0.00",
          },
          {
            key: "previousClose",
            label: "Prev Close",
            align: "right",
            render: v => v?.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00",
          },
        ]}
      />
    </div>
  );
}
