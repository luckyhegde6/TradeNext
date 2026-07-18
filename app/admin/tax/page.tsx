"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import TaxFYSelector from "@/app/components/tax/TaxFYSelector";
import { getFinancialYears } from "@/lib/services/taxCalculator";

interface AdminTaxOverview {
  totalUsers: number;
  usersWithGains: number;
  aggregateSTCG: number;
  aggregateLTCG: number;
  aggregateTaxLiability: number;
  fy: string;
  financialYears: string[];
}

export default function AdminTaxPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [overview, setOverview] = useState<AdminTaxOverview | null>(null);
  const [selectedFY, setSelectedFY] = useState(getFinancialYears()[0]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "loading") return;
    if (!session || !session.user || (session.user as any).role !== "admin") {
      router.push("/");
    }
  }, [session, status, router]);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/tax?fy=${selectedFY}`);
      if (res.ok) setOverview(await res.json());
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [selectedFY]);

  useEffect(() => {
    if (status === "authenticated") fetchOverview();
  }, [fetchOverview, status]);

  if (status === "loading" || !session || (session.user as any).role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-gray-500">Checking permissions...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Tax Management</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Aggregate capital gains overview across all users
          </p>
        </div>
        <TaxFYSelector
          years={getFinancialYears()}
          selected={selectedFY}
          onChange={setSelectedFY}
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-slate-700 animate-pulse">
              <div className="h-4 w-24 bg-gray-200 dark:bg-slate-600 rounded mb-3" />
              <div className="h-8 w-20 bg-gray-200 dark:bg-slate-600 rounded" />
            </div>
          ))}
        </div>
      ) : overview ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-gray-200 dark:border-slate-700">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total Users</p>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">{overview.totalUsers}</p>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 border border-gray-200 dark:border-slate-700">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Users with Gains</p>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">{overview.usersWithGains}</p>
            </div>
            <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4 border border-gray-200 dark:border-slate-700">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Aggregate STCG</p>
              <p className="text-2xl font-bold text-orange-600 dark:text-orange-400 mt-1">
                ₹{overview.aggregateSTCG.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
              </p>
            </div>
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 border border-gray-200 dark:border-slate-700">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Aggregate LTCG</p>
              <p className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">
                ₹{overview.aggregateLTCG.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-gray-200 dark:border-slate-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Tax Liability Summary</h3>
            <div className="text-center py-8">
              <p className="text-4xl font-bold text-red-600 dark:text-red-400">
                ₹{overview.aggregateTaxLiability.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                Estimated total tax liability across {overview.usersWithGains} users for FY {overview.fy}
              </p>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-lg p-8 text-center border border-gray-200 dark:border-slate-700">
          <p className="text-gray-500">Could not load tax overview data.</p>
          <button onClick={fetchOverview} className="mt-3 text-blue-600 hover:underline text-sm">Retry</button>
        </div>
      )}
    </div>
  );
}
