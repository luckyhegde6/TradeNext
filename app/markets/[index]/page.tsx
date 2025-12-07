"use client";

import { use } from "react";
import Link from "next/link";
import IndexDetailsHeader from "@/app/components/IndexDetailsHeader";
import HomeChart from "@/app/components/HomeChart";
import IndexHeatmap from "@/app/components/IndexHeatmap";
import IndexCorporateActions from "@/app/components/IndexCorporateActions";
import CorporateAnnouncementsWidget from "@/app/components/CorporateAnnouncementsWidget";
import ConstituentsTable from "@/app/components/ConstituentsTable";
// Note: CorporateAnnouncements might be specific to symbol in future, currently widget fetches generic or we can adapt it if needed.
// But for now, let's assume widget is generic or sidebar.

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
                        <HomeChart symbol={indexKey} />

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
