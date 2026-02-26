"use client";

import useSWR from "swr";
import { useState } from "react";
import Link from "next/link";

import { TableSkeleton } from "@/app/components/TableSkeleton";
import { GainersTable } from "@/app/components/analytics/GainersTable";
import { LosersTable } from "@/app/components/analytics/LosersTable";
import { BulkDealsTable } from "@/app/components/analytics/BulkDealsTable";
import { MostActiveTable } from "@/app/components/analytics/MostActiveTable";
import { AdvanceDeclineCards } from "@/app/components/analytics/AdvanceDeclineCards";
import { CorporateInfoTable } from "@/app/components/analytics/CorporateInfoTable";
import { CorporateActionsTable } from "@/app/components/analytics/CorporateActionsTable";
import { CorporateNewsTable } from "@/app/components/analytics/CorporateNewsTable";
import { CorporateEventsTable } from "@/app/components/analytics/CorporateEventsTable";
import { InsiderTradingTable } from "@/app/components/analytics/InsiderTradingTable";

const fetcher = (url: string) => fetch(url).then(res => res.json());

const TABS = [
  { key: "advance", label: "Advances / Declines", api: "/api/nse/advance-decline" },
  { key: "corporate-info", label: "Corporate Info", api: "/api/nse/corporate-info" },
  { key: "corporate-announcements", label: "Corporate Announcements", api: "/api/nse/corporate-announcements" },
  { key: "corporate-events", label: "Corp Events", api: "/api/nse/corporate-events" },
  { key: "corporate-actions", label: "Dividends / Splits / Bonus", api: "/api/nse/corporate-actions" },
  { key: "insider-trading", label: "Insider Trading", api: "/api/nse/insider-trading" },
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
            className={`px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${active.key === tab.key
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
            const rawItems = Array.isArray(data) ? data : (data?.data || []);
            if (!data || rawItems.length === 0) {
              return <p className="text-gray-500">No corporate info data available</p>;
            }

            const meta = { fetchedAt: new Date().toISOString() };

            // Transform corporate announcement data to match CorporateInfoTable expectations
            // Use attchmntText (full text) if available, otherwise use desc (short description)
            const transformedData = rawItems.map((item: any) => ({
              symbol: item.symbol || "",
              sm_name: item.companyName || "",
              desc: `Issue: ${item.startDate} to ${item.endDate} | Price: ${item.priceRange} | Status: ${item.status}`,
              an_dt: item.startDate || "",
            }));

            return (
              <CorporateInfoTable
                data={transformedData}
                meta={meta}
              />
            );
          })()}

          {/* Handle corporate announcements */}
          {active.key === "corporate-announcements" && (() => {
            const rawItems = Array.isArray(data) ? data : (data?.data || []);
            if (!data || rawItems.length === 0) {
              return <p className="text-gray-500">No corporate announcements available</p>;
            }

            return (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                  <thead className="bg-gray-50 dark:bg-slate-800">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Symbol</th>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Company</th>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Subject</th>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Details</th>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Attachment</th>
                      <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">XBRL</th>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Broadcast</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-slate-900 divide-y divide-gray-200 dark:divide-slate-700">
                    {rawItems.map((ann: any, i: number) => (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <Link
                            href={`/company/${ann.symbol}`}
                            className="text-blue-600 dark:text-blue-400 hover:underline font-medium text-sm"
                          >
                            {ann.symbol}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 max-w-[150px] truncate">
                          {ann.companyName}
                        </td>
                        <td className="px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 max-w-[180px] truncate">
                          {ann.desc || "-"}
                        </td>
                        <td className="px-3 py-2.5 text-sm text-gray-600 dark:text-gray-400 max-w-[250px] truncate">
                          {ann.attchmntText || "-"}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {ann.attchmntFile ? (
                            <a
                              href={ann.attchmntFile}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                              </svg>
                              PDF
                              {ann.attFileSize && <span className="text-gray-400">({ann.attFileSize})</span>}
                            </a>
                          ) : (
                            <span className="text-gray-400 text-xs">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {ann.hasXbrl ? (
                            <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
                              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              Yes
                            </span>
                          ) : (
                            <span className="text-gray-400 text-xs">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {ann.an_dt || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}

          {/* Handle corporate actions - Dividends, Splits, Bonus */}
          {active.key === "corporate-actions" && (() => {
            const actionsData = Array.isArray(data) ? data : (data?.data || []);
            if (!data || actionsData.length === 0) {
              return <p className="text-gray-500">No corporate actions available</p>;
            }

            const transformedActions = actionsData.map((item: any) => ({
              symbol: item.symbol || "",
              companyName: item.companyName || "",
              series: item.series || "",
              subject: item.subject || "",
              exDate: item.exDate || "",
              recDate: item.recDate || "",
              faceValue: item.faceValue || "",
              type: item.type || "",
              isUpcoming: item.isUpcoming || false,
              currentPrice: item.currentPrice ? Number(item.currentPrice) : null,
            }));

            return <CorporateActionsTable data={transformedActions} />;
          })()}

          {/* Handle insider trading */}
          {active.key === "insider-trading" && (() => {
            const insiderData = Array.isArray(data) ? data : (data?.data || []);
            if (!data || insiderData.length === 0) {
              return <p className="text-gray-500">No insider trading data available</p>;
            }

            const transformedInsider = insiderData.map((item: any) => ({
              symbol: item.symbol || "",
              companyName: item.companyName || "",
              acqName: item.acqName || "",
              transactionType: item.transactionType || "",
              securities: Number(item.securities || 0),
              price: item.price ? Number(item.price) : null,
              value: item.value ? Number(item.value) : null,
              secAcqPromoter: item.secAcqPromoter || "",
              secType: item.secType || "",
              afterSec: item.afterSec ? Number(item.afterSec) : null,
              mode: item.mode || "",
              remarks: item.remarks || "",
              broadcastDate: item.broadcastDate || "",
              currentPrice: item.currentPrice ? Number(item.currentPrice) : null,
            }));

            return <InsiderTradingTable data={transformedInsider} />;
          })()}

          {/* Handle corporate events */}
          {active.key === "corporate-events" && (() => {
            const eventsData = Array.isArray(data) ? data : (data?.data || []);
            if (!data || eventsData.length === 0) {
              return <p className="text-gray-500">No corporate events available</p>;
            }

            const transformedEvents = eventsData.map((item: any) => ({
              symbol: item.symbol || item.SYMBOL || "",
              companyName: item.company || item.COMPANY || "",
              purpose: item.purpose || item.PURPOSE || "",
              details: item.bm_desc || item.details || item.DETAILS || "",
              date: item.date || item.DATE || "",
            }));

            return <CorporateEventsTable data={transformedEvents} />;
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
