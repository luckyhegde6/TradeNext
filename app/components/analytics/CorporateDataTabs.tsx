"use client";

import useSWR from "swr";
import { FinancialStatusDTO, CorpEventDTO, CorporateAnnouncementDTO, CorpActionDTO } from "@/lib/nse/dto";
import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

interface CorporateDataTabsProps {
    symbol: string;
}

export default function CorporateDataTabs({ symbol }: CorporateDataTabsProps) {
    const { data, error, isLoading } = useSWR(`/api/nse/stock/${symbol}/corporate`, fetcher);
    const [activeTab, setActiveTab] = useState<'financials' | 'events' | 'announcements' | 'actions'>('financials');

    if (error) return <div className="text-red-500 p-4">Failed to load corporate data</div>;
    if (isLoading) return <div className="animate-pulse bg-gray-100 dark:bg-slate-800 h-64 rounded-lg"></div>;

    const tabs = [
        { id: 'financials', label: 'Financials' },
        { id: 'events', label: 'Events' },
        { id: 'announcements', label: 'Announcements' },
        { id: 'actions', label: 'Actions' },
    ] as const;

    return (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-800 overflow-hidden">
            <div className="border-b border-gray-200 dark:border-slate-800">
                <nav className="flex -mb-px overflow-x-auto">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`
                                py-4 px-6 text-sm font-medium whitespace-nowrap border-b-2 transition-colors
                                ${activeTab === tab.id
                                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                                }
                            `}
                        >
                            {tab.label}
                        </button>
                    ))}
                </nav>
            </div>

            <div className="p-6">
                {activeTab === 'financials' && <FinancialData data={data?.financials} />}
                {activeTab === 'events' && <EventsData data={data?.events} />}
                {activeTab === 'announcements' && <AnnouncementsData data={data?.announcements} />}
                {activeTab === 'actions' && <ActionsData data={data?.actions} />}
            </div>
        </div>
    );
}


function FinancialData({ data }: { data: FinancialStatusDTO | null }) {
    if (!data) return <div className="text-gray-500">No financial data available</div>;

    const income = parseFloat(data.totalIncome) || 0;
    const expenditure = parseFloat(data.expenditure) || 0;
    const profit = parseFloat(data.netProLossAftTax) || 0;

    // Convert to Cr (assuming input is in lakhs)
    const chartData = [
        { name: 'Income', value: income / 100, color: '#3b82f6' },
        { name: 'Expenditure', value: expenditure / 100, color: '#ef4444' },
        { name: 'Net Profit', value: profit / 100, color: '#10b981' },
    ];

    const items = [
        { label: 'Period From', value: data.from_date },
        { label: 'Period To', value: data.to_date },
        { label: 'Total Income', value: `₹${(income / 100).toFixed(2)} Cr`, highlight: true },
        { label: 'Expenditure', value: `₹${(expenditure / 100).toFixed(2)} Cr` },
        { label: 'Net Profit/Loss', value: `₹${(profit / 100).toFixed(2)} Cr`, profit: profit > 0 },
        { label: 'EPS', value: data.eps },
        { label: 'Audited', value: data.audited },
        { label: 'Consolidated', value: data.consolidated },
    ];

    return (
        <div className="space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Stats Grid */}
                <div className="lg:col-span-1 grid grid-cols-2 gap-4">
                    {items.map((item, i) => (
                        <div key={i} className={`p-4 rounded-xl border border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/30`}>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{item.label}</div>
                            <div className={`text-sm font-bold ${item.label === 'Net Profit/Loss' ? (profit > 0 ? 'text-green-600' : 'text-red-600') : 'text-gray-900 dark:text-white'
                                }`}>
                                {item.value || 'N/A'}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Chart */}
                <div className="lg:col-span-2 bg-gray-50/50 dark:bg-slate-800/30 rounded-xl p-6 border border-gray-100 dark:border-slate-800">
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-6">Financial Overview (₹ Crores)</h4>
                    <div className="h-[250px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.1} />
                                <XAxis
                                    dataKey="name"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                                />
                                <YAxis
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                                />
                                <Tooltip
                                    cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                    contentStyle={{
                                        backgroundColor: '#1e293b',
                                        border: 'none',
                                        borderRadius: '8px',
                                        color: '#f8fafc'
                                    }}
                                />
                                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                                    {chartData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            <div className="text-[10px] text-gray-400 dark:text-gray-500 italic">
                * Values are retrieved from NSE and synced to local database. Last updated: {data.re_broadcast_timestamp}
            </div>
        </div>
    );
}

function EventsData({ data }: { data: CorpEventDTO[] }) {
    if (!data || data.length === 0) return <div className="text-gray-500">No upcoming events</div>;

    return (
        <div className="space-y-4">
            {data.map((event, i) => (
                <div key={i} className="flex flex-col md:flex-row md:items-center justify-between p-4 border border-gray-100 dark:border-slate-800 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800/30 transition-colors">
                    <div>
                        <div className="text-sm font-bold text-gray-900 dark:text-white">{event.bm_purpose}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{event.bm_desc}</div>
                    </div>
                    <div className="mt-2 md:mt-0 text-right">
                        <div className="text-sm font-medium text-blue-600 dark:text-blue-400">{event.bm_date}</div>
                    </div>
                </div>
            ))}
        </div>
    );
}

function AnnouncementsData({ data }: { data: CorporateAnnouncementDTO[] }) {
    if (!data || data.length === 0) return <div className="text-gray-500">No recent announcements</div>;

    return (
        <div className="space-y-4">
            {data.map((ann, i) => (
                <div key={i} className="p-4 border border-gray-100 dark:border-slate-800 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800/30 transition-colors">
                    <div className="flex justify-between items-start mb-2">
                        <div className="text-sm font-bold text-gray-900 dark:text-white">{ann.desc}</div>
                        <div className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded">
                            {ann.an_dt}
                        </div>
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mb-3">
                        {ann.attchmntText}
                    </div>
                    {ann.attchmntFile && (
                        <a
                            href={ann.attchmntFile}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                        >
                            📎 View Attachment ({ann.fileSize})
                        </a>
                    )}
                </div>
            ))}
        </div>
    );
}

function ActionsData({ data }: { data: CorpActionDTO[] }) {
    if (!data || data.length === 0) return <div className="text-gray-500">No recent corporate actions</div>;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.map((action, i) => (
                <div key={i} className="p-4 border border-gray-100 dark:border-slate-800 rounded-lg">
                    <div className="text-sm font-bold text-gray-900 dark:text-white mb-2">{action.subject}</div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">Ex-Date</div>
                            <div className="text-sm font-medium dark:text-gray-200">{action.exDate || 'N/A'}</div>
                        </div>
                        <div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">Record Date</div>
                            <div className="text-sm font-medium dark:text-gray-200">{action.recDate || 'N/A'}</div>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
