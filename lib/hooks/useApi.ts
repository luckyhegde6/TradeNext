"use client";

// Custom hooks for API calls with loading states and error handling
import { useState, useEffect, useCallback } from 'react';
// import { clientCache } from '@/lib/client-cache'; // Temporarily disabled due to Turbopack issues

interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

interface UseApiOptions {
  cacheKey?: string;
  cacheTTL?: number;
  enableCache?: boolean;
}

export function useApi<T>(
  apiCall: () => Promise<T>,
  options: UseApiOptions = {}
): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { cacheKey, cacheTTL = 300000, enableCache = true } = options;

  const executeApiCall = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let result: T;

      // Try to get from cache first
      // Temporarily disabled due to Turbopack issues
      /*
      if (enableCache && cacheKey) {
        const cachedData = clientCache.marketData.get<T>(cacheKey);
        if (cachedData !== null) {
          result = cachedData;
          setData(result);
          setLoading(false);
          return;
        }
      }
      */

      // Make API call
      result = await apiCall();

      // Cache the result
      // Temporarily disabled due to Turbopack issues
      /*
      if (enableCache && cacheKey) {
        clientCache.marketData.set(cacheKey, result, cacheTTL);
      }
      */

      setData(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred';
      setError(errorMessage);
      console.error('API call failed:', err);
    } finally {
      setLoading(false);
    }
  }, [apiCall, cacheKey, cacheTTL, enableCache]);

  useEffect(() => {
    executeApiCall();
  }, [executeApiCall]);

  return {
    data,
    loading,
    error,
    refetch: executeApiCall
  };
}

// Hook for paginated data
interface PaginatedData<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface UsePaginatedApiOptions extends UseApiOptions {
  page: number;
  limit: number;
}

export function usePaginatedApi<T>(
  apiCall: (page: number, limit: number) => Promise<PaginatedData<T>>,
  options: UsePaginatedApiOptions
): ApiState<PaginatedData<T>> & {
  loadMore: () => void;
  hasMore: boolean;
  currentPage: number;
} {
  const { page, limit, cacheKey, ...apiOptions } = options;
  const [currentPage, setCurrentPage] = useState(page);
  const [allData, setAllData] = useState<T[]>([]);
  const [hasMore, setHasMore] = useState(true);

  const apiState = useApi(
    () => apiCall(currentPage, limit),
    {
      ...apiOptions,
      cacheKey: cacheKey ? `${cacheKey}_${currentPage}_${limit}` : undefined
    }
  );

  useEffect(() => {
    if (apiState.data && !apiState.loading) {
      if (currentPage === 1) {
        // First page, replace data
        setAllData(apiState.data.items);
      } else {
        // Subsequent pages, append data
        setAllData(prev => [...prev, ...(apiState.data?.items || [])]);
      }
      setHasMore(currentPage < (apiState.data?.pagination.totalPages || 0));
    }
  }, [apiState.data, apiState.loading, currentPage]);

  const loadMore = useCallback(() => {
    if (!apiState.loading && hasMore) {
      setCurrentPage(prev => prev + 1);
    }
  }, [apiState.loading, hasMore]);

  return {
    ...apiState,
    data: apiState.data ? { ...apiState.data, items: allData } : null,
    loadMore,
    hasMore,
    currentPage
  };
}

// Hook for real-time data with polling
export function usePollingApi<T>(
  apiCall: () => Promise<T>,
  interval: number = 30000, // 30 seconds
  options: UseApiOptions = {}
): ApiState<T> & { stopPolling: () => void; startPolling: () => void } {
  const apiState = useApi(apiCall, options);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      setPollingInterval(null);
    }
  }, [pollingInterval]);

  const startPolling = useCallback(() => {
    stopPolling(); // Clear any existing interval
    const intervalId = setInterval(() => {
      apiState.refetch();
    }, interval);
    setPollingInterval(intervalId);
  }, [apiState, interval, stopPolling]);

  useEffect(() => {
    startPolling();
    return stopPolling;
  }, [startPolling, stopPolling]);

  return {
    ...apiState,
    stopPolling,
    startPolling
  };
}
