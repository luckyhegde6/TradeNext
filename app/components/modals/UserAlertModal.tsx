"use client";

import { useState } from "react";

interface UserAlertModalProps {
    onClose: () => void;
    onUpdate: () => void;
}

export default function UserAlertModal({ onClose, onUpdate }: UserAlertModalProps) {
    const [form, setForm] = useState({
        symbol: "",
        alertType: "price_above",
        title: "",
        message: "",
        targetPrice: "",
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError(null);

        try {
            const payload = {
                symbol: form.symbol || null,
                alertType: form.alertType,
                title: form.title,
                message: form.message || null,
                targetPrice: form.targetPrice ? parseFloat(form.targetPrice) : null,
            };

            const response = await fetch("/api/user/alerts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || "Failed to create alert");
            }

            onUpdate();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create alert");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex min-h-screen items-center justify-center p-4">
                <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose}></div>
                <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full">
                    <div className="px-6 py-4 border-b border-gray-200">
                        <h3 className="text-lg font-semibold text-gray-900">Create Alert</h3>
                    </div>
                    <form onSubmit={handleSubmit} className="p-6 space-y-4">
                        {error && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                                <p className="text-red-800 text-sm">{error}</p>
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Symbol (Optional)</label>
                            <input
                                type="text"
                                value={form.symbol}
                                onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
                                placeholder="e.g., RELIANCE"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Alert Type *</label>
                            <select
                                value={form.alertType}
                                onChange={(e) => setForm({ ...form, alertType: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="price_above">Price Above</option>
                                <option value="price_below">Price Below</option>
                                <option value="volume_spike">Volume Spike</option>
                                <option value="custom">Custom</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                            <input
                                type="text"
                                value={form.title}
                                onChange={(e) => setForm({ ...form, title: e.target.value })}
                                placeholder="e.g., RELIANCE above 2500"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Target Price</label>
                            <input
                                type="number"
                                step="0.01"
                                value={form.targetPrice}
                                onChange={(e) => setForm({ ...form, targetPrice: e.target.value })}
                                placeholder="e.g., 2500.00"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
                            <textarea
                                value={form.message}
                                onChange={(e) => setForm({ ...form, message: e.target.value })}
                                rows={3}
                                placeholder="Optional additional details..."
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        <div className="flex justify-end space-x-3 pt-4">
                            <button
                                type="button"
                                onClick={onClose}
                                className="bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={saving}
                                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                            >
                                {saving ? "Creating..." : "Create Alert"}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
