"use client";

import { useState } from "react";

interface FundModalProps {
    portfolioId: string;
    onClose: () => void;
    onUpdate: () => void;
}

export default function FundModal({ portfolioId, onClose, onUpdate }: FundModalProps) {
    const [type, setType] = useState<"DEPOSIT" | "WITHDRAWAL">("DEPOSIT");
    const [amount, setAmount] = useState("");
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [notes, setNotes] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const res = await fetch(`/api/portfolio/funds`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    portfolioId,
                    type,
                    amount: parseFloat(amount),
                    date: new Date(date).toISOString(),
                    notes,
                }),
            });

            if (res.ok) {
                onUpdate();
                onClose();
            } else {
                const data = await res.json();
                setError(data.error || "Failed to process fund transaction");
            }
        } catch (err) {
            setError("An unexpected error occurred");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-md bg-surface rounded-2xl shadow-2xl p-6 relative border border-border">
                <button onClick={onClose} className="absolute top-4 right-4 text-surface-foreground/40 hover:text-surface-foreground/60">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <h2 className="text-2xl font-bold text-surface-foreground mb-6 text-center">Manage Funds</h2>

                {error && (
                    <div className="mb-4 p-3 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-sm">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-surface-foreground/70 mb-1">Transaction Type</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setType("DEPOSIT")}
                                className={`py-2 px-4 rounded-lg font-semibold transition-all ${type === 'DEPOSIT'
                                        ? 'bg-green-600 text-white shadow-md'
                                        : 'bg-surface-foreground/5 text-surface-foreground/60 hover:bg-surface-foreground/10'
                                    }`}
                            >
                                Deposit
                            </button>
                            <button
                                type="button"
                                onClick={() => setType("WITHDRAWAL")}
                                className={`py-2 px-4 rounded-lg font-semibold transition-all ${type === 'WITHDRAWAL'
                                        ? 'bg-red-600 text-white shadow-md'
                                        : 'bg-surface-foreground/5 text-surface-foreground/60 hover:bg-surface-foreground/10'
                                    }`}
                            >
                                Withdrawal
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-surface-foreground/70 mb-1">Amount (INR)</label>
                        <input
                            type="number"
                            step="any"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="w-full px-4 py-2 rounded-lg border border-border bg-input-bg text-surface-foreground focus:ring-2 focus:ring-primary outline-none"
                            placeholder="0.00"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-surface-foreground/70 mb-1">Date</label>
                        <input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="w-full px-4 py-2 rounded-lg border border-border bg-input-bg text-surface-foreground focus:ring-2 focus:ring-primary outline-none"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-surface-foreground/70 mb-1">Notes</label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="w-full px-4 py-2 rounded-lg border border-border bg-input-bg text-surface-foreground focus:ring-2 focus:ring-primary outline-none"
                            placeholder="Reason for transaction..."
                            rows={2}
                        />
                    </div>

                    <div className="flex gap-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-3 px-4 border border-border text-surface-foreground font-semibold rounded-lg hover:bg-surface-foreground/5 transition-all active:scale-95"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className={`flex-1 py-3 px-4 font-semibold rounded-lg transition-all shadow-lg active:scale-95 disabled:opacity-50 ${type === 'DEPOSIT' ? 'bg-primary text-white hover:opacity-90' : 'bg-red-600 text-white hover:bg-red-700'
                                }`}
                        >
                            {loading ? "Processing..." : `Confirm ${type.charAt(0) + type.slice(1).toLowerCase()}`}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
