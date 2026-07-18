/**
 * POST /api/screener/export
 *
 * Export scan results as CSV.
 *
 * Request body:
 * {
 *   stocks: Record<string, unknown>[];
 *   columns?: string[];          // Which columns to include (default: all)
 *   format: "csv";               // Future: "xlsx", "pdf"
 *   filename?: string;
 * }
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import logger from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { stocks, columns, filename } = body;

    if (!Array.isArray(stocks) || stocks.length === 0) {
      return NextResponse.json({ error: "stocks array is required and must be non-empty" }, { status: 400 });
    }

    // Determine columns — use specified or all keys from first stock
    const usedColumns = Array.isArray(columns) && columns.length > 0
      ? columns
      : Object.keys(stocks[0]).filter((k) => k !== "exchange"); // Skip exchange

    // Build CSV
    const header = usedColumns.join(",");
    const rows = stocks.map((stock) => {
      return usedColumns
        .map((col) => {
          const val = stock[col];
          if (val === null || val === undefined) return "";
          const str = String(val);
          // Escape CSV if needed
          if (str.includes(",") || str.includes('"') || str.includes("\n")) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        })
        .join(",");
    });

    const csv = [header, ...rows].join("\n");

    const exportFilename = filename || `screener-export-${Date.now()}.csv`;

    logger.info({
      msg: "Export generated",
      userId: session.user.id,
      count: stocks.length,
      columns: usedColumns.length,
      format: "csv",
    });

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFilename}"`,
      },
    });
  } catch (error) {
    logger.error({ msg: "Export failed", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
