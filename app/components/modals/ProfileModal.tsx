"use client";

import { useState } from "react";

interface ProfileModalProps {
    user: {
        id: string | number;
        name: string | null;
        email: string;
        mobile?: string | null;
        role: string;
    };
    onClose: () => void;
    onUpdate: () => void;
}

export default function ProfileModal({ user, onClose, onUpdate }: ProfileModalProps) {
    const [name, setName] = useState(user.name || "");
    const [mobile, setMobile] = useState(user.mobile || "");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMessage("");

        try {
            const res = await fetch(`/api/users/profile`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, mobile, password: password || undefined }),
            });

            if (res.ok) {
                setMessage("Profile updated successfully!");
                onUpdate();
                setTimeout(onClose, 1500);
            } else {
                const error = await res.json();
                setMessage(error.error || "Update failed");
            }
        } catch (err) {
            setMessage("An error occurred");
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

                <h2 className="text-2xl font-bold text-surface-foreground mb-6 text-center">Manage Profile</h2>

                {message && (
                    <div className={`mb-4 p-3 rounded text-sm ${message.includes("success") ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"}`}>
                        {message}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-4 pb-4 border-b border-border/50">
                        <h3 className="text-sm font-semibold text-primary/80 uppercase tracking-wider">Basic Information</h3>
                        <div>
                            <label className="block text-sm font-medium text-surface-foreground/80 mb-1">Name</label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full px-4 py-2 rounded-lg border border-border bg-input-bg text-surface-foreground focus:ring-2 focus:ring-primary outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-surface-foreground/80 mb-1">Email (Read-only)</label>
                            <input
                                type="email"
                                value={user.email}
                                readOnly
                                className="w-full px-4 py-2 rounded-lg border border-border bg-surface-foreground/5 text-surface-foreground/40 outline-none cursor-not-allowed"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-surface-foreground/80 mb-1">Mobile Number (Optional)</label>
                            <input
                                type="tel"
                                value={mobile}
                                onChange={(e) => setMobile(e.target.value)}
                                placeholder="Enter mobile number"
                                className="w-full px-4 py-2 rounded-lg border border-border bg-input-bg text-surface-foreground focus:ring-2 focus:ring-primary outline-none"
                            />
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h3 className="text-sm font-semibold text-primary/80 uppercase tracking-wider">Security</h3>
                        <div>
                            <label className="block text-sm font-medium text-surface-foreground/80 mb-1">New Password (leave blank to keep current)</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-4 py-2 rounded-lg border border-border bg-input-bg text-surface-foreground focus:ring-2 focus:ring-primary outline-none"
                                placeholder="••••••••"
                            />
                        </div>
                    </div>

                    <div className="flex gap-3 pt-6">
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
                            className="flex-1 py-3 px-4 bg-primary hover:opacity-90 text-white font-semibold rounded-lg transition-all shadow-lg active:scale-95 disabled:opacity-50"
                        >
                            {loading ? "Updating..." : "Save Changes"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
