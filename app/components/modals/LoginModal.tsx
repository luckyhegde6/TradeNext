"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import Link from "next/link";
import { XMarkIcon } from "@heroicons/react/24/outline";

interface LoginModalProps {
    onClose: () => void;
    callbackUrl?: string;
}

export default function LoginModal({ onClose, callbackUrl = "/" }: LoginModalProps) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const res = await signIn("credentials", {
                redirect: false,
                email,
                password,
            });

            if (res?.error) {
                if (res.error === "Email not verified") {
                    setError("UNVERIFIED");
                } else {
                    setError("Invalid email or password");
                }
            } else {
                // Success - reload or redirect
                window.location.href = callbackUrl;
            }
        } catch (err) {
            setError("An unexpected error occurred");
        } finally {
            setLoading(false);
        }
    };

    const renderError = () => {
        if (!error) return null;

        if (error === "UNVERIFIED") {
            return (
                <div className="mb-4 rounded-xl bg-amber-100 dark:bg-amber-900/30 p-4 text-sm text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 flex flex-col gap-2">
                    <p className="font-semibold">Your email is not verified yet.</p>
                    <Link
                        href={`/auth/verify?email=${encodeURIComponent(email)}`}
                        onClick={onClose}
                        className="text-primary hover:underline font-bold inline-flex items-center gap-1"
                    >
                        Click here to verify now →
                    </Link>
                </div>
            );
        }

        return (
            <div className="mb-4 rounded-lg bg-red-100 dark:bg-red-900/30 p-3 text-sm text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
                {error}
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-md bg-surface rounded-2xl shadow-2xl p-6 sm:p-8 relative border border-border animate-in zoom-in-95 duration-200">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-surface-foreground/40 hover:text-surface-foreground/60 transition-colors"
                >
                    <XMarkIcon className="w-6 h-6" />
                </button>

                <div className="text-center mb-8">
                    <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center shadow-lg mx-auto mb-4">
                        <span className="text-white font-black text-2xl">T</span>
                    </div>
                    <h2 className="text-2xl font-bold text-surface-foreground">Sign In to TradeNext</h2>
                    <p className="text-sm text-surface-foreground/60 mt-2">Welcome back! Please enter your details.</p>
                </div>

                {renderError()}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-surface-foreground/80 mb-1.5 pl-1">Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="block w-full rounded-xl border border-border bg-input-bg px-4 py-3 text-foreground shadow-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all placeholder:text-gray-400"
                            placeholder="you@example.com"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-surface-foreground/80 mb-1.5 pl-1">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="block w-full rounded-xl border border-border bg-input-bg px-4 py-3 text-foreground shadow-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all placeholder:text-gray-400"
                            placeholder="••••••••"
                            required
                        />
                    </div>
                    <div className="pt-2">
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full rounded-xl bg-primary px-4 py-3.5 text-white font-bold hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-all shadow-lg active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? "Signing In..." : "Sign In"}
                        </button>
                    </div>
                </form>

                <div className="mt-8 text-center text-sm text-surface-foreground/60">
                    Don&apos;t have an account?{" "}
                    <Link href="/users/new" onClick={onClose} className="text-primary hover:underline font-bold transition-colors">
                        Join Now
                    </Link>
                </div>
            </div>
        </div>
    );
}
