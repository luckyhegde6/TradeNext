"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { 
    DocumentTextIcon, 
    ClipboardDocumentListIcon, 
    CalendarIcon, 
    ChartBarIcon,
    UserGroupIcon 
} from "@heroicons/react/24/outline";

interface DealData {
    id: number;
    date: string;
    symbol: string;
    securityName: string;
    clientName?: string;
    buySell?: string;
    quantityTraded?: number;
    tradePrice?: number;
    quantity?: number;
    remarks?: string | null;
}

// Data types for CSV import
type IngestDataType = 'block_deal' | 'bulk_deal' | 'short_selling' | 'corporate_actions' | 'announcements' | 'events' | 'results' | 'insider';

const DATA_TYPES: { id: IngestDataType; label: string; icon: React.ReactNode; description: string }[] = [
    { 
        id: 'block_deal', 
        label: 'Block Deals', 
        icon: <DocumentTextIcon className="w-5 h-5" />,
        description: 'Large volume trades between two parties'
    },
    { 
        id: 'bulk_deal', 
        label: 'Bulk Deals', 
        icon: <DocumentTextIcon className="w-5 h-5" />,
        description: 'Trading of bulk quantities'
    },
    { 
        id: 'short_selling', 
        label: 'Short Selling', 
        icon: <DocumentTextIcon className="w-5 h-5" />,
        description: 'Short selling transactions'
    },
    { 
        id: 'corporate_actions', 
        label: 'Corporate Actions', 
        icon: <ClipboardDocumentListIcon className="w-5 h-5" />,
        description: 'Dividends, Splits, Bonus, Rights (CSV format: SYMBOL, COMPANY NAME, SERIES, PURPOSE, FACE VALUE, EX-DATE, RECORD DATE, etc.)'
    },
    { 
        id: 'announcements', 
        label: 'Corporate Announcements', 
        icon: <CalendarIcon className="w-5 h-5" />,
        description: 'Board meetings, results, closures'
    },
    { 
        id: 'events', 
        label: 'Event Calendar', 
        icon: <CalendarIcon className="w-5 h-5" />,
        description: 'Earnings, dividends, AGMs'
    },
    { 
        id: 'results', 
        label: 'Financial Results', 
        icon: <ChartBarIcon className="w-5 h-5" />,
        description: 'Quarterly, annual results'
    },
    { 
        id: 'insider', 
        label: 'Insider Trading', 
        icon: <UserGroupIcon className="w-5 h-5" />,
        description: 'Promoter, stakeholder changes'
    },
];

export default function IngestCsvPage() {
    const router = useRouter();
    const { data: session, status } = useSession();
    const [file, setFile] = useState<File | null>(null);
    const [fileName, setFileName] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [dealType, setDealType] = useState<IngestDataType>("block_deal");
    const [uploading, setUploading] = useState(false);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
    
    const [historyData, setHistoryData] = useState<DealData[]>([]);
    const [availableDates, setAvailableDates] = useState<string[]>([]);
    const [selectedDate, setSelectedDate] = useState<string>("");
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [totalCount, setTotalCount] = useState(0);
    const [dragActive, setDragActive] = useState(false);

    // Check if user is admin
    useEffect(() => {
        if (status === "loading") return;
        if (!session || session.user.role !== "admin") {
            router.push("/");
        }
    }, [session, status, router]);

    if (status === "loading" || !session || session.user.role !== "admin") {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="text-gray-500">Checking permissions...</div>
            </div>
        );
    }

    useEffect(() => {
        if (dealType) {
            fetchHistory();
        }
    }, [dealType]);

    useEffect(() => {
        if (dealType && selectedDate) {
            fetchHistory();
        }
    }, [selectedDate]);

    const fetchHistory = async () => {
        setLoadingHistory(true);
        try {
            const params = new URLSearchParams();
            params.set("dealType", dealType);
            if (selectedDate) {
                params.set("date", selectedDate);
            }
            
            const response = await fetch(`/api/admin/ingest/deals?${params}`);
            const result = await response.json();
            
            if (result.data) {
                setHistoryData(result.data);
                setTotalCount(result.totalCount || 0);
                setAvailableDates(result.availableDates || []);
            }
        } catch (err) {
            console.error("Failed to fetch history:", err);
        } finally {
            setLoadingHistory(false);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
        }
    };

    const handleUpload = async () => {
        if (!file) {
            setMessage({ type: "error", text: "Please select a CSV file" });
            return;
        }

        setUploading(true);
        setMessage(null);

        try {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("dealType", dealType);

            const response = await fetch("/api/admin/ingest/deals", {
                method: "POST",
                body: formData,
            });

            const result = await response.json();

            if (result.success) {
                setMessage({ type: "success", text: `Successfully imported ${result.count} ${dealType.replace("_", " ")} records!` });
                setFile(null);
                fetchHistory();
            } else {
                setMessage({ type: "error", text: result.error || "Upload failed" });
            }
        } catch (err) {
            setMessage({ type: "error", text: "Upload failed" });
        } finally {
            setUploading(false);
        }
    };

    const exportToCSV = () => {
        if (historyData.length === 0) return;

        const headers = Object.keys(historyData[0]).filter(k => k !== "id");
        const csvContent = [
            headers.join(","),
            ...historyData.map(row => 
                headers.map(h => {
                    const val = row[h as keyof DealData];
                    if (val === null || val === undefined) return "";
                    if (typeof val === "string" && val.includes(",")) return `"${val}"`;
                    return val;
                }).join(",")
            )
        ].join("\n");

        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${dealType}_${selectedDate || "all"}_${new Date().toISOString().split("T")[0]}.csv`;
        link.click();
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    };

    const formatNumber = (num: number | undefined) => {
        if (num === undefined || num === null) return "-";
        return num.toLocaleString("en-IN");
    };

    return (
        <div className="space-y-6">
            <div className="border-b border-gray-200 dark:border-slate-800 pb-5">
                <h3 className="text-2xl font-bold leading-6 text-gray-900 dark:text-white">Ingest CSV</h3>
                <p className="mt-2 max-w-4xl text-sm text-gray-500 dark:text-slate-400">
                    Upload CSV files for Block Deals, Bulk Deals, and Short Selling data.
                </p>
            </div>

            {/* Upload Section */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800">
                <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Upload CSV</h4>
                
                <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-3">
                        Data Type
                    </label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {DATA_TYPES.map((type) => (
                            <button
                                key={type.id}
                                onClick={() => setDealType(type.id)}
                                className={`p-3 rounded-lg border-2 transition-all text-left ${
                                    dealType === type.id
                                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                                        : 'border-gray-200 dark:border-slate-700 hover:border-blue-300'
                                }`}
                            >
                                <div className="flex items-center mb-1">
                                    <span className={dealType === type.id ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}>
                                        {type.icon}
                                    </span>
                                </div>
                                <div className="text-xs font-bold text-gray-900 dark:text-white">{type.label}</div>
                            </button>
                        ))}
                    </div>
                </div>
                
                <div className="flex flex-col md:flex-row gap-4 items-start md:items-end">
                    <div className="flex-1 w-full">
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                            Select CSV File
                        </label>
                        <input
                            type="file"
                            accept=".csv"
                            onChange={handleFileChange}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    <button
                        onClick={handleUpload}
                        disabled={uploading}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {uploading ? "Processing..." : "Upload & Process"}
                    </button>
                </div>

                {message && (
                    <div className={`mt-4 p-3 rounded-lg ${message.type === "success" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"}`}>
                        {message.text}
                    </div>
                )}
            </div>

            {/* History Section */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
                    <div>
                        <h4 className="text-lg font-semibold text-gray-900 dark:text-white">Historical Data</h4>
                        <p className="text-sm text-gray-500 dark:text-slate-400">
                            Total records: {totalCount}
                        </p>
                    </div>
                    
                    <div className="flex gap-2">
                        <select
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            className="px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="">All Dates</option>
                            {availableDates.map(date => (
                                <option key={date} value={date}>
                                    {formatDate(date)}
                                </option>
                            ))}
                        </select>

                        <button
                            onClick={exportToCSV}
                            disabled={historyData.length === 0}
                            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Export CSV
                        </button>
                    </div>
                </div>

                {loadingHistory ? (
                    <div className="text-center py-8 text-gray-500 dark:text-slate-400">Loading...</div>
                ) : historyData.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 dark:text-slate-400">
                        No data available. Upload a CSV file to get started.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                            <thead className="bg-gray-50 dark:bg-slate-800">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">Date</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">Symbol</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">Security Name</th>
                                    {dealType !== "short_selling" && (
                                        <>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">Client</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">Buy/Sell</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">Quantity</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">Price</th>
                                        </>
                                    )}
                                    {dealType === "short_selling" && (
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">Quantity</th>
                                    )}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                                {historyData.slice(0, 100).map((deal, idx) => (
                                    <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-slate-200">
                                            {formatDate(deal.date)}
                                        </td>
                                        <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-slate-200">
                                            {deal.symbol}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-slate-300">
                                            {deal.securityName}
                                        </td>
                                        {dealType !== "short_selling" && (
                                            <>
                                                <td className="px-4 py-3 text-sm text-gray-600 dark:text-slate-300">
                                                    {deal.clientName || "-"}
                                                </td>
                                                <td className="px-4 py-3 text-sm">
                                                    <span className={`px-2 py-1 rounded text-xs font-medium ${deal.buySell === "BUY" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"}`}>
                                                        {deal.buySell || "-"}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-sm text-gray-600 dark:text-slate-300">
                                                    {formatNumber(deal.quantityTraded || deal.quantity)}
                                                </td>
                                                <td className="px-4 py-3 text-sm text-gray-600 dark:text-slate-300">
                                                    {deal.tradePrice ? `₹${deal.tradePrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "-"}
                                                </td>
                                            </>
                                        )}
                                        {dealType === "short_selling" && (
                                            <td className="px-4 py-3 text-sm text-gray-600 dark:text-slate-300">
                                                {formatNumber(deal.quantity)}
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {historyData.length > 100 && (
                            <p className="text-sm text-gray-500 dark:text-slate-400 mt-2 text-center">
                                Showing 100 of {historyData.length} records. Export to see all.
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
