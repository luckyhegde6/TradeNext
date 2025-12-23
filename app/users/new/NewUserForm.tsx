"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function NewUserForm() {
    const router = useRouter();
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        password: "",
        confirmPassword: "",
    });
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [canSubmit, setCanSubmit] = useState(false);

    const validateEmail = (email: string) => {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    };

    useEffect(() => {
        const isEmailValid = validateEmail(formData.email);
        const isPasswordValid = formData.password.length >= 6;
        const passwordsMatch = formData.password === formData.confirmPassword;

        setCanSubmit(isEmailValid && isPasswordValid && passwordsMatch && !loading);
    }, [formData, loading]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;

        setLoading(true);
        setError("");

        try {
            const res = await fetch("/api/users/signup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData),
            });

            const data = await res.json();

            if (res.ok) {
                router.push(`/auth/verify?email=${encodeURIComponent(formData.email)}`);
            } else {
                setError(data.error || "Signup failed");
            }
        } catch (err) {
            setError("An unexpected error occurred");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto p-8 bg-surface text-surface-foreground rounded-2xl shadow-2xl border border-border mt-12 transition-all duration-200">
            <h1 className="text-3xl font-bold mb-6 text-center">Create New User</h1>

            {error && (
                <div className="mb-6 p-4 rounded-xl bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 text-sm">
                    {error}
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                    <label htmlFor="name" className="block text-sm font-medium mb-2 opacity-80">Name</label>
                    <input
                        type="text"
                        id="name"
                        name="name"
                        value={formData.name}
                        onChange={handleChange}
                        placeholder="Enter your name"
                        className="w-full px-4 py-3 rounded-xl border border-border bg-input-bg text-foreground focus:ring-2 focus:ring-primary outline-none transition-all placeholder:text-gray-400"
                    />
                </div>

                <div>
                    <label htmlFor="email" className="flex text-sm font-medium mb-2 items-center opacity-80">
                        Email
                        <span className="ml-2 px-2 py-0.5 text-[10px] font-bold text-white bg-slate-500 rounded-full uppercase">
                            Required
                        </span>
                    </label>
                    <input
                        type="email"
                        id="email"
                        name="email"
                        value={formData.email}
                        onChange={handleChange}
                        required
                        placeholder="you@example.com"
                        className="w-full px-4 py-3 rounded-xl border border-border bg-input-bg text-foreground focus:ring-2 focus:ring-primary outline-none transition-all placeholder:text-gray-400"
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="password" className="flex text-sm font-medium mb-2 items-center opacity-80">
                            Password
                            <span className="ml-2 px-2 py-0.5 text-[10px] font-bold text-white bg-slate-500 rounded-full uppercase">
                                Required
                            </span>
                        </label>
                        <input
                            type="password"
                            id="password"
                            name="password"
                            value={formData.password}
                            onChange={handleChange}
                            required
                            placeholder="••••••••"
                            className="w-full px-4 py-3 rounded-xl border border-border bg-input-bg text-foreground focus:ring-2 focus:ring-primary outline-none transition-all placeholder:text-gray-400"
                        />
                        {formData.password && formData.password.length < 6 && (
                            <p className="mt-1 text-xs text-red-500">Min. 6 characters</p>
                        )}
                    </div>

                    <div>
                        <label htmlFor="confirmPassword" className="flex text-sm font-medium mb-2 items-center opacity-80">
                            Confirm Password
                            <span className="ml-2 px-2 py-0.5 text-[10px] font-bold text-white bg-slate-500 rounded-full uppercase">
                                Required
                            </span>
                        </label>
                        <input
                            type="password"
                            id="confirmPassword"
                            name="confirmPassword"
                            value={formData.confirmPassword}
                            onChange={handleChange}
                            required
                            placeholder="••••••••"
                            className="w-full px-4 py-3 rounded-xl border border-border bg-input-bg text-foreground focus:ring-2 focus:ring-primary outline-none transition-all placeholder:text-gray-400"
                        />
                        {formData.confirmPassword && formData.password !== formData.confirmPassword && (
                            <p className="mt-1 text-xs text-red-500">Passwords do not match</p>
                        )}
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={!canSubmit}
                    className={`w-full py-4 rounded-xl font-bold shadow-lg transform active:scale-[0.98] transition-all ${canSubmit
                            ? "bg-primary text-white hover:opacity-90 shadow-primary/20"
                            : "bg-gray-200 dark:bg-slate-800 text-gray-400 cursor-not-allowed"
                        }`}
                >
                    {loading ? (
                        <div className="flex items-center justify-center gap-2">
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Processing...
                        </div>
                    ) : "Create User"}
                </button>
            </form>
        </div>
    );
}
