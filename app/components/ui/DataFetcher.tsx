"use client";

import React from 'react';
import { useApi, usePaginatedApi, usePollingApi } from '@/lib/hooks/useApi';
import { LoadingSpinner, Skeleton } from './LoadingSpinner';

interface DataFetcherProps<T> {
  apiUrl: string;
  cacheKey?: string;
  cacheTTL?: number;
  enableCache?: boolean;
  loadingComponent?: 'spinner' | 'skeleton';
  errorComponent?: React.ComponentType<{ error: string; onRetry: () => void }>;
  emptyComponent?: React.ComponentType;
  render: (data: T) => React.ReactNode;
}

export function DataFetcher<T>({
  apiUrl,
  cacheKey,
  cacheTTL,
  enableCache = true,
  loadingComponent = 'spinner',
  errorComponent: ErrorComponent,
  emptyComponent: EmptyComponent,
  render
}: DataFetcherProps<T>) {
  const apiCall = async () => {
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error('Failed to fetch data');
    return res.json();
  };

  const { data, loading, error, refetch } = useApi(
    apiCall,
    { cacheKey, cacheTTL, enableCache }
  );

  if (loading) {
    return loadingComponent === 'skeleton' ? <Skeleton /> : <LoadingSpinner message="Loading data..." />;
  }

  if (error) {
    if (ErrorComponent) {
      return <ErrorComponent error={error} onRetry={refetch} />;
    }

    return (
      <div className="text-center p-6">
        <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
        <button
          onClick={refetch}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (!data) {
    if (EmptyComponent) {
      return <EmptyComponent />;
    }
    return <div className="text-center p-6 text-gray-500">No data available</div>;
  }

  return <>{render(data)}</>;
}

// Paginated data fetcher
interface PaginatedDataFetcherProps<T> {
  apiUrl: string;
  initialPage?: number;
  limit?: number;
  cacheKey?: string;
  loadingComponent?: 'spinner' | 'skeleton';
  errorComponent?: React.ComponentType<{ error: string; onRetry: () => void }>;
  render: (data: { items: T[]; pagination: { page: number; limit: number; total: number; totalPages: number }; loadMore: () => void; hasMore: boolean }) => React.ReactNode;
}

export function PaginatedDataFetcher<T>({
  apiUrl,
  initialPage = 1,
  limit = 20,
  cacheKey,
  loadingComponent = 'skeleton',
  errorComponent: ErrorComponent,
  render
}: PaginatedDataFetcherProps<T>) {
  const apiCall = async (page: number, limit: number) => {
    const url = new URL(apiUrl);
    url.searchParams.set('page', page.toString());
    url.searchParams.set('limit', limit.toString());
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('Failed to fetch data');
    return res.json();
  };

  const { data, loading, error, refetch, loadMore, hasMore } = usePaginatedApi(
    apiCall,
    { page: initialPage, limit, cacheKey }
  );

  if (loading && !data) {
    return loadingComponent === 'spinner' ? <LoadingSpinner /> : <Skeleton />;
  }

  if (error) {
    if (ErrorComponent) {
      return <ErrorComponent error={error} onRetry={refetch} />;
    }

    return (
      <div className="text-center p-6">
        <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
        <button
          onClick={refetch}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (!data) {
    return <div className="text-center p-6 text-gray-500">No data available</div>;
  }

  return <>{render({ items: data.items as T[], pagination: data.pagination, loadMore, hasMore })}</>;
}

// Real-time data fetcher with polling
interface RealtimeDataFetcherProps<T> {
  apiUrl: string;
  pollInterval?: number;
  cacheKey?: string;
  loadingComponent?: 'spinner' | 'skeleton';
  errorComponent?: React.ComponentType<{ error: string; onRetry: () => void }>;
  render: (data: T) => React.ReactNode;
}

export function RealtimeDataFetcher<T>({
  apiUrl,
  pollInterval = 30000,
  cacheKey,
  loadingComponent = 'spinner',
  errorComponent: ErrorComponent,
  render
}: RealtimeDataFetcherProps<T>) {
  const apiCall = async () => {
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error('Failed to fetch data');
    return res.json();
  };

  const { data, loading, error, refetch } = usePollingApi(
    apiCall,
    pollInterval,
    { cacheKey }
  );

  if (loading && !data) {
    return loadingComponent === 'skeleton' ? <Skeleton /> : <LoadingSpinner message="Connecting..." />;
  }

  if (error) {
    if (ErrorComponent) {
      return <ErrorComponent error={error} onRetry={refetch} />;
    }

    return (
      <div className="text-center p-6">
        <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
        <button
          onClick={refetch}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (!data) {
    return <div className="text-center p-6 text-gray-500">No data available</div>;
  }

  return <>{render(data)}</>;
}

// Specific component for market data that handles connection states
interface MarketDataFetcherProps {
  symbol: string;
  render: (data: unknown) => React.ReactNode;
}

export function MarketDataFetcher({ symbol, render }: MarketDataFetcherProps) {
  return (
    <RealtimeDataFetcher
      apiUrl={`/api/nse/stock/${symbol}/quote`}
      pollInterval={15000} // 15 seconds for market data
      cacheKey={`market:stock:${symbol}`}
      render={(data) => render(data)}
    />
  );
}
