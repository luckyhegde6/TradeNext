"use client";

import { useState } from "react";
import clsx from "clsx";

type Column<T> = {
  key: keyof T;
  label: string;
  align?: "left" | "right";
  render?: (value: any, row: T) => React.ReactNode;
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
    return asc ? av - bv : bv - av;
  });

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-800">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 dark:bg-slate-900">
          <tr>
            {columns.map(col => (
              <th
                key={String(col.key)}
                className={clsx(
                  "px-4 py-3 font-semibold cursor-pointer select-none",
                  col.align === "right" && "text-right"
                )}
                onClick={() => {
                  setAsc(sortKey === col.key ? !asc : false);
                  setSortKey(col.key);
                }}
              >
                {col.label}
              </th>
            ))}
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
