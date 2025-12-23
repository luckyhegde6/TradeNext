"use client";

import { useState } from "react";
import Link from "next/link";
import { DataTable } from "./DataTable";

type Column<T> = {
  key: keyof T;
  label: string;
  align?: "left" | "right";
  render?: (value: any, row: T) => React.ReactNode;
};

export function PaginatedDataTable<T extends Record<string, any>>({
  columns,
  data,
  defaultSort,
  itemsPerPage = 20,
}: {
  columns: Column<T>[];
  data: T[];
  defaultSort?: keyof T;
  itemsPerPage?: number;
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.ceil(data.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedData = data.slice(startIndex, endIndex);

  return (
    <div className="space-y-4">
      <DataTable columns={columns} data={paginatedData} defaultSort={defaultSort} />
      
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-slate-800">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Showing {startIndex + 1} to {Math.min(endIndex, data.length)} of {data.length} entries
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-slate-800"
            >
              Previous
            </button>
            <span className="px-3 py-1 text-sm">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-slate-800"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

