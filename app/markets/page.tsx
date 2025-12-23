"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { INDICES, MAJOR_INDICES } from "@/lib/constants";
import MarketAnalyticsTabs from "@/app/components/MarketAnalyticsTabs";

const fetcher = (url: string) => fetch(url).then((res) => res.json());
function Freshness({ meta }: { meta: any }) {
  return (
    <div className="text-xs text-gray-500 mb-2 flex gap-2">
      <span>
        As of {new Date(meta.fetchedAt).toLocaleTimeString("en-IN")}
      </span>
      {meta.stale && (
        <span className="text-amber-500">
          (Updating…)
        </span>
      )}
    </div>
  );
}
const IndexCard = ({ indexKey, name }: { indexKey: string; name: string }) => {
    // Refresh interval slightly randomized to avoid thundering herd on client
    const refreshInterval = 15000 + Math.floor(Math.random() * 5000);
    const { data, isLoading } = useSWR(`/api/nse/index/${encodeURIComponent(indexKey)}`, fetcher, {
        refreshInterval,
    });

    if (isLoading) {
        return (
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
                <div className="h-8 bg-gray-200 rounded w-3/4 mb-2"></div>
            </div>
        );
    }

    const lastPrice = data?.lastPrice ? Number(data.lastPrice).toLocaleString('en-IN') : "N/A";
    const pChange = data?.pChange || "0.00";
    const isPositive = parseFloat(pChange) >= 0;

    return (
        <Link href={`/markets/${encodeURIComponent(indexKey)}`}>
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 hover:shadow-md transition-shadow cursor-pointer h-full flex flex-col justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-gray-700 mb-2 truncate" title={name}>{name}</h3>
                    <div className="flex items-baseline space-x-3 flex-wrap">
                        <span className="text-3xl font-bold text-gray-900">{lastPrice}</span>
                        <span className={`text-lg font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                            {isPositive ? "+" : ""}{pChange}%
                        </span>
                    </div>
                </div>
                <div className="mt-4 text-sm text-blue-600 font-medium flex items-center gap-1 group">
                    View Chart & Details
                    <span className="group-hover:translate-x-1 transition-transform">&rarr;</span>
                </div>
            </div>
        </Link>
    );
};

export default function MarketsPage() {
    const [showAll, setShowAll] = useState(false);

    // Default to MAJOR_INDICES, explicitly filter duplicates if any logic changes
    const visibleIndices = showAll ? INDICES : MAJOR_INDICES;

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-slate-950 p-8">
            <div className="max-w-7xl mx-auto">
                <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-4xl font-extrabold text-gray-900 dark:text-white">Markets Overview</h1>
                        <p className="mt-2 text-lg text-gray-600 dark:text-gray-400">Real-time performance of major Indian indices.</p>
                    </div>

                    {!showAll && (
                        <button
                            onClick={() => setShowAll(true)}
                            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow transition-colors"
                        >
                            Load All Indices ({INDICES.length})
                        </button>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {visibleIndices.map((idx) => (
                        <IndexCard key={idx.key} indexKey={idx.key} name={idx.name} />
                    ))}
                </div>

                {showAll && (
                    <div className="mt-8 text-center text-gray-500">
                        Showing all {INDICES.length} indices
                    </div>
                )}
            </div>
        </div>
    );
}
