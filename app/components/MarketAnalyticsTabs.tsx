"use client";

import useSWR from "swr";
import { useState } from "react";

import { TableSkeleton } from "@/app/components/TableSkeleton";
import { GainersTable } from "@/app/components/analytics/GainersTable";
import { LosersTable } from "@/app/components/analytics/LosersTable";
import { BulkDealsTable } from "@/app/components/analytics/BulkDealsTable";
import { MostActiveTable } from "@/app/components/analytics/MostActiveTable";
import { AdvanceDeclineCards } from "@/app/components/analytics/AdvanceDeclineCards";
import { CorporateInfoTable } from "@/app/components/analytics/CorporateInfoTable";

const fetcher = (url: string) => fetch(url).then(res => res.json());

const TABS = [
  { key: "advance", label: "Advances / Declines", api: "/api/nse/advance-decline" },
  { key: "corporate-info", label: "Corporate Info", api: "/api/nse/corporate-info" },
  { key: "deals", label: "Bulk / Large Deals", api: "/api/nse/deals" },
  { key: "active", label: "Most Active", api: "/api/nse/most-active" },
  { key: "gainers", label: "Top Gainers", api: "/api/nse/gainers" },
  { key: "losers", label: "Top Losers", api: "/api/nse/losers" },
];

export default function MarketAnalyticsTabs() {
  const [active, setActive] = useState(TABS[0]);

  const { data, error, isLoading } = useSWR(active.api, fetcher, {
    refreshInterval: 20000,
  });

  return (
    <div className="space-y-4">
      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-gray-200 dark:border-slate-700 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActive(tab)}
            className={`px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
              active.key === tab.key
                ? "border-b-2 border-blue-500 text-blue-600 dark:text-blue-400"
                : "text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {isLoading && <TableSkeleton />}
      {error && <p className="text-red-500">Failed to load data</p>}
      {!isLoading && !error && (

        <>
          {/* Handle advance-decline data structure */}
          {active.key === "advance" && (() => {
            if (!data || !data.advance || !data.advance.count) {
              return <p className="text-gray-500">No advance/decline data available</p>;
            }

            const meta = data.meta || { fetchedAt: data.timestamp || new Date().toISOString() };
            const countData = data.advance.count;
            
            // Transform count object to array format expected by AdvanceDeclineCards
            const advanceDeclineData = [
              { identifier: "Advances", count: countData.Advances || 0 },
              { identifier: "Unchange", count: countData.Unchange || 0 },
              { identifier: "Declines", count: countData.Declines || 0 },
              { identifier: "Total", count: countData.Total || 0 },
            ];

            // Transform stocks data from advance.data array
            const stocksData = (data.advance.data || []).map((stock: any) => ({
              symbol: stock.symbol || "",
              lastPrice: Number(stock.lastPrice || 0),
              pchange: Number(stock.pchange || stock.pChange || 0),
              change: Number(stock.change || 0),
              previousClose: Number(stock.previousClose || 0),
            }));

            return (
              <AdvanceDeclineCards
                data={advanceDeclineData}
                meta={meta}
                stocksData={stocksData}
              />
            );
          })()}

          {/* Handle corporate info data structure */}
          {active.key === "corporate-info" && (() => {
            if (!data || !Array.isArray(data) || data.length === 0) {
              return <p className="text-gray-500">No corporate info data available</p>;
            }

            const meta = { fetchedAt: new Date().toISOString() };
            
            // Transform corporate announcement data to match CorporateInfoTable expectations
            // Use attchmntText (full text) if available, otherwise use desc (short description)
            const transformedData = data.map((item: any) => ({
              symbol: item.symbol || "",
              companyName: item.sm_name || item.sm_name || "",
              subject: item.attchmntText || item.desc || "",
              date: item.an_dt || item.sort_date || "",
            }));

            return (
              <CorporateInfoTable
                data={transformedData}
                meta={meta}
              />
            );
          })()}

          {/* Handle deals - normalized data structure */}
          {active.key === "deals" && (() => {
            if (!data || !data.data || !Array.isArray(data.data)) {
              return <p className="text-gray-500">No deals data available</p>;
            }

            // Data is already normalized by the API route
            const transformedDeals = data.data.map((item: any) => ({
              symbol: item.symbol || "",
              clientName: item.clientName || "",
              quantity: Number(item.quantity || 0),
              price: Number(item.price || 0),
              buySell: item.buySell || "",
            }));

            const meta = data.meta || { fetchedAt: new Date().toISOString() };

            return (
              <BulkDealsTable data={transformedDeals} meta={meta} />
            );
          })()}

          {/* Handle gainers */}
          {active.key === "gainers" && (() => {
            if (!data || !data.data) {
              return <p className="text-gray-500">No data available</p>;
            }

            const meta = data.meta || (data.stale !== undefined ? { 
              fetchedAt: new Date().toISOString(), 
              stale: data.stale 
            } : undefined);

            return (
              <GainersTable 
                data={Array.isArray(data.data) ? data.data : []} 
                meta={meta}
              />
            );
          })()}

          {/* Handle losers */}
          {active.key === "losers" && (() => {
            if (!data || !data.data) {
              return <p className="text-gray-500">No data available</p>;
            }

            const meta = data.meta || (data.stale !== undefined ? { 
              fetchedAt: new Date().toISOString(), 
              stale: data.stale 
            } : undefined);

            return (
              <LosersTable 
                data={Array.isArray(data.data) ? data.data : []} 
                meta={meta}
              />
            );
          })()}

          {/* Handle most active */}
          {active.key === "active" && (() => {
            if (!data || !data.data || !Array.isArray(data.data)) {
              return <p className="text-gray-500">No data available</p>;
            }

            const meta = data.meta || { 
              fetchedAt: data.timestamp || new Date().toISOString() 
            };

            return (
              <MostActiveTable 
                data={data.data} 
                meta={meta}
              />
            );
          })()}
        </>
      )}
    </div>
  );
}
