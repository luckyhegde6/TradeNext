"use client";

import { signIn } from "next-auth/react";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function SignInForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get("callbackUrl") || "/";
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        try {
            const res = await signIn("credentials", {
                redirect: false,
                email,
                password,
                callbackUrl,
            });

            if (res?.error) {
                if (res.error === "Email not verified") {
                    setError("UNVERIFIED");
                } else {
                    setError("Invalid email or password");
                }
            } else {
                router.push(callbackUrl);
            }
        } catch {
            setError("An unexpected error occurred");
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
        <div className="w-full max-w-md mx-4 rounded-2xl bg-surface p-6 sm:p-8 shadow-2xl border border-border transition-colors duration-200">
            <h2 className="mb-6 text-center text-2xl font-bold text-surface-foreground">Sign In to TradeNext</h2>
            {renderError()}
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-surface-foreground opacity-80">Email</label>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="mt-1 block w-full rounded-lg border border-border bg-input-bg p-2.5 text-foreground shadow-sm focus:border-primary focus:ring-primary outline-none transition-all placeholder:text-gray-400"
                        placeholder="you@example.com"
                        required
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-surface-foreground opacity-80">Password</label>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="mt-1 block w-full rounded-lg border border-border bg-input-bg p-2.5 text-foreground shadow-sm focus:border-primary focus:ring-primary outline-none transition-all placeholder:text-gray-400"
                        placeholder="••••••••"
                        required
                    />
                </div>
                <button
                    type="submit"
                    className="w-full rounded-lg bg-primary px-4 py-3 text-white font-bold hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-all shadow-lg active:scale-[0.98]"
                >
                    Sign In
                </button>
            </form>
            <div className="mt-6 text-center text-sm text-surface-foreground opacity-70">
                Don&apos;t have an account?{" "}
                <a href="/users/new" className="text-primary hover:underline font-semibold">
                    Join Now
                </a>
            </div>
        </div>
    );
}

export default function SignInPage() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-100">
            <Suspense fallback={<div>Loading form...</div>}>
                <SignInForm />
            </Suspense>
        </div>
    );
}
