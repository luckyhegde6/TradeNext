"use client";

import { signIn } from "next-auth/react";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function SignInForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get("callbackUrl") || "/";
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const res = await signIn("credentials", {
                redirect: false,
                email,
                password,
                callbackUrl,
            });

            if (res?.error) {
                setError("Invalid email or password");
            } else {
                router.push(callbackUrl);
            }
        } catch {
            setError("An unexpected error occurred");
        }
    };

    return (
        <div className="w-full max-w-md mx-4 rounded-lg bg-white p-6 sm:p-8 shadow-md">
            <h2 className="mb-6 text-center text-2xl font-bold text-gray-900">Sign In to TradeNext</h2>
            {error && (
                <div className="mb-4 rounded bg-red-100 p-3 text-sm text-red-700">
                    {error}
                </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700">Email</label>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="mt-1 block w-full rounded-md border border-gray-300 p-2 text-gray-900 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        placeholder="you@example.com"
                        required
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">Password</label>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="mt-1 block w-full rounded-md border border-gray-300 p-2 text-gray-900 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        placeholder="••••••••"
                        required
                    />
                </div>
                <button
                    type="submit"
                    className="w-full rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                    Sign In
                </button>
            </form>
            <div className="mt-4 text-center text-sm text-gray-600">
                Don&apos;t have an account?{" "}
                <a href="/users/new" className="text-blue-600 hover:text-blue-500">
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
