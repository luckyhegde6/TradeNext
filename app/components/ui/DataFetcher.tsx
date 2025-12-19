"use client";

import React from 'react';
import { useApi, usePaginatedApi, usePollingApi } from '@/lib/hooks/useApi';
import { LoadingSpinner, Skeleton } from './LoadingSpinner';

interface DataFetcherProps<T> {
  apiCall: () => Promise<T>;
  cacheKey?: string;
  cacheTTL?: number;
  enableCache?: boolean;
  loadingComponent?: React.ComponentType<{ message?: string }>;
  errorComponent?: React.ComponentType<{ error: string; onRetry: () => void }>;
  emptyComponent?: React.ComponentType;
  children: (data: T) => React.ReactNode;
}

export function DataFetcher<T>({
  apiCall,
  cacheKey,
  cacheTTL,
  enableCache = true,
  loadingComponent: LoadingComponent = LoadingSpinner,
  errorComponent: ErrorComponent,
  emptyComponent: EmptyComponent,
  children
}: DataFetcherProps<T>) {
  const { data, loading, error, refetch } = useApi(
    apiCall,
    { cacheKey, cacheTTL, enableCache }
  );

  if (loading) {
    return <LoadingComponent message="Loading data..." />;
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

  return <>{children(data)}</>;
}

// Paginated data fetcher
interface PaginatedDataFetcherProps<T> {
  apiCall: (page: number, limit: number) => Promise<{ items: T[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>;
  initialPage?: number;
  limit?: number;
  cacheKey?: string;
  loadingComponent?: React.ComponentType;
  errorComponent?: React.ComponentType<{ error: string; onRetry: () => void }>;
  children: (data: { items: T[]; pagination: { page: number; limit: number; total: number; totalPages: number }; loadMore: () => void; hasMore: boolean }) => React.ReactNode;
}

export function PaginatedDataFetcher<T>({
  apiCall,
  initialPage = 1,
  limit = 20,
  cacheKey,
  loadingComponent: LoadingComponent = Skeleton,
  errorComponent: ErrorComponent,
  children
}: PaginatedDataFetcherProps<T>) {
  const { data, loading, error, refetch, loadMore, hasMore } = usePaginatedApi(
    apiCall,
    { page: initialPage, limit, cacheKey }
  );

  if (loading && !data) {
    return <LoadingComponent />;
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

  return <>{children({ ...data, loadMore, hasMore })}</>;
}

// Real-time data fetcher with polling
interface RealtimeDataFetcherProps<T> {
  apiCall: () => Promise<T>;
  pollInterval?: number;
  cacheKey?: string;
  loadingComponent?: React.ComponentType<{ message?: string }>;
  errorComponent?: React.ComponentType<{ error: string; onRetry: () => void }>;
  children: (data: T) => React.ReactNode;
}

export function RealtimeDataFetcher<T>({
  apiCall,
  pollInterval = 30000,
  cacheKey,
  loadingComponent: LoadingComponent = LoadingSpinner,
  errorComponent: ErrorComponent,
  children
}: RealtimeDataFetcherProps<T>) {
  const { data, loading, error, refetch } = usePollingApi(
    apiCall,
    pollInterval,
    { cacheKey }
  );

  if (loading && !data) {
    return <LoadingComponent message="Connecting..." />;
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

  return <>{children(data)}</>;
}

// Specific component for market data that handles connection states
interface MarketDataFetcherProps {
  symbol: string;
  children: (data: unknown) => React.ReactNode;
}

export function MarketDataFetcher({ symbol, children }: MarketDataFetcherProps) {
  return (
    <RealtimeDataFetcher
      apiCall={async () => {
        const response = await fetch(`/api/nse/stock/${symbol}/quote`);
        if (!response.ok) throw new Error('Failed to fetch market data');
        return response.json();
      }}
      pollInterval={15000} // 15 seconds for market data
      cacheKey={`market:stock:${symbol}`}
    >
      {(data) => children(data)}
    </RealtimeDataFetcher>
  );
}
