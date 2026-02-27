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
import UserAlertModal from '../components/modals/UserAlertModal';

interface StockRecommendation {
    id: string;
    symbol: string;
    recommendation: string;
    targetPrice: number | null;
    profitRangeMin: number | null;
    profitRangeMax: number | null;
    analystRating: string | null;
    analysis: string | null;
    imageUrl: string | null;
}

interface UserAlert {
    id: string;
    symbol: string | null;
    alertType: string;
    title: string;
    message: string | null;
    targetPrice: number | null;
    currentPrice: number | null;
    status: string;
    triggeredAt: string | null;
    createdAt: string;
}

export default function PortfolioClient() {
    const [data, setData] = useState<PortfolioSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedStock, setSelectedStock] = useState<string | null>(null);
    const [isPortfolioModalOpen, setIsPortfolioModalOpen] = useState(false);
    const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
    const [isFundModalOpen, setIsFundModalOpen] = useState(false);
    const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
    const [recommendations, setRecommendations] = useState<StockRecommendation[]>([]);
    const [alerts, setAlerts] = useState<UserAlert[]>([]);
    const [loadingRecommendations, setLoadingRecommendations] = useState(false);
    const [loadingAlerts, setLoadingAlerts] = useState(false);

    useEffect(() => {
        fetchPortfolioData();
        fetchRecommendations();
        fetchAlerts();
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

    const fetchRecommendations = async () => {
        try {
            setLoadingRecommendations(true);
            const response = await fetch('/api/user/recommendations');
            if (response.ok) {
                const data = await response.json();
                setRecommendations(data);
            }
        } catch (err) {
            console.error('Recommendations fetch error:', err);
        } finally {
            setLoadingRecommendations(false);
        }
    };

    const fetchAlerts = async () => {
        try {
            setLoadingAlerts(true);
            const response = await fetch('/api/user/alerts?today=true');
            if (response.ok) {
                const data = await response.json();
                setAlerts(data);
            }
        } catch (err) {
            console.error('Alerts fetch error:', err);
        } finally {
            setLoadingAlerts(false);
        }
    };

    const handleDismissAlert = async (alertId: string) => {
        try {
            await fetch(`/api/user/alerts?id=${alertId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'dismissed' }),
            });
            fetchAlerts();
        } catch (err) {
            console.error('Failed to dismiss alert:', err);
        }
    };

    const getRecommendationColor = (rec: string) => {
        switch (rec) {
            case 'BUY':
            case 'ACCUMULATE':
                return 'bg-green-100 text-green-700';
            case 'SELL':
                return 'bg-red-100 text-red-700';
            case 'HOLD':
                return 'bg-yellow-100 text-yellow-700';
            default:
                return 'bg-gray-100 text-gray-700';
        }
    };

    const getAlertStatusColor = (status: string) => {
        switch (status) {
            case 'triggered':
                return 'bg-red-100 text-red-700';
            case 'active':
                return 'bg-green-100 text-green-700';
            case 'dismissed':
                return 'bg-gray-100 text-gray-700';
            default:
                return 'bg-gray-100 text-gray-700';
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
                        <p className="text-surface-foreground/60">Expert insights and recommendations for your portfolio</p>
                    </div>
                    <button 
                        onClick={fetchRecommendations}
                        disabled={loadingRecommendations}
                        className="px-6 py-2 bg-surface border border-primary/30 text-primary font-bold rounded-full hover:bg-primary/5 transition-colors disabled:opacity-50"
                    >
                        {loadingRecommendations ? 'Loading...' : 'Refresh Insights'}
                    </button>
                </div>

                {loadingRecommendations ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {[...Array(3)].map((_, i) => (
                            <div key={i} className="bg-surface rounded-2xl p-6 animate-pulse">
                                <div className="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
                                <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                            </div>
                        ))}
                    </div>
                ) : recommendations.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {recommendations.slice(0, 6).map((rec) => (
                            <div key={rec.id} className="bg-surface rounded-2xl p-6 shadow-sm border border-border hover:shadow-md transition-all group">
                                <div className="flex justify-between items-start mb-4">
                                    <span className="font-bold text-lg text-surface-foreground">{rec.symbol}</span>
                                    <span className={`text-xs font-bold px-3 py-1 rounded-full ${getRecommendationColor(rec.recommendation)}`}>
                                        {rec.recommendation}
                                    </span>
                                </div>
                                {rec.targetPrice && (
                                    <p className="text-sm text-surface-foreground/70 mb-2">Target: ₹{rec.targetPrice}</p>
                                )}
                                {rec.profitRangeMin && rec.profitRangeMax && (
                                    <p className="text-sm text-surface-foreground/70 mb-2">Profit: ₹{rec.profitRangeMin} - ₹{rec.profitRangeMax}</p>
                                )}
                                {rec.analystRating && (
                                    <p className="text-sm text-surface-foreground/70 mb-2">Rating: {rec.analystRating}</p>
                                )}
                                <p className="text-sm text-surface-foreground/70 leading-relaxed mb-4 line-clamp-3">{rec.analysis || 'No analysis available'}</p>
                                <button className="text-sm font-bold text-primary group-hover:underline">View Analysis &rarr;</button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-8 text-surface-foreground/60">
                        <p>No recommendations available at the moment.</p>
                    </div>
                )}
            </section>

            {/* My Alerts Section */}
            <section className="bg-surface rounded-3xl p-8 border border-border shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                    <div>
                        <h2 className="text-2xl font-bold text-surface-foreground mb-2">My Alerts</h2>
                        <p className="text-surface-foreground/60">Price alerts and notifications for today</p>
                    </div>
                    <div className="flex gap-3">
                        <button 
                            onClick={fetchAlerts}
                            disabled={loadingAlerts}
                            className="px-4 py-2 border border-border text-surface-foreground/60 text-sm font-bold rounded-lg hover:bg-primary/5 transition-all disabled:opacity-50"
                        >
                            {loadingAlerts ? 'Loading...' : 'Refresh'}
                        </button>
                        <button 
                            onClick={() => setIsAlertModalOpen(true)}
                            className="px-4 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:opacity-90 transition-all"
                        >
                            Create Alert
                        </button>
                    </div>
                </div>

                {loadingAlerts ? (
                    <div className="space-y-4">
                        {[...Array(3)].map((_, i) => (
                            <div key={i} className="bg-surface border border-border rounded-xl p-4 animate-pulse">
                                <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                            </div>
                        ))}
                    </div>
                ) : alerts.length > 0 ? (
                    <div className="space-y-4">
                        {alerts.slice(0, 5).map((alert) => (
                            <div key={alert.id} className="bg-surface border border-border rounded-xl p-4 hover:shadow-md transition-all">
                                <div className="flex justify-between items-start">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-3 mb-2">
                                            {alert.symbol && (
                                                <span className="font-bold text-surface-foreground">{alert.symbol}</span>
                                            )}
                                            <span className={`text-xs font-bold px-2 py-1 rounded-full ${getAlertStatusColor(alert.status)}`}>
                                                {alert.status}
                                            </span>
                                            <span className="text-xs text-surface-foreground/60">
                                                {alert.alertType.replace('_', ' ')}
                                            </span>
                                        </div>
                                        <h4 className="font-semibold text-surface-foreground mb-1">{alert.title}</h4>
                                        {alert.message && (
                                            <p className="text-sm text-surface-foreground/70 mb-2">{alert.message}</p>
                                        )}
                                        <div className="flex gap-4 text-xs text-surface-foreground/60">
                                            {alert.targetPrice && <span>Target: ₹{alert.targetPrice}</span>}
                                            {alert.currentPrice && <span>Current: ₹{alert.currentPrice}</span>}
                                            {alert.triggeredAt && <span>Triggered: {new Date(alert.triggeredAt).toLocaleTimeString()}</span>}
                                            <span>Created: {new Date(alert.createdAt).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        {alert.status === 'active' && (
                                            <button
                                                onClick={() => handleDismissAlert(alert.id)}
                                                className="text-xs text-surface-foreground/60 hover:text-surface-foreground px-2 py-1"
                                            >
                                                Dismiss
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-8 text-surface-foreground/60">
                        <p>No alerts for today. Create an alert to get notified.</p>
                    </div>
                )}
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

            {isAlertModalOpen && (
                <UserAlertModal
                    onClose={() => setIsAlertModalOpen(false)}
                    onUpdate={fetchAlerts}
                />
            )}
        </div>
    );
}
