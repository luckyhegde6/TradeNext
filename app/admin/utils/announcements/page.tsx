"use client";

import { useState } from "react";

export default function AnnouncementsIngestPage() {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<unknown>(null);

    const handleSync = async () => {
        setLoading(true);
        setResult(null);
        try {
            const res = await fetch("/api/admin/ingest/announcements", { method: "POST" });
            const data = await res.json();
            setResult(data);
        } catch {
            setResult({ error: "Failed to sync" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
                Ingest Corporate Announcements
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
                Sync latest corporate announcements from NSE (CSV).
            </p>

            <button
                onClick={handleSync}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
                {loading ? "Syncing..." : "Sync Now"}
            </button>

            {!!result && (
                <div className="mt-6 p-4 bg-gray-50 dark:bg-slate-900 rounded border border-gray-200 dark:border-slate-700">
                    <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
                        {JSON.stringify(result, null, 2)}
                    </pre>
                </div>
            )}
        </div>
    );
}
