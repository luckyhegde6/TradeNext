import cache, { hotCache, staticCache, getCacheMetrics, cleanupExpiredKeys } from '../cache';

describe('Cache System', () => {
  beforeEach(() => {
    // Clear all caches before each test
    cache.flushAll();
    hotCache.flushAll();
    staticCache.flushAll();
    jest.clearAllMocks();
  });

  describe('Basic Cache Operations', () => {
    test('should set and get values from cache', () => {
      const key = 'test-key';
      const value = { data: 'test-value' };

      cache.set(key, value, 300);
      const retrieved = cache.get(key);

      expect(retrieved).toEqual(value);
    });

    test('should return undefined for non-existent keys', () => {
      const retrieved = cache.get('non-existent-key');
      expect(retrieved).toBeUndefined();
    });

    test('should respect TTL and expire keys', async () => {
      const key = 'expiring-key';
      const value = { data: 'expires' };

      // Set with very short TTL (1 second)
      cache.set(key, value, 1);

      // Should exist immediately
      expect(cache.get(key)).toEqual(value);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should be expired
      expect(cache.get(key)).toBeUndefined();
    });

    test('should delete keys', () => {
      const key = 'delete-key';
      const value = { data: 'to-delete' };

      cache.set(key, value, 300);
      expect(cache.get(key)).toEqual(value);

      cache.del(key);
      expect(cache.get(key)).toBeUndefined();
    });
  });

  describe('Cache Metrics', () => {
    test('should return cache metrics', () => {
      const metrics = getCacheMetrics();

      expect(metrics).toHaveProperty('mainCache');
      expect(metrics).toHaveProperty('hotCache');
      expect(metrics).toHaveProperty('staticCache');

      expect(metrics.mainCache).toHaveProperty('keys');
      expect(metrics.mainCache).toHaveProperty('stats');
      expect(metrics.mainCache).toHaveProperty('hitRate');
    });

    test('should calculate hit rates correctly', () => {
      // Initially should have 0 hits/misses
      const initialMetrics = getCacheMetrics();
      expect(initialMetrics.mainCache.hitRate).toBe(0);

      // Add some data and access it
      cache.set('test-key', 'test-value', 300);
      cache.get('test-key'); // This should be a hit

      const updatedMetrics = getCacheMetrics();
      expect(updatedMetrics.mainCache.hitRate).toBeGreaterThan(0);
    });
  });

  describe('Cache Cleanup', () => {
    test('should clean up expired keys', async () => {
      // Set multiple keys with different TTLs
      cache.set('short-ttl', 'expires-quickly', 1);
      cache.set('long-ttl', 'stays-longer', 300);

      expect(cache.get('short-ttl')).toBeDefined();
      expect(cache.get('long-ttl')).toBeDefined();

      // Wait for short TTL to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Clean up expired keys
      cleanupExpiredKeys();

      expect(cache.get('short-ttl')).toBeUndefined();
      expect(cache.get('long-ttl')).toBeDefined();
    });
  });

  describe('Cache Types', () => {
    test('should use different TTL defaults for different cache types', () => {
      const value = { data: 'test' };

      // Main cache: 5 minutes default
      cache.set('main-key', value);
      expect(cache.get('main-key')).toEqual(value);

      // Hot cache: 1 minute default
      hotCache.set('hot-key', value);
      expect(hotCache.get('hot-key')).toEqual(value);

      // Static cache: 1 hour default
      staticCache.set('static-key', value);
      expect(staticCache.get('static-key')).toEqual(value);
    });
  });
});

