// components/analytics/CorporateInfoTable.tsx
"use client";
import Link from "next/link";
import { PaginatedDataTable } from "@/app/components/PaginatedDataTable";
import { useFilter } from "@/hooks/useFilter";

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

export function CorporateInfoTable({ 
  data, 
  meta 
}: { 
  data: any[]; 
  meta?: Meta;
}) {
  const { query, setQuery, filtered } = useFilter(
    data,
    (row, q) =>
      row.symbol?.toLowerCase().includes(q.toLowerCase()) ||
      row.companyName?.toLowerCase().includes(q.toLowerCase()) ||
      row.subject?.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {meta && <Freshness meta={meta} />}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search symbol, company, or announcement…"
        className="w-full max-w-sm px-3 py-2 border rounded text-sm"
      />

      <PaginatedDataTable
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
                {v || "-"}
              </Link>
            ),
          },
          {
            key: "companyName",
            label: "Company",
            render: (v) => (
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {v || "-"}
              </span>
            ),
          },
          {
            key: "subject",
            label: "Announcement",
            render: (v) => (
              <div className="max-w-2xl">
                <span className="text-sm text-gray-700 dark:text-gray-300 line-clamp-2" title={v}>
                  {v || "-"}
                </span>
              </div>
            ),
          },
          {
            key: "date",
            label: "Date",
            align: "right",
            render: (v) => v || "-",
          },
        ]}
      />
    </div>
  );
}
