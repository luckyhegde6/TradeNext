// Client-side caching utilities using IndexedDB and localStorage
// This runs in the browser

interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

class IndexedDBCache {
  private dbName = 'TradeNextCache';
  private version = 1;
  private storeName = 'cache';

  private async openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
    });
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const db = await this.openDB();
      return new Promise((resolve) => {
        const transaction = db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(key);

        request.onsuccess = () => {
          const entry: CacheEntry<T> | undefined = request.result;
          if (entry && Date.now() - entry.timestamp < entry.ttl) {
            resolve(entry.data);
          } else {
            resolve(null);
          }
        };

        request.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  async set<T>(key: string, data: T, ttl: number = 300000): Promise<void> {
    try {
      const db = await this.openDB();
      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
        ttl
      };

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.put(entry, key);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn('IndexedDB cache set failed:', error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.delete(key);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn('IndexedDB cache delete failed:', error);
    }
  }

  async clear(): Promise<void> {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn('IndexedDB cache clear failed:', error);
    }
  }
}

class LocalStorageCache {
  private prefix = 'tradenext_cache_';

  get<T>(key: string): T | null {
    // Check if we're in a browser environment
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }

    try {
      const item = localStorage.getItem(this.prefix + key);
      if (!item) return null;

      const entry: CacheEntry<T> = JSON.parse(item);
      if (Date.now() - entry.timestamp < entry.ttl) {
        return entry.data;
      } else {
        this.delete(key); // Clean up expired entry
        return null;
      }
    } catch {
      return null;
    }
  }

  set<T>(key: string, data: T, ttl: number = 300000): void {
    // Check if we're in a browser environment
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    try {
      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
        ttl
      };
      localStorage.setItem(this.prefix + key, JSON.stringify(entry));
    } catch (error) {
      console.warn('localStorage cache set failed:', error);
    }
  }

  delete(key: string): void {
    // Check if we're in a browser environment
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    try {
      localStorage.removeItem(this.prefix + key);
    } catch (error) {
      console.warn('localStorage cache delete failed:', error);
    }
  }

  clear(): void {
    // Check if we're in a browser environment
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(this.prefix)) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn('localStorage cache clear failed:', error);
    }
  }
}

// Cache strategy: Use IndexedDB for large data, localStorage for small/fast access
export const indexedDBCache = new IndexedDBCache();
export const localStorageCache = new LocalStorageCache();

// Smart cache that chooses the best storage method based on data size
export class SmartCache {
  private static isLargeData(data: unknown): boolean {
    // Consider data "large" if JSON stringified size > 50KB
    return JSON.stringify(data).length > 50000;
  }

  static async get<T>(key: string): Promise<T | null> {
    // Check if we're in a browser environment
    if (typeof window === 'undefined') {
      return null;
    }

    try {
      // Try localStorage first for fast access
      const data = localStorageCache.get<T>(key);
      if (data !== null) return data;

      // Fall back to IndexedDB for larger data
      return await indexedDBCache.get<T>(key);
    } catch (error) {
      console.warn('SmartCache get failed:', error);
      return null;
    }
  }

  static async set<T>(key: string, data: T, ttl: number = 300000): Promise<void> {
    // Check if we're in a browser environment
    if (typeof window === 'undefined') {
      return;
    }

    try {
      if (this.isLargeData(data)) {
        // Use IndexedDB for large data
        await indexedDBCache.set(key, data, ttl);
      } else {
        // Use localStorage for small data
        localStorageCache.set(key, data, ttl);
      }
    } catch (error) {
      console.warn('SmartCache set failed:', error);
    }
  }

  static async delete(key: string): Promise<void> {
    // Check if we're in a browser environment
    if (typeof window === 'undefined') {
      return;
    }

    try {
      // Try both storages
      localStorageCache.delete(key);
      await indexedDBCache.delete(key);
    } catch (error) {
      console.warn('SmartCache delete failed:', error);
    }
  }

  static async clear(): Promise<void> {
    // Check if we're in a browser environment
    if (typeof window === 'undefined') {
      return;
    }

    try {
      localStorageCache.clear();
      await indexedDBCache.clear();
    } catch (error) {
      console.warn('SmartCache clear failed:', error);
    }
  }
}

// Utility functions for common caching patterns
export const clientCache = {
  // Cache market data (charts, quotes) - use SmartCache
  marketData: {
    async get<T>(key: string): Promise<T | null> {
      return await SmartCache.get<T>(`market:${key}`);
    },
    async set<T>(key: string, data: T, ttl: number = 120000): Promise<void> { // 2 minutes
      await SmartCache.set(`market:${key}`, data, ttl);
    }
  },

  // Cache user preferences - use localStorage
  preferences: {
    get<T>(key: string): T | null {
      return localStorageCache.get<T>(`prefs:${key}`);
    },
    set<T>(key: string, data: T, ttl: number = 86400000): void { // 24 hours
      localStorageCache.set(`prefs:${key}`, data, ttl);
    }
  },

  // Cache static/reference data - use IndexedDB for persistence
  staticData: {
    async get<T>(key: string): Promise<T | null> {
      return await indexedDBCache.get<T>(`static:${key}`);
    },
    async set<T>(key: string, data: T, ttl: number = 3600000): Promise<void> { // 1 hour
      await indexedDBCache.set(`static:${key}`, data, ttl);
    }
  }
};

// Cache invalidation helpers
export const invalidateCache = {
  marketData: (pattern: string) => {
    // In a real implementation, you'd need to iterate through all keys
    // and delete matching ones. For now, we'll clear all market data
    console.log(`Invalidating market cache pattern: ${pattern}`);
  },
  all: async () => {
    await SmartCache.clear();
  }
};
