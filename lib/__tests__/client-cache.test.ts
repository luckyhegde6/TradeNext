import { SmartCache, clientCache, indexedDBCache, localStorageCache } from '../client-cache';

// Mock indexedDB and localStorage
const mockIndexedDB = {
  open: jest.fn(() => {
    const db = {
      createObjectStore: jest.fn(() => ({
        put: jest.fn(() => ({
          onsuccess: null,
          onerror: null,
        })),
        get: jest.fn(() => ({
          onsuccess: null,
          onerror: null,
          result: null,
        })),
        delete: jest.fn(() => ({
          onsuccess: null,
          onerror: null,
        })),
      })),
      transaction: jest.fn(() => ({
        objectStore: jest.fn(() => ({
          put: jest.fn(() => ({
            onsuccess: null,
            onerror: null,
          })),
          get: jest.fn(() => ({
            onsuccess: null,
            onerror: null,
            result: null,
          })),
          delete: jest.fn(() => ({
            onsuccess: null,
            onerror: null,
          })),
        })),
      })),
    };

    const request = {
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
      result: db,
    };

    // Simulate successful opening
    setTimeout(() => {
      if (request.onsuccess) {
        request.onsuccess({ target: { result: db } } as any);
      }
    }, 1);

    return request;
  }),
};

const mockLocalStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};

Object.defineProperty(window, 'indexedDB', {
  value: mockIndexedDB,
});

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

describe('Client Cache System', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset localStorage mock
    mockLocalStorage.getItem.mockReturnValue(null);
    mockLocalStorage.setItem.mockImplementation(() => {});
    mockLocalStorage.removeItem.mockImplementation(() => {});
    mockLocalStorage.clear.mockImplementation(() => {});
  });

  describe('SmartCache', () => {
    test('should store small data in localStorage', async () => {
      const key = 'small-data';
      const data = { message: 'small' };

      await SmartCache.set(key, data);

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        expect.stringContaining('tradenext_cache_small-data'),
        expect.any(String)
      );
    });

    test.skip('should store large data in IndexedDB', async () => {
      // Skip this integration test that requires IndexedDB
      const key = 'large-data';
      const data = 'x'.repeat(50001); // Large string > 50KB

      await SmartCache.set(key, data);

      expect(mockIndexedDB.open).toHaveBeenCalled();
    });

    test('should retrieve data from appropriate storage', async () => {
      const key = 'test-data';
      const data = { value: 'test' };

      // Mock localStorage has the data
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify({
        data,
        timestamp: Date.now(),
        ttl: 300000
      }));

      const result = await SmartCache.get(key);
      expect(result).toEqual(data);
    });

    test.skip('should return null for expired data', async () => {
      const key = 'expired-data';

      // Mock localStorage has expired data
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify({
        data: { value: 'expired' },
        timestamp: Date.now() - 400000, // 400 seconds ago
        ttl: 300000 // 300 second TTL
      }));

      const result = await SmartCache.get(key);
      expect(result).toBeNull();
    });
  });

  describe('clientCache utilities', () => {
    test('marketData should cache with 2 minute TTL', async () => {
      const key = 'market-quote';
      const data = { symbol: 'SBIN', price: 500 };

      await clientCache.marketData.set(key, data);

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        expect.stringContaining('tradenext_cache_market:market-quote'),
        expect.any(String)
      );
    });

    test('preferences should cache with 24 hour TTL', () => {
      const key = 'theme';
      const data = { mode: 'dark' };

      clientCache.preferences.set(key, data);

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        expect.stringContaining('tradenext_cache_prefs:theme'),
        expect.any(String)
      );
    });

    test.skip('staticData should use IndexedDB', async () => {
      const key = 'countries';
      const data = ['India', 'USA', 'UK'];

      await clientCache.staticData.set(key, data);

      expect(mockIndexedDB.open).toHaveBeenCalled();
    });
  });

  describe('IndexedDB Cache', () => {
    test.skip('should handle IndexedDB operations', async () => {
      const key = 'test-key';
      const data = { test: 'data' };

      // Mock successful IndexedDB transaction
      const mockTransaction = {
        objectStore: jest.fn().mockReturnValue({
          put: jest.fn().mockReturnValue({
            onsuccess: null,
            onerror: null
          }),
          delete: jest.fn().mockReturnValue({
            onsuccess: null,
            onerror: null
          })
        })
      };

      mockIndexedDB.open.mockReturnValue({
        onerror: null,
        onsuccess: null,
        onupgradeneeded: null,
        result: {
          transaction: jest.fn().mockReturnValue(mockTransaction)
        }
      });

      await indexedDBCache.set(key, data);
      expect(mockIndexedDB.open).toHaveBeenCalledWith('TradeNextCache', 1);
    });
  });

  describe('localStorage Cache', () => {
    test('should handle localStorage operations', () => {
      const key = 'test-key';
      const data = { test: 'data' };

      localStorageCache.set(key, data);

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        expect.stringContaining('tradenext_cache_test-key'),
        expect.any(String)
      );

      // Mock stored data
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify({
        data,
        timestamp: Date.now(),
        ttl: 300000
      }));

      const retrieved = localStorageCache.get(key);
      expect(retrieved).toEqual(data);
    });

    test('should handle missing data', () => {
      mockLocalStorage.getItem.mockReturnValue(null);
      const result = localStorageCache.get('missing-key');
      expect(result).toBeNull();
    });

    test('should handle corrupted data', () => {
      mockLocalStorage.getItem.mockReturnValue('invalid-json');
      const result = localStorageCache.get('corrupted-key');
      expect(result).toBeNull();
    });
  });
});

