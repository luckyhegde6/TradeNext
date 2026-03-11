"use client";

import { useState } from "react";
import clsx from "clsx";

type Column<T> = {
  key: keyof T;
  label: string;
  align?: "left" | "right";
  render?: (value: any, row: T) => React.ReactNode;
  sortable?: boolean;
};

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  defaultSort,
}: {
  columns: Column<T>[];
  data: T[];
  defaultSort?: keyof T;
}) {
  const [sortKey, setSortKey] = useState<keyof T | null>(
    defaultSort ?? null
  );
  const [asc, setAsc] = useState(false);

  const sorted = [...data].sort((a, b) => {
    if (!sortKey) return 0;
    
    const av = a[sortKey];
    const bv = b[sortKey];

    // Handle null/undefined
    if (av == null && bv == null) return 0;
    if (av == null) return asc ? 1 : -1;
    if (bv == null) return asc ? -1 : 1;

     // Compare based on type
     if (typeof av === 'number' && typeof bv === 'number') {
       return asc ? av - bv : bv - av;
     }
     
     // For dates (ISO strings or Date objects) - try to parse as dates
     const aTime = new Date(av as any).getTime();
     const bTime = new Date(bv as any).getTime();
     if (!isNaN(aTime) && !isNaN(bTime)) {
       return asc ? aTime - bTime : bTime - aTime;
     }
     
     // For strings (including symbols), use localeCompare
     if (typeof av === 'string' && typeof bv === 'string') {
       return asc 
         ? av.localeCompare(bv)
         : bv.localeCompare(av);
     }
     
     // Fallback: convert to string and compare
     const aStr = String(av);
     const bStr = String(bv);
     return asc ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
  });

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-800">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 dark:bg-slate-900">
          <tr>
            {columns.map(col => {
              const isSorted = sortKey === col.key;
              return (
                <th
                  key={String(col.key)}
                  className={clsx(
                    "px-4 py-3 font-semibold cursor-pointer select-none whitespace-nowrap",
                    col.align === "right" ? "text-right" : "text-left"
                  )}
                  onClick={() => {
                    if (isSorted) {
                      setAsc(!asc);
                    } else {
                      setAsc(false);
                      setSortKey(col.key);
                    }
                  }}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {isSorted && (
                      <span className="text-blue-600 dark:text-blue-500 text-xs ml-0.5" aria-label={asc ? "Sorted ascending" : "Sorted descending"}>
                        {asc ? '▲' : '▼'}
                      </span>
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={i}
              className="border-t dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-900"
            >
              {columns.map(col => (
                <td
                  key={String(col.key)}
                  className={clsx(
                    "px-4 py-2",
                    col.align === "right" && "text-right"
                  )}
                >
                  {col.render
                    ? col.render(row[col.key], row)
                    : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
