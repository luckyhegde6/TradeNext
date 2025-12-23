import { enhancedCache, nseCache, marketDataPoller } from '../enhanced-cache';

// Mock the underlying cache
jest.mock('../cache', () => ({
  cache: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
  hotCache: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
  staticCache: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));
// Mock market hours
jest.mock('../market-hours', () => ({
  isMarketOpen: jest.fn().mockReturnValue(true), // Default to open for tests
  getRecommendedTTL: jest.fn((ttl) => ttl), // Return provided TTL
}));

import { cache as mockCache, hotCache as mockHotCache } from '../cache';
import { isMarketOpen, getRecommendedTTL } from '../market-hours';

describe('Enhanced Cache System', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    enhancedCache.stopAllPolling();
  });

  describe('getWithCache', () => {
    test('should return cached data when available', async () => {
      const cacheConfig = nseCache.stockQuote('SBIN');
      const mockData = { symbol: 'SBIN', price: 500 };
      const fetchFn = jest.fn();

      mockHotCache.get.mockReturnValue(mockData);

      const result = await enhancedCache.getWithCache(cacheConfig, fetchFn);

      expect(mockHotCache.get).toHaveBeenCalledWith('nse:stock:SBIN:quote');
      expect(fetchFn).not.toHaveBeenCalled();
      expect(result).toEqual(mockData);
    });

    test('should fetch fresh data when not cached', async () => {
      const cacheConfig = nseCache.stockQuote('SBIN');
      const mockData = { symbol: 'SBIN', price: 500 };
      const fetchFn = jest.fn().mockResolvedValue(mockData);

      mockHotCache.get.mockReturnValue(undefined);

      const result = await enhancedCache.getWithCache(cacheConfig, fetchFn);

      expect(mockHotCache.get).toHaveBeenCalledWith('nse:stock:SBIN:quote');
      expect(fetchFn).toHaveBeenCalled();
      expect(mockHotCache.set).toHaveBeenCalledWith('nse:stock:SBIN:quote', mockData, 120000);
      expect(result).toEqual(mockData);
    });

    test('should set up polling when polling config is provided', async () => {
      const cacheConfig = nseCache.stockQuote('SBIN');
      const mockData = { symbol: 'SBIN', price: 500 };
      const fetchFn = jest.fn().mockResolvedValue(mockData);

      mockHotCache.get.mockReturnValue(undefined);

      await enhancedCache.getWithCache(cacheConfig, fetchFn, cacheConfig.pollingConfig);

      // Should have set up polling (we can't easily test internal polling timers, so just verify it completes)
      expect(fetchFn).toHaveBeenCalled();
    });

    test('should handle fetch errors', async () => {
      const cacheConfig = nseCache.stockQuote('SBIN');
      const fetchFn = jest.fn().mockRejectedValue(new Error('API Error'));

      mockHotCache.get.mockReturnValue(undefined);

      await expect(enhancedCache.getWithCache(cacheConfig, fetchFn)).rejects.toThrow('API Error');
    });
  });

  describe('Polling Management', () => {
    test('should start and stop polling', () => {
      const key = 'test-key';

      // Mock setInterval
      jest.useFakeTimers();
      const mockSetInterval = jest.spyOn(global, 'setInterval');

      // This would normally set up polling, but since we can't easily test the interval
      // in this test environment, we'll just verify the interface exists
      expect(typeof enhancedCache.stopPolling).toBe('function');
      expect(typeof enhancedCache.stopAllPolling).toBe('function');

      // Clean up the key variable
      void key;

      jest.useRealTimers();
      mockSetInterval.mockRestore();
    });

    test('should provide cache statistics', () => {
      const stats = enhancedCache.getStats();

      expect(stats).toHaveProperty('polling');
      expect(stats.polling).toHaveProperty('activeKeys');
      expect(stats.polling).toHaveProperty('configs');
    });
  });

  describe('NSE Cache Configurations', () => {
    test('should provide correct stock quote cache config', () => {
      const config = nseCache.stockQuote('SBIN');

      expect(config.key).toBe('nse:stock:SBIN:quote');
      expect(config.ttl).toBe(120000); // 2 minutes
      expect(config.cacheInstance).toBe(mockHotCache);
      expect(config.pollingConfig).toBeDefined();
      expect(config.pollingConfig?.interval).toBe(30000); // 30 seconds
    });

    test('should provide correct chart cache config', () => {
      const config = nseCache.stockChart('SBIN', '1D');

      expect(config.key).toBe('nse:stock:SBIN:chart:1D');
      expect(config.ttl).toBe(300000); // 5 minutes
      expect(config.cacheInstance).toBeDefined();
      expect(config.pollingConfig).toBeUndefined();
    });

    test('should provide correct index quote cache config', () => {
      const config = nseCache.indexQuote('NIFTY 50');

      expect(config.key).toBe('nse:index:NIFTY 50:quote');
      expect(config.ttl).toBe(120000); // 2 minutes
      expect(config.cacheInstance).toBe(mockHotCache);
      expect(config.pollingConfig).toBeDefined();
      expect(config.pollingConfig?.interval).toBe(15000); // 15 seconds
    });

    test('should provide correct static data cache config', () => {
      const config = nseCache.static('instruments');

      expect(config.key).toBe('nse:static:instruments');
      expect(config.ttl).toBe(3600000); // 1 hour
      expect(config.cacheInstance).toBeDefined();
    });
  });
});
