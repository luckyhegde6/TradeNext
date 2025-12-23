"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

export default function CreatePortfolioPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const [name, setName] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    if (status === 'loading') {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (status === 'unauthenticated') {
        router.push('/auth/signin');
        return null;
    }

    // eslint-disable-next-line react-hooks/rules-of-hooks
    useState(() => {
        if (typeof window !== 'undefined') {
            fetch('/api/portfolio')
                .then(res => res.json())
                .then(data => {
                    if (data.hasPortfolio || data.id) {
                        router.replace('/portfolio');
                    }
                });
        }
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const response = await fetch('/api/portfolio/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to create portfolio');
            }

            // Success: Keep loading while we navigate
            router.refresh(); // Clear server-side data caches
            router.replace('/portfolio');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
            setLoading(false); // Only stop loading on error
        }
    };

    return (
        <div className="max-w-md mx-auto py-12 px-4 shadow-sm border border-border bg-surface rounded-xl my-12">
            <h1 className="text-2xl font-bold text-surface-foreground mb-6">Create Your Portfolio</h1>
            <p className="text-surface-foreground/60 mb-8">
                Initialize your investment tracking by giving your portfolio a name.
            </p>

            <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                    <label htmlFor="name" className="block text-sm font-medium text-surface-foreground/70 mb-2">
                        Portfolio Name
                    </label>
                    <input
                        type="text"
                        id="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. My Long Term Portfolio"
                        required
                        className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary outline-none transition-all"
                    />
                </div>

                {error && (
                    <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-lg">
                        {error}
                    </div>
                )}

                <button
                    type="submit"
                    disabled={loading || !name}
                    className="w-full py-3 bg-primary text-white font-bold rounded-lg shadow-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100"
                >
                    {loading ? 'Creating...' : 'Initialize Portfolio'}
                </button>
            </form>
        </div>
    );
}
