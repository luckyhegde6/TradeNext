import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getPortfolioData } from "@/lib/services/portfolioService";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/portfolio/export?type=fy-report|detailed-pnl&fy=2024-25
 *
 * Downloads portfolio data as CSV.
 * - fy-report: Full financial year report with holdings summary + transactions
 * - detailed-pnl: Per-holding P&L breakdown
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "detailed-pnl";
    const fy = searchParams.get("fy") || "2025-26";

    const userId = Number(session.user.id);

    // Fetch portfolio data & transactions
    const portfolio = await getPortfolioData(userId);
    const rawTxs = await prisma.transaction.findMany({
      where: { portfolio: { userId } },
      orderBy: { tradeDate: "desc" },
    });

    // Normalize Prisma Decimal/Date types
    const transactions = rawTxs.map((t) => ({
      ticker: t.ticker,
      side: t.side,
      quantity: Number(t.quantity),
      price: Number(t.price),
      tradeDate: t.tradeDate.toISOString(),
      fees: t.fees ? Number(t.fees) : null,
      notes: t.notes,
    }));

    // Parse FY dates (e.g., "2024-25" => Apr 1, 2024 to Mar 31, 2025)
    const fyStart = parseInt(fy.split("-")[0]);
    const fyStartDate = new Date(fyStart, 3, 1); // Apr 1
    const fyEndDate = new Date(fyStart + 1, 2, 31); // Mar 31 next year

    let csvContent = "";
    let filename = "";

    if (type === "fy-report") {
      filename = `portfolio-fy-report-${fy}.csv`;
      csvContent = generateFYReport(portfolio, transactions, fy, fyStartDate, fyEndDate);
    } else {
      filename = `portfolio-detailed-pnl-${fy}.csv`;
      csvContent = generateDetailedPnL(portfolio, transactions, fy, fyStartDate, fyEndDate);
    }

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ msg: "Portfolio export failed", error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function escapeCSV(val: string | number | null | undefined): string {
  if (val == null) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function generateFYReport(
  portfolio: { holdings: Array<{ ticker: string; name?: string; sector?: string; quantity: number; avgPrice: number; currentPrice: number; investedValue: number; currentValue: number; pnl: number; pnlPercent: number; allocation: number }>; totalValue: number; totalInvested: number; totalPnl: number; totalPnlPercent: number; name?: string },
  transactions: Array<{ ticker: string; side: string; quantity: number; price: number; tradeDate: string; fees?: number | null; notes?: string | null }>,
  fy: string,
  fyStart: Date,
  fyEnd: Date
): string {
  const lines: string[] = [];

  // Header section
  lines.push(`Portfolio Report,${escapeCSV(portfolio.name || "My Portfolio")}`);
  lines.push(`Financial Year,${escapeCSV(fy)}`);
  lines.push(`Generated,${new Date().toISOString().split("T")[0]}`);
  lines.push("");

  // Summary
  lines.push("=== SUMMARY ===");
  lines.push("Metric,Value");
  lines.push(`Total Invested,${escapeCSV(portfolio.totalInvested.toFixed(2))}`);
  lines.push(`Current Value,${escapeCSV(portfolio.totalValue.toFixed(2))}`);
  lines.push(`Total P&L,${escapeCSV(portfolio.totalPnl.toFixed(2))}`);
  lines.push(`Total P&L %,${escapeCSV(portfolio.totalPnlPercent.toFixed(2))}%`);
  lines.push("");

  // Holdings
  lines.push("=== HOLDINGS ===");
  lines.push("Ticker,Name,Sector,Quantity,Avg Price,Current Price,Invested,Current Value,P&L,P&L %,Allocation %");
  for (const h of portfolio.holdings) {
    lines.push([
      escapeCSV(h.ticker),
      escapeCSV(h.name),
      escapeCSV(h.sector),
      h.quantity,
      h.avgPrice.toFixed(2),
      h.currentPrice.toFixed(2),
      h.investedValue.toFixed(2),
      h.currentValue.toFixed(2),
      h.pnl.toFixed(2),
      h.pnlPercent.toFixed(2),
      h.allocation.toFixed(2),
    ].join(","));
  }
  lines.push("");

  // FY Transactions
  const fyTransactions = transactions.filter((t) => {
    const d = new Date(t.tradeDate);
    return d >= fyStart && d <= fyEnd;
  });

  lines.push("=== TRANSACTIONS (FY) ===");
  lines.push("Date,Ticker,Side,Quantity,Price,Fees,Notes");
  for (const t of fyTransactions) {
    lines.push([
      escapeCSV(new Date(t.tradeDate).toISOString().split("T")[0]),
      escapeCSV(t.ticker),
      escapeCSV(t.side),
      t.quantity,
      t.price.toFixed(2),
      escapeCSV(t.fees?.toFixed(2)),
      escapeCSV(t.notes),
    ].join(","));
  }

  return lines.join("\r\n");
}

function generateDetailedPnL(
  portfolio: { holdings: Array<{ ticker: string; name?: string; sector?: string; quantity: number; avgPrice: number; currentPrice: number; investedValue: number; currentValue: number; pnl: number; pnlPercent: number; allocation: number }>; totalValue: number; totalInvested: number; totalPnl: number; totalPnlPercent: number },
  _transactions: Array<{ ticker: string; side: string; quantity: number; price: number; tradeDate: string; fees?: number | null; notes?: string | null }>,
  _fy: string,
  _fyStart: Date,
  _fyEnd: Date
): string {
  const lines: string[] = [];

  // Header
  lines.push("Ticker,Name,Sector,Quantity,Avg Price,Current Price,Invested (₹),Current Value (₹),P&L (₹),P&L %,Allocation %");
  lines.push("");

  // Holdings
  for (const h of portfolio.holdings) {
    lines.push([
      escapeCSV(h.ticker),
      escapeCSV(h.name),
      escapeCSV(h.sector),
      h.quantity,
      h.avgPrice.toFixed(2),
      h.currentPrice.toFixed(2),
      h.investedValue.toFixed(2),
      h.currentValue.toFixed(2),
      h.pnl.toFixed(2),
      h.pnlPercent.toFixed(2),
      h.allocation.toFixed(2),
    ].join(","));
  }
  lines.push("");

  // Totals
  lines.push([
    "TOTAL", "", "", "",
    "", "",
    portfolio.totalInvested.toFixed(2),
    portfolio.totalValue.toFixed(2),
    portfolio.totalPnl.toFixed(2),
    portfolio.totalPnlPercent.toFixed(2),
    "100.00",
  ].join(","));

  return lines.join("\r\n");
}
