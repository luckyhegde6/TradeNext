"use client";

import { useState } from "react";

export default function IngestZipPage() {
    const [file, setFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<"idle" | "uploading" | "processing" | "success" | "error">("idle");
    const [message, setMessage] = useState("");

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setStatus("idle");
            setMessage("");
        }
    };

    const handleUpload = async () => {
        if (!file) return;
        setLoading(true);
        setStatus("uploading");
        setMessage("Uploading file...");

        try {
            // 1. Upload file
            const formData = new FormData();
            formData.append("file", file);

            const uploadRes = await fetch("/api/admin/upload", {
                method: "POST",
                body: formData,
            });

            if (!uploadRes.ok) throw new Error("File upload failed");
            const uploadData = await uploadRes.json();

            setStatus("processing");
            setMessage("Triggering processing...");

            // 2. Trigger Ingest
            const ingestRes = await fetch("/api/ingest/from-zip", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ zipPath: uploadData.filePath }),
            });

            if (!ingestRes.ok) {
                const errorData = await ingestRes.json();
                throw new Error(errorData.error || "Ingestion failed");
            }

            const ingestData = await ingestRes.json();
            setStatus("success");
            setMessage(`Success! Processed ${ingestData.count || 0} records.`);

        } catch (e: unknown) {
            setStatus("error");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            setMessage((e as any).message || "An error occurred");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="border-b dark:border-slate-800 pb-5">
                <h3 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">Ingest NSE ZIP</h3>
                <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">
                    Upload daily index/market charts ZIP file provided by NSE. The system will extract and process CSVs automatically.
                </p>
            </div>

            <div className="max-w-xl bg-white dark:bg-slate-900 p-8 rounded-xl shadow-lg border border-gray-100 dark:border-slate-800">
                <div className="space-y-6">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2 ml-1">Select ZIP File</label>
                        <input
                            type="file"
                            accept=".zip"
                            onChange={handleFileChange}
                            className="block w-full text-sm text-gray-500 dark:text-slate-400
                            file:mr-4 file:py-2.5 file:px-4
                            file:rounded-lg file:border-0
                            file:text-sm file:font-bold
                            file:bg-blue-50 dark:file:bg-blue-900/30 file:text-blue-700 dark:file:text-blue-400
                            hover:file:bg-blue-100 dark:hover:file:bg-blue-900/50 transition-all cursor-pointer"
                        />
                    </div>

                    <div className="pt-2">
                        <button
                            onClick={handleUpload}
                            disabled={!file || loading}
                            className={`w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-md text-sm font-bold text-white transition-all
                            ${!file || loading
                                    ? "bg-gray-300 dark:bg-slate-800 text-gray-500 cursor-not-allowed"
                                    : "bg-blue-600 hover:bg-blue-700 shadow-blue-500/20 active:scale-[0.98]"
                                }`}
                        >
                            {loading ? (
                                <div className="flex items-center">
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></div>
                                    <span>Processing...</span>
                                </div>
                            ) : "Upload & Process"}
                        </button>
                    </div>

                    {message && (
                        <div
                            className={`mt-4 p-4 rounded-lg border animate-in fade-in slide-in-from-top-2 duration-300 ${status === "error"
                                ? "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-900/50"
                                : status === "success"
                                    ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-900/50"
                                    : "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900/50"
                                }`}
                        >
                            <p className="text-sm font-bold flex items-center">
                                {status === "success" && <span className="mr-2">✓</span>}
                                {status === "error" && <span className="mr-2">⚠</span>}
                                {message}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
