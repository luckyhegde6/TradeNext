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
        <div className="p-6">
            <div className="mb-8">
                <h3 className="text-2xl font-bold leading-6 text-gray-900">Ingest NSE ZIP</h3>
                <p className="mt-2 max-w-4xl text-sm text-gray-500">
                    Upload daily index/market charts ZIP file provided by NSE. The system will extract and process CSVs automatically.
                </p>
            </div>

            <div className="max-w-xl bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Select ZIP File</label>
                        <input
                            type="file"
                            accept=".zip"
                            onChange={handleFileChange}
                            className="block w-full text-sm text-gray-500
                            file:mr-4 file:py-2 file:px-4
                            file:rounded-md file:border-0
                            file:text-sm file:font-semibold
                            file:bg-blue-50 file:text-blue-700
                            hover:file:bg-blue-100"
                        />
                    </div>

                    <div className="pt-4">
                        <button
                            onClick={handleUpload}
                            disabled={!file || loading}
                            className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white transition-colors
                            ${!file || loading
                                    ? "bg-gray-300 cursor-not-allowed"
                                    : "bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                                }`}
                        >
                            {loading ? "Processing..." : "Upload & Process"}
                        </button>
                    </div>

                    {message && (
                        <div
                            className={`mt-4 p-4 rounded-md ${status === "error"
                                ? "bg-red-50 text-red-700"
                                : status === "success"
                                    ? "bg-green-50 text-green-700"
                                    : "bg-blue-50 text-blue-700"
                                }`}
                        >
                            <p className="text-sm font-medium">{message}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
