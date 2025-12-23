"use client";

import { useState } from "react";

interface PortfolioModalProps {
    portfolio?: {
        id: number;
        name: string;
        description: string | null;
    };
    onClose: () => void;
    onUpdate: () => void;
}

export default function PortfolioModal({ portfolio, onClose, onUpdate }: PortfolioModalProps) {
    const [name, setName] = useState(portfolio?.name || "");
    const [description, setDescription] = useState(portfolio?.description || "");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const url = portfolio ? `/api/portfolio/${portfolio.id}` : `/api/portfolio`;
            const method = portfolio ? "PUT" : "POST";
            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, description }),
            });

            if (res.ok) {
                onUpdate();
                onClose();
            } else {
                const data = await res.json();
                setError(data.error || "Action failed");
            }
        } catch (err) {
            setError("An unexpected error occurred");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-6 relative">
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 text-center">
                    {portfolio ? "Edit Portfolio" : "Create Portfolio"}
                </h2>

                {error && (
                    <div className="mb-4 p-3 rounded bg-red-100 text-red-700 text-sm">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full px-4 py-2 rounded-lg border dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="e.g. My Long Term Stocks"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full px-4 py-2 rounded-lg border dark:border-slate-700 dark:bg-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="Brief description of this portfolio..."
                            rows={3}
                        />
                    </div>
                    <div className="flex gap-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-3 px-4 border border-border text-surface-foreground dark:text-gray-300 font-semibold rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-all active:scale-95"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-all shadow-lg active:scale-95 disabled:opacity-50"
                        >
                            {loading ? "Processing..." : portfolio ? "Update Portfolio" : "Create Portfolio"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
