import FoClient from './FoClient';

export const dynamic = 'force-dynamic';

export default function FoPage() {
    return (
        <main className="min-h-screen bg-gray-50 dark:bg-slate-950">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                        F&O Analytics
                    </h1>
                    <p className="text-gray-600 dark:text-slate-400">
                        Track futures &amp; options positions, monitor option chains, and analyze your P&L
                    </p>
                </div>

                <FoClient />
            </div>
        </main>
    );
}
