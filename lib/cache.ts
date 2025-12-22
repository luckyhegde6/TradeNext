// lib/cache.ts
import NodeCache from "node-cache";

// Server-side cache configuration optimized for production
const cache = new NodeCache({
  stdTTL: 300,        // 5 minutes default TTL
  checkperiod: 600,   // Check for expired keys every 10 minutes
  maxKeys: 1000,      // Maximum number of keys to store
  useClones: false,   // Don't clone objects for better performance
  deleteOnExpire: true, // Delete expired keys automatically
});

// Separate cache for frequently accessed data
const hotCache = new NodeCache({
  stdTTL: 60,         // 1 minute for hot data
  checkperiod: 120,   // Check every 2 minutes
  maxKeys: 500,       // Smaller cache for hot data
  useClones: false,
  deleteOnExpire: true,
});

// Cache for static/reference data
const staticCache = new NodeCache({
  stdTTL: 3600,       // 1 hour for static data
  checkperiod: 1800,  // Check every 30 minutes
  maxKeys: 200,       // Smaller cache for static data
  useClones: false,
  deleteOnExpire: true,
});

// Export cache instances
export { hotCache, staticCache };
export default cache;

// Cache monitoring utilities
export const getCacheMetrics = () => ({
  mainCache: {
    keys: cache.keys().length,
    stats: cache.getStats(),
    hitRate: cache.getStats().hits / (cache.getStats().hits + cache.getStats().misses) || 0,
  },
  hotCache: {
    keys: hotCache.keys().length,
    stats: hotCache.getStats(),
    hitRate: hotCache.getStats().hits / (hotCache.getStats().hits + hotCache.getStats().misses) || 0,
  },
  staticCache: {
    keys: staticCache.keys().length,
    stats: staticCache.getStats(),
    hitRate: staticCache.getStats().hits / (staticCache.getStats().hits + staticCache.getStats().misses) || 0,
  },
});

// Cache cleanup utilities
// Note: NodeCache automatically handles expired key cleanup
export const cleanupExpiredKeys = () => {
  // NodeCache handles expiration automatically when keys are accessed
  // No manual pruning needed - this function is a no-op
};

// Clear all caches (useful for development/testing)
export const clearAllCaches = () => {
  cache.flushAll();
  hotCache.flushAll();
  staticCache.flushAll();
};

// Cache statistics for monitoring
export const getCacheStats = () => ({
  main: {
    keys: cache.keys().length,
    stats: cache.getStats(),
  },
  hot: {
    keys: hotCache.keys().length,
    stats: hotCache.getStats(),
  },
  static: {
    keys: staticCache.keys().length,
    stats: staticCache.getStats(),
  },
});
