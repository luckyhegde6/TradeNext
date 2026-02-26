'use client';

import { useState, useEffect } from 'react';

interface FScoreCriteria {
  name: string;
  value: number | null;
  threshold: string;
  passed: boolean;
  description: string;
}

interface FScoreBreakdown {
  score: number;
  maxScore: number;
  profitability: number;
  leverage: number;
  efficiency: number;
  criteria: FScoreCriteria[];
  interpretation: string;
  isMock?: boolean;
  message?: string;
}

interface Props {
  symbol: string;
}

export default function PiotroskiFScore({ symbol }: Props) {
  const [data, setData] = useState<FScoreBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchFScore() {
      try {
        setLoading(true);
        const res = await fetch(`/api/company/${symbol}/fscore`);
        if (!res.ok) throw new Error('Failed to fetch F-Score');
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    if (symbol) fetchFScore();
  }, [symbol]);

  const getScoreColor = (score: number) => {
    if (score >= 7) return 'bg-green-600';
    if (score >= 5) return 'bg-green-400';
    if (score >= 3) return 'bg-yellow-400';
    if (score >= 1) return 'bg-orange-400';
    return 'bg-red-500';
  };

  const getScoreTextColor = (score: number) => {
    if (score >= 7) return 'text-green-600 dark:text-green-400';
    if (score >= 5) return 'text-green-500 dark:text-green-400';
    if (score >= 3) return 'text-yellow-600 dark:text-yellow-400';
    if (score >= 1) return 'text-orange-600 dark:text-orange-400';
    return 'text-red-600 dark:text-red-400';
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-800 p-6">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Piotroski F-Score</h3>
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-1/2"></div>
          <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-2/3"></div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-800 p-6">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Piotroski F-Score</h3>
        <p className="text-gray-500 dark:text-gray-400">Unable to load F-Score data</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">Piotroski F-Score</h3>
        {data.isMock && (
          <span className="text-xs bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 px-2 py-1 rounded">
            Demo Data
          </span>
        )}
      </div>

      {data.message && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{data.message}</p>
      )}

      <div className="flex items-center gap-6 mb-6">
        <div className={`w-20 h-20 rounded-full flex items-center justify-center ${getScoreColor(data.score)}`}>
          <span className="text-3xl font-bold text-white">{data.score}</span>
        </div>
        <div>
          <p className={`text-lg font-semibold ${getScoreTextColor(data.score)}`}>
            {data.interpretation}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Profitability: {data.profitability}/4 | Leverage: {data.leverage}/3 | Efficiency: {data.efficiency}/2
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <h4 className="font-medium text-gray-700 dark:text-gray-300 border-b pb-1">Profitability</h4>
          {data.criteria.slice(0, 4).map((criterion, idx) => (
            <div key={idx} className="flex items-center justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400" title={criterion.description}>
                {criterion.name}
              </span>
              <span className={criterion.passed ? 'text-green-600 dark:text-green-400' : 'text-red-500'}>
                {criterion.passed ? '✓' : '✗'}
              </span>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <h4 className="font-medium text-gray-700 dark:text-gray-300 border-b pb-1">Leverage</h4>
          {data.criteria.slice(4, 7).map((criterion, idx) => (
            <div key={idx} className="flex items-center justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400" title={criterion.description}>
                {criterion.name}
              </span>
              <span className={criterion.passed ? 'text-green-600 dark:text-green-400' : 'text-red-500'}>
                {criterion.passed ? '✓' : '✗'}
              </span>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <h4 className="font-medium text-gray-700 dark:text-gray-300 border-b pb-1">Efficiency</h4>
          {data.criteria.slice(7, 9).map((criterion, idx) => (
            <div key={idx} className="flex items-center justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400" title={criterion.description}>
                {criterion.name}
              </span>
              <span className={criterion.passed ? 'text-green-600 dark:text-green-400' : 'text-red-500'}>
                {criterion.passed ? '✓' : '✗'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
