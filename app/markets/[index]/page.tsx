"use client";

import { use } from "react";
import { lazy, Suspense } from "react";
import Link from "next/link";
import IndexDetailsHeader from "@/app/components/IndexDetailsHeader";
import IndexHeatmap from "@/app/components/IndexHeatmap";
import IndexCorporateActions from "@/app/components/IndexCorporateActions";
import CorporateAnnouncementsWidget from "@/app/components/CorporateAnnouncementsWidget";
import ConstituentsTable from "@/app/components/ConstituentsTable";

// Lazy load chart component
const HomeChart = lazy(() => import("@/app/components/HomeChart"));

function ChartLoader() {
  return (
    <div className="h-[400px] flex items-center justify-center bg-gray-100 dark:bg-slate-800 rounded-xl">
      <div className="animate-pulse text-gray-400">Loading chart...</div>
    </div>
  );
}

export default function IndexDetailPage({ params }: { params: Promise<{ index: string }> }) {
    const resolvedParams = use(params);
    const indexKey = decodeURIComponent(resolvedParams.index);

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-slate-950 p-6 md:p-8">
            <div className="max-w-7xl mx-auto space-y-6">
                {/* Breadcrumb / Back Link */}
                <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
                    <Link href="/markets" className="hover:text-blue-600">Markets</Link>
                    <span>/</span>
                    <span className="text-gray-900 dark:text-white font-medium">{indexKey}</span>
                </div>

                <IndexDetailsHeader symbol={indexKey} />

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    {/* Main Content: Chart + Heatmap & Table Side by Side */}
                    <div className="lg:col-span-3 space-y-6">
                        <Suspense fallback={<ChartLoader />}>
                            <HomeChart symbol={indexKey} />
                        </Suspense>

                        {/* Heatmap and Table Side by Side */}
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            {/* Constituents Heatmap */}
                            <div className="max-h-[800px] overflow-y-auto">
                                <IndexHeatmap symbol={indexKey} />
                            </div>

                            {/* Constituents Table */}
                            <div className="max-h-[800px] overflow-y-auto">
                                <ConstituentsTable symbol={indexKey} />
                            </div>
                        </div>
                    </div>

                    {/* Sidebar: Announcements + Corp Actions */}
                    <div className="lg:col-span-1 space-y-5">
                        <IndexCorporateActions symbol={indexKey} />
                        <CorporateAnnouncementsWidget symbol={indexKey} />
                    </div>
                </div>
            </div>
        </div>
    );
}
