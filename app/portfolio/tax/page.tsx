"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import TaxFYSelector from "@/app/components/tax/TaxFYSelector";
import TaxSummaryCards from "@/app/components/tax/TaxSummaryCards";
import TaxTradeTable from "@/app/components/tax/TaxTradeTable";
import type { TaxReportData } from "@/lib/services/taxService";
import { getFinancialYears } from "@/lib/services/taxCalculator";

export default function TaxReportsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const financialYears = getFinancialYears();
  const [selectedFY, setSelectedFY] = useState(financialYears[0]);
  const [report, setReport] = useState<TaxReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) router.push("/");
  }, [session, status, router]);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/portfolio/tax?fy=${selectedFY}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: TaxReportData = await res.json();
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tax report");
    } finally {
      setLoading(false);
    }
  }, [selectedFY]);

  useEffect(() => {
    if (status === "authenticated") fetchReport();
  }, [fetchReport, status]);

  const handleExportCSV = async () => {
    if (!report) return;
    setExporting(true);
    try {
      const headers = ["Symbol,Buy Date,Sell Date,Qty,Buy Price,Sell Price,Gain,Gain %,Holding Days,Type,Tax Rate,Tax Est."];
      const rows = report.trades.map((t) =>
        `${t.symbol},${t.buyDate},${t.sellDate},${t.quantity},${t.buyPrice},${t.sellPrice},${t.gain.toFixed(2)},${t.gainPercent.toFixed(1)}%,${t.holdingDays},${t.type},${(t.taxRate * 100).toFixed(0)}%,${t.taxEstimate.toFixed(2)}`
      );
      const csv = [...headers, ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `capital-gains-${selectedFY}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  if (status === "loading" || !session) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Capital Gains Tax Report</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Short-term and long-term capital gains computed using FIFO method
          </p>
        </div>
        <div className="flex items-center gap-3">
          <TaxFYSelector
            years={financialYears}
            selected={selectedFY}
            onChange={setSelectedFY}
          />
          <button
            onClick={handleExportCSV}
            disabled={exporting || !report || report.trades.length === 0}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {exporting ? "Exporting..." : "Download CSV"}
          </button>
        </div>
      </div>

      {/* Tax info banner */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 text-sm text-amber-700 dark:text-amber-300">
        <strong>Tax Note:</strong> For STT-paid listed equities, STCG (≤12 months) is taxed at 15%.
        LTCG (&gt;12 months) over ₹1,00,000 is taxed at 10%. This is an estimate — consult a CA.
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-sm text-red-700 dark:text-red-300">
          {error}
          <button onClick={fetchReport} className="ml-3 underline hover:no-underline">Retry</button>
        </div>
      )}

      {/* Summary */}
      {report && (
        <TaxSummaryCards
          summary={report.summary}
          loading={loading}
        />
      )}

      {/* Total tax estimate bar */}
      {report && report.summary.totalTrades > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Estimated Total Tax Liability
            </span>
            <span className="text-xl font-bold text-red-600 dark:text-red-400">
              ₹{report.summary.totalTaxEstimate.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </span>
          </div>
          <div className="mt-2 text-xs text-gray-400 dark:text-gray-500">
            STCG Tax: ₹{report.summary.estSTTax.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            &nbsp;|&nbsp;
            LTCG Tax (after ₹1L exemption): ₹{report.summary.estLTTax.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </div>
        </div>
      )}

      {/* Trades table */}
      <TaxTradeTable
        trades={report?.trades || []}
        loading={loading}
      />
    </div>
  );
}
