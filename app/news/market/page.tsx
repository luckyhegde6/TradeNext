'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface NewsItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: string;
  symbol?: string;
}

export default function MarketNewsPage() {
  const [activeTab, setActiveTab] = useState<'india' | 'global'>('india');
  const [indiaNews, setIndiaNews] = useState<NewsItem[]>([]);
  const [globalNews, setGlobalNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchNews() {
      try {
        setLoading(true);
        const res = await fetch('/api/news/market?force=true');
        const data = await res.json();
        if (data.india) setIndiaNews(data.india);
        if (data.global) setGlobalNews(data.global);
      } catch (error) {
        console.error('Failed to fetch news:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchNews();
  }, []);

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);

      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  const news = activeTab === 'india' ? indiaNews : globalNews;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Market News</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Latest market news and updates from India and around the world
          </p>
        </div>

        <div className="mb-6">
          <div className="border-b border-gray-200 dark:border-slate-700">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('india')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'india'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span>🇮🇳</span>
                  India
                </span>
              </button>
              <button
                onClick={() => setActiveTab('global')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'global'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span>🌍</span>
                  Global
                </span>
              </button>
            </nav>
          </div>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="bg-white dark:bg-slate-900 rounded-lg p-6 animate-pulse"
              >
                <div className="h-6 bg-gray-200 dark:bg-slate-700 rounded w-3/4 mb-3"></div>
                <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-full mb-2"></div>
                <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-2/3"></div>
              </div>
            ))}
          </div>
        ) : news.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-lg p-12 text-center">
            <p className="text-gray-500 dark:text-gray-400">No news available at the moment</p>
          </div>
        ) : (
          <div className="space-y-4">
            {news.map((item) => (
              <article
                key={item.id}
                className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-800 p-6 hover:shadow-md transition-shadow"
              >
                <a 
                  href={item.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="block"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400 mb-2">
                        <span className="font-medium text-blue-600 dark:text-blue-400">
                          {item.source}
                        </span>
                        <span>•</span>
                        <span>{formatDate(item.publishedAt)}</span>
                        {item.symbol && (
                          <>
                            <span>•</span>
                            <Link
                              href={`/company/${item.symbol}`}
                              className="text-blue-600 dark:text-blue-400 hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {item.symbol}
                          </Link>
                        </>
                      )}
                    </div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2 hover:text-blue-600 dark:hover:text-blue-400">
                      {item.title}
                    </h2>
                    <p className="text-gray-600 dark:text-gray-300 text-sm line-clamp-2">
                      {item.summary}
                    </p>
                  </div>
                </div>
              </a>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
