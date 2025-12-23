"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function VerifyContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const email = searchParams.get("email") || "";
    const [code, setCode] = useState(searchParams.get("code") || "");
    const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
    const [message, setMessage] = useState("");

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setStatus("loading");

        try {
            const res = await fetch("/api/auth/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, code }),
            });

            const data = await res.json();

            if (res.ok) {
                setStatus("success");
                setMessage("Email verified successfully! Redirecting to sign in...");
                setTimeout(() => router.push("/auth/signin"), 2000);
            } else {
                setStatus("error");
                setMessage(data.error || "Verification failed");
            }
        } catch (err) {
            setStatus("error");
            setMessage("An unexpected error occurred");
        }
    };

    const handleResend = async () => {
        setStatus("loading");
        try {
            const res = await fetch("/api/auth/resend-verification", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            });

            const data = await res.json();

            if (res.ok) {
                setStatus("idle");
                setMessage("Verification code resent! Check your console/email.");
            } else {
                setStatus("error");
                setMessage(data.error || "Failed to resend code");
            }
        } catch (err) {
            setStatus("error");
            setMessage("An unexpected error occurred");
        }
    };

    return (
        <div className="w-full max-w-md mx-4 rounded-2xl bg-surface p-6 sm:p-8 shadow-2xl border border-border transition-all duration-200">
            <h2 className="mb-6 text-center text-2xl font-bold text-surface-foreground">Verify Your Email</h2>
            <p className="mb-6 text-center text-sm text-surface-foreground/70">
                We&apos;ve sent a 6-digit code to <strong className="text-surface-foreground">{email}</strong>
            </p>

            {message && (
                <div className={`mb-4 rounded-xl p-4 text-sm border ${status === "success"
                    ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800"
                    : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800"
                    }`}>
                    {message}
                </div>
            )}

            <form onSubmit={handleVerify} className="space-y-6">
                <div>
                    <label className="block text-sm font-medium text-surface-foreground/80 mb-2">Verification Code</label>
                    <input
                        type="text"
                        maxLength={6}
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        className="block w-full rounded-xl border border-border bg-input-bg p-4 text-foreground shadow-sm focus:ring-2 focus:ring-primary outline-none text-center text-3xl font-bold tracking-[0.5em] transition-all placeholder:text-gray-400"
                        placeholder="000000"
                        required
                    />
                </div>
                <button
                    type="submit"
                    disabled={status === "loading" || status === "success"}
                    className="w-full rounded-xl bg-primary px-4 py-4 text-white font-bold hover:opacity-90 active:scale-[0.98] transition-all shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {status === "loading" ? (
                        <div className="flex items-center justify-center gap-2">
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Verifying...
                        </div>
                    ) : "Verify Email"}
                </button>
            </form>

            <div className="mt-8 text-center text-sm">
                <button
                    onClick={handleResend}
                    disabled={status === "loading" || status === "success"}
                    className="text-primary hover:underline font-semibold disabled:opacity-50"
                >
                    Didn&apos;t receive the code? Resend
                </button>
            </div>
        </div>
    );
}

export default function VerifyPage() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4 transition-colors duration-200">
            <Suspense fallback={<div className="text-surface-foreground">Loading verification...</div>}>
                <VerifyContent />
            </Suspense>
        </div>
    );
}
