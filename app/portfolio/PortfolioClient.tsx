"use client";

import { useState, useEffect } from 'react';
import { PortfolioSummary } from '@/lib/services/portfolioService';
import MetricsCards from './components/MetricsCards';
import AllocationChart from './components/AllocationChart';
import HoldingsTable from './components/HoldingsTable';
import TradingViewWidget from './components/TradingViewWidget';

export default function PortfolioClient() {
    const [data, setData] = useState<PortfolioSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedStock, setSelectedStock] = useState<string | null>(null);

    useEffect(() => {
        fetchPortfolioData();
    }, []);

    const fetchPortfolioData = async () => {
        try {
            setLoading(true);
            const response = await fetch('/api/portfolio');
            if (!response.ok) throw new Error('Failed to fetch portfolio data');
            const portfolioData = await response.json();
            setData(portfolioData);
            // Set first stock as default for chart
            if (portfolioData.holdings.length > 0) {
                setSelectedStock(portfolioData.holdings[0].ticker);
            }
        } catch (err) {
            console.error('Portfolio fetch error:', err);
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-gray-600 dark:text-slate-400">Loading portfolio...</p>
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 max-w-md">
                    <p className="text-red-600 dark:text-red-400">{error || 'Failed to load portfolio'}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {/* Metrics Cards */}
            <MetricsCards data={data} />

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Allocation Chart */}
                <AllocationChart holdings={data.holdings} />

                {/* TradingView Chart */}
                {selectedStock && (
                    <div className="space-y-4">
                        <div className="flex gap-2 flex-wrap">
                            {data.holdings.map((holding) => (
                                <button
                                    key={holding.ticker}
                                    onClick={() => setSelectedStock(holding.ticker)}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${selectedStock === holding.ticker
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700'
                                        }`}
                                >
                                    {holding.ticker}
                                </button>
                            ))}
                        </div>
                        <TradingViewWidget symbol={selectedStock} />
                    </div>
                )}
            </div>

            {/* Holdings Table */}
            <HoldingsTable holdings={data.holdings} />
        </div>
    );
}
