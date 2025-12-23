"use client";

import { useState, useEffect } from 'react';
import { PortfolioSummary } from '@/lib/services/portfolioService';
import MetricsCards from '../components/MetricsCards';
import AllocationChart from '../components/AllocationChart';
import HoldingsTable from '../components/HoldingsTable';
import NSEStockChart from '../components/NSEStockChart';
import CorporateAnnouncementsWidget from '../components/CorporateAnnouncementsWidget';
import IndexCorporateActions from '../components/IndexCorporateActions';
import PortfolioModal from '../components/modals/PortfolioModal';
import TransactionModal from '../components/modals/TransactionModal';
import FundModal from '../components/modals/FundModal';

export default function PortfolioClient() {
    const [data, setData] = useState<PortfolioSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedStock, setSelectedStock] = useState<string | null>(null);
    const [isPortfolioModalOpen, setIsPortfolioModalOpen] = useState(false);
    const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
    const [isFundModalOpen, setIsFundModalOpen] = useState(false);

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

            if (portfolioData.holdings && portfolioData.holdings.length > 0) {
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
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                    <p className="text-surface-foreground/60">Loading portfolio...</p>
                </div>
            </div>
        );
    }

    if (error || !data || !data.hasPortfolio) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] text-center space-y-6">
                <div className="bg-primary/5 p-8 rounded-full">
                    <svg className="w-16 h-16 text-primary/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </div>
                <div>
                    <h2 className="text-2xl font-bold text-surface-foreground mb-2">No Portfolio Found</h2>
                    <p className="text-surface-foreground/60 max-w-sm">
                        Start tracking your investments by creating your first portfolio today.
                    </p>
                </div>
                <button
                    onClick={() => window.location.href = '/portfolio/new'}
                    className="px-6 py-3 bg-primary text-white font-semibold rounded-lg shadow-lg hover:opacity-90 active:scale-95 transition-all"
                >
                    Create Portfolio
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Metrics Cards */}
            <MetricsCards data={data} />
            {/* Reporting Section */}
            <section className="bg-surface rounded-3xl p-8 border border-border shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                    <div>
                        <h2 className="text-2xl font-bold text-surface-foreground mb-2">Performance Reports</h2>
                        <p className="text-surface-foreground/60">Generate and download detailed performance reports for tax or analysis purposes</p>
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={() => setIsTransactionModalOpen(true)}
                            className="px-4 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:opacity-90 transition-all"
                        >
                            Add Asset
                        </button>
                        <button
                            onClick={() => setIsFundModalOpen(true)}
                            className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 transition-all"
                        >
                            Manage Cash
                        </button>
                        <button
                            onClick={() => setIsPortfolioModalOpen(true)}
                            className="px-4 py-2 border border-border text-surface-foreground/60 text-sm font-bold rounded-lg hover:bg-primary/5 transition-all"
                        >
                            Edit Portfolio
                        </button>
                    </div>
                </div>

                <div className="flex flex-wrap gap-4 items-end">
                    <div className="space-y-2">
                        <label className="text-sm font-semibold text-surface-foreground/60">Select Financial Year</label>
                        <select className="block w-48 px-4 py-2 bg-surface border border-border rounded-lg text-surface-foreground focus:ring-2 focus:ring-primary outline-none transition-all">
                            <option value="2024-25">FY 2024 - 2025</option>
                            <option value="2023-24">FY 2023 - 2024</option>
                            <option value="2022-23">FY 2022 - 2023</option>
                        </select>
                    </div>
                    <button className="flex items-center gap-2 px-6 py-2.5 bg-primary text-white font-bold rounded-lg shadow-md hover:opacity-90 active:scale-95 transition-all">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Download FY Report
                    </button>
                    <button className="flex items-center gap-2 px-6 py-2.5 border border-border text-surface-foreground/60 font-bold rounded-lg hover:bg-primary/5 transition-all">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Detailed P&L (CSV)
                    </button>
                </div>
            </section>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Allocation Chart */}
                <div className="lg:col-span-4">
                    <AllocationChart holdings={data.holdings} />
                </div>

                {/* Internal Price Chart */}
                <div className="lg:col-span-8">
                    {selectedStock && (
                        <div className="space-y-4">
                            <div className="flex gap-2 flex-wrap mb-2">
                                {data.holdings.map((holding) => (
                                    <button
                                        key={holding.ticker}
                                        onClick={() => setSelectedStock(holding.ticker)}
                                        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${selectedStock === holding.ticker
                                            ? 'bg-primary text-white shadow-md scale-105'
                                            : 'bg-surface border border-border text-surface-foreground/60 hover:text-surface-foreground hover:bg-primary/5'
                                            }`}
                                    >
                                        {holding.ticker}
                                    </button>
                                ))}
                            </div>
                            <NSEStockChart symbol={selectedStock} />
                        </div>
                    )}
                </div>
            </div>

            {/* Holdings Table */}
            <HoldingsTable holdings={data.holdings} />

            {/* Contextual Data Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="space-y-4">
                    <h3 className="text-xl font-bold text-surface-foreground px-1">Portfolio announcements</h3>
                    <CorporateAnnouncementsWidget />
                </div>
                <div className="space-y-4">
                    <h3 className="text-xl font-bold text-surface-foreground px-1">Corporate Actions</h3>
                    {selectedStock ? (
                        <IndexCorporateActions symbol={selectedStock} />
                    ) : (
                        <div className="bg-surface rounded-xl border border-border p-8 text-center text-surface-foreground/40">
                            Select a stock to view actions
                        </div>
                    )}
                </div>
            </div>

            {/* Recommendations Section */}
            <section className="bg-gradient-to-br from-primary/10 to-indigo-500/10 rounded-3xl p-8 border border-primary/20">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                    <div>
                        <h2 className="text-2xl font-bold text-surface-foreground mb-2">Investment Recommendations</h2>
                        <p className="text-surface-foreground/60">AI-powered insights based on your current holdings and market trends</p>
                    </div>
                    <button className="px-6 py-2 bg-surface border border-primary/30 text-primary font-bold rounded-full hover:bg-primary/5 transition-colors">
                        Refresh Insights
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[
                        { ticker: 'RELIANCE', action: 'ACCUMULATE', reason: 'Strong support at 2400 level, projected 15% upside' },
                        { ticker: 'INFY', action: 'HOLD', reason: 'Q3 results awaited, maintaining neutral stance' },
                        { ticker: 'TCS', action: 'BUY', reason: 'Breakout above 3600 confirmed with high volume' }
                    ].map((rec, i) => (
                        <div key={i} className="bg-surface rounded-2xl p-6 shadow-sm border border-border hover:shadow-md transition-all group">
                            <div className="flex justify-between items-start mb-4">
                                <span className="font-bold text-lg text-surface-foreground">{rec.ticker}</span>
                                <span className={`text-xs font-bold px-3 py-1 rounded-full ${rec.action === 'BUY' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                                    {rec.action}
                                </span>
                            </div>
                            <p className="text-sm text-surface-foreground/70 leading-relaxed mb-4">{rec.reason}</p>
                            <button className="text-sm font-bold text-primary group-hover:underline">View Analysis &rarr;</button>
                        </div>
                    ))}
                </div>
            </section>

            {isPortfolioModalOpen && data && (
                <PortfolioModal
                    portfolio={{
                        id: data.id as any, // Cast if needed
                        name: data.name || "",
                        description: ""
                    }}
                    onClose={() => setIsPortfolioModalOpen(false)}
                    onUpdate={fetchPortfolioData}
                />
            )}

            {isTransactionModalOpen && data?.id && (
                <TransactionModal
                    portfolioId={data.id}
                    onClose={() => setIsTransactionModalOpen(false)}
                    onUpdate={fetchPortfolioData}
                />
            )}

            {isFundModalOpen && data?.id && (
                <FundModal
                    portfolioId={data.id}
                    onClose={() => setIsFundModalOpen(false)}
                    onUpdate={fetchPortfolioData}
                />
            )}
        </div>
    );
}
