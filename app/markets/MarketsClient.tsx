"use client";

import { useState } from 'react';
import Link from 'next/link';

interface PiotroskiCheck {
    key: string;
    ok: boolean;
    explain: string;
}

interface PiotroskiResult {
    ticker: string;
    score: number;
    checks: PiotroskiCheck[];
    asOf: string;
}

export default function MarketsClient() {
    const [ticker, setTicker] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [piotroskiData, setPiotroskiData] = useState<PiotroskiResult | null>(null);
    const [ingestStatus, setIngestStatus] = useState('');

    const handleAnalyze = async () => {
        if (!ticker.trim()) {
            setError('Please enter a ticker symbol');
            return;
        }

        setLoading(true);
        setError('');
        setPiotroskiData(null);
        setIngestStatus('');

        try {
            const upperTicker = ticker.toUpperCase();

            // Step 1: Check if we have data, if not suggest ingestion
            setIngestStatus('Checking for existing data...');
            const checkRes = await fetch(`/api/piotroski/${upperTicker}`);

            if (checkRes.ok) {
                const data = await checkRes.json();
                setPiotroskiData(data);
                setIngestStatus('Analysis complete!');
            } else {
                setIngestStatus('No data found. Please ingest data first using the API endpoints.');
                setError('No fundamental data available for this ticker. You may need to ingest data first.');
            }
        } catch (err) {
            console.error('Analysis error:', err);
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

    const getScoreColor = (score: number) => {
        if (score >= 7) return 'text-green-600 dark:text-green-400';
        if (score >= 4) return 'text-yellow-600 dark:text-yellow-400';
        return 'text-red-600 dark:text-red-400';
    };

    const getScoreBgColor = (score: number) => {
        if (score >= 7) return 'bg-green-100 dark:bg-green-900/30';
        if (score >= 4) return 'bg-yellow-100 dark:bg-yellow-900/30';
        return 'bg-red-100 dark:bg-red-900/30';
    };

    return (
        <div className="space-y-8">
            {/* Search Section */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                <div className="flex gap-4">
                    <input
                        type="text"
                        value={ticker}
                        onChange={(e) => setTicker(e.target.value.toUpperCase())}
                        onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                        placeholder="Enter ticker symbol (e.g., RELIANCE, TCS)"
                        className="flex-1 px-4 py-3 border border-gray-300 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500"
                    />
                    <button
                        onClick={handleAnalyze}
                        disabled={loading}
                        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium rounded-lg transition-colors shadow-sm hover:shadow-md disabled:cursor-not-allowed"
                    >
                        {loading ? 'Analyzing...' : 'Analyze'}
                    </button>
                </div>

                {ingestStatus && (
                    <p className="mt-4 text-sm text-gray-600 dark:text-slate-400">
                        {ingestStatus}
                    </p>
                )}

                {error && (
                    <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                    </div>
                )}
            </div>

            {/* API Documentation */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">
                    Data Ingestion & Analysis
                </h2>
                <div className="space-y-4 text-sm">
                    <div>
                        <h3 className="font-medium text-gray-900 dark:text-white mb-2">
                            1. Ingest Price Data
                        </h3>
                        <code className="block bg-gray-100 dark:bg-slate-800 p-3 rounded text-xs overflow-x-auto">
                            POST /api/ingest/run
                        </code>
                        <p className="mt-2 text-gray-600 dark:text-slate-400">
                            Ingests daily price data from CSV file into the database
                        </p>
                    </div>

                    <div>
                        <h3 className="font-medium text-gray-900 dark:text-white mb-2">
                            2. Piotroski F-Score Analysis
                        </h3>
                        <code className="block bg-gray-100 dark:bg-slate-800 p-3 rounded text-xs overflow-x-auto">
                            GET /api/piotroski/[TICKER]
                        </code>
                        <p className="mt-2 text-gray-600 dark:text-slate-400">
                            Calculates the Piotroski F-Score (0-9) based on fundamental data
                        </p>
                    </div>

                    <div>
                        <h3 className="font-medium text-gray-900 dark:text-white mb-2">
                            3. View Company Details
                        </h3>
                        <p className="text-gray-600 dark:text-slate-400">
                            After analysis, view detailed charts at{' '}
                            <Link href="/company/RELIANCE" className="text-blue-600 hover:text-blue-700 dark:text-blue-400">
                                /company/[TICKER]
                            </Link>
                        </p>
                    </div>
                </div>
            </div>

            {/* Piotroski Results */}
            {piotroskiData && (
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                                {piotroskiData.ticker}
                            </h2>
                            <p className="text-sm text-gray-500 dark:text-slate-500">
                                As of: {new Date(piotroskiData.asOf).toLocaleDateString()}
                            </p>
                        </div>
                        <div className={`${getScoreBgColor(piotroskiData.score)} px-6 py-4 rounded-lg`}>
                            <div className="text-center">
                                <div className={`text-4xl font-bold ${getScoreColor(piotroskiData.score)}`}>
                                    {piotroskiData.score}
                                </div>
                                <div className="text-xs text-gray-600 dark:text-slate-400 mt-1">
                                    F-Score / 9
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <h3 className="font-semibold text-gray-900 dark:text-white mb-4">
                            Piotroski Checks
                        </h3>
                        {piotroskiData.checks.map((check, idx) => (
                            <div
                                key={idx}
                                className={`flex items-start gap-3 p-3 rounded-lg ${check.ok
                                        ? 'bg-green-50 dark:bg-green-900/20'
                                        : 'bg-red-50 dark:bg-red-900/20'
                                    }`}
                            >
                                <div className="flex-shrink-0 mt-0.5">
                                    {check.ok ? (
                                        <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                        </svg>
                                    ) : (
                                        <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                        </svg>
                                    )}
                                </div>
                                <div className="flex-1">
                                    <div className="font-medium text-sm text-gray-900 dark:text-white">
                                        {check.key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                    </div>
                                    <div className="text-xs text-gray-600 dark:text-slate-400 mt-1">
                                        {check.explain}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="mt-6 pt-6 border-t border-gray-200 dark:border-slate-800">
                        <Link
                            href={`/company/${piotroskiData.ticker}`}
                            className="inline-flex items-center justify-center px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors shadow-sm hover:shadow-md"
                        >
                            View Detailed Charts →
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
}
