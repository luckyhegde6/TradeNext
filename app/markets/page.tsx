"use client";

import Link from "next/link";
import useSWR from "swr";
import { INDICES } from "@/lib/constants";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

const IndexCard = ({ indexKey, name }: { indexKey: string; name: string }) => {
    const { data, isLoading } = useSWR(`/api/nse/index/${encodeURIComponent(indexKey)}`, fetcher, {
        refreshInterval: 15000,
    });

    if (isLoading) {
        return (
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
                <div className="h-8 bg-gray-200 rounded w-3/4 mb-2"></div>
            </div>
        );
    }

    const lastPrice = data?.lastPrice || "N/A";
    const pChange = data?.pChange || "0.00";
    const isPositive = parseFloat(pChange) >= 0;

    return (
        <Link href={`/markets/${encodeURIComponent(indexKey)}`}>
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 hover:shadow-md transition-shadow cursor-pointer">
                <h3 className="text-lg font-semibold text-gray-700 mb-2">{name}</h3>
                <div className="flex items-baseline space-x-3">
                    <span className="text-3xl font-bold text-gray-900">{lastPrice}</span>
                    <span className={`text-lg font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                        {isPositive ? "+" : ""}{pChange}%
                    </span>
                </div>
                <div className="mt-4 text-sm text-blue-600 font-medium">View Chart & Details &rarr;</div>
            </div>
        </Link>
    );
};

export default function MarketsPage() {
    return (
        <div className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-7xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-4xl font-extrabold text-gray-900">Markets Overview</h1>
                    <p className="mt-2 text-lg text-gray-600">Real-time performance of major Indian indices.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {INDICES.map((idx) => (
                        <IndexCard key={idx.key} indexKey={idx.key} name={idx.name} />
                    ))}
                </div>
            </div>
        </div>
    );
}
