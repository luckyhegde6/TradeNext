import { z } from 'zod';

// Import validation schemas from API routes
const ingestRequestSchema = z.object({
  csvPath: z.string().optional(),
  sync: z.boolean().optional(),
});

const tickerSchema = z.string().min(1).max(10).regex(/^[A-Z][A-Z0-9.]*$/);

const heatmapQuerySchema = z.object({
  page: z.string().optional().transform(val => val ? parseInt(val) : 1).refine(val => !isNaN(val) && val > 0, { message: "Page must be a positive number" }),
  limit: z.string().optional().transform(val => val ? Math.min(parseInt(val), 200) : 50).refine(val => !isNaN(val) && val > 0, { message: "Limit must be a positive number" }),
});

const announcementsQuerySchema = z.object({
  page: z.string().optional().transform(val => val ? parseInt(val) : 1),
  limit: z.string().optional().transform(val => val ? Math.min(parseInt(val), 100) : 20),
});

describe('API Validation Schemas', () => {
  describe('ingestRequestSchema', () => {
    test('should accept valid ingest requests', () => {
      const validData = { csvPath: '/path/to/file.csv', sync: false };
      const result = ingestRequestSchema.safeParse(validData);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(validData);
    });

    test('should accept partial data', () => {
      const partialData = { csvPath: '/path/to/file.csv' };
      const result = ingestRequestSchema.safeParse(partialData);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(partialData);
    });

    test('should accept empty object', () => {
      const emptyData = {};
      const result = ingestRequestSchema.safeParse(emptyData);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(emptyData);
    });

    test('should reject invalid csvPath type', () => {
      const invalidData = { csvPath: 123 };
      const result = ingestRequestSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });

  describe('tickerSchema', () => {
    test('should accept valid NSE tickers', () => {
      const validTickers = ['SBIN', 'RELIANCE', 'TCS', 'INFY.NS', 'BAJFINANCE'];
      validTickers.forEach(ticker => {
        const result = tickerSchema.safeParse(ticker);
        expect(result.success).toBe(true);
      });
    });

    test('should reject invalid tickers', () => {
      const invalidTickers = [
        '', // empty
        'a'.repeat(11), // too long
        'sbin', // lowercase
        'SBIN@', // special characters
        '123ABC', // starts with number
      ];

      invalidTickers.forEach(ticker => {
        const result = tickerSchema.safeParse(ticker);
        expect(result.success).toBe(false);
      });
    });

    test('should accept tickers with dots and numbers', () => {
      const validTickers = ['SBIN.NS', 'TCS.BO', 'INFY1'];
      validTickers.forEach(ticker => {
        const result = tickerSchema.safeParse(ticker);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('heatmapQuerySchema', () => {
    test('should parse valid query parameters', () => {
      const queryParams = { page: '2', limit: '100' };
      const result = heatmapQuerySchema.safeParse(queryParams);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ page: 2, limit: 100 });
    });

    test('should use defaults for missing parameters', () => {
      const queryParams = {};
      const result = heatmapQuerySchema.safeParse(queryParams);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ page: 1, limit: 50 });
    });

    test('should cap limit to maximum', () => {
      const queryParams = { limit: '500' };
      const result = heatmapQuerySchema.safeParse(queryParams);
      expect(result.success).toBe(true);
      expect(result.data.limit).toBe(200); // capped at 200
    });

    test('should reject invalid page values', () => {
      const queryParams = { page: 'not-a-number' };
      const result = heatmapQuerySchema.safeParse(queryParams);
      expect(result.success).toBe(false);
    });
  });

  describe('announcementsQuerySchema', () => {
    test('should parse valid query parameters', () => {
      const queryParams = { page: '1', limit: '50' };
      const result = announcementsQuerySchema.safeParse(queryParams);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ page: 1, limit: 50 });
    });

    test('should cap limit to maximum', () => {
      const queryParams = { limit: '200' };
      const result = announcementsQuerySchema.safeParse(queryParams);
      expect(result.success).toBe(true);
      expect(result.data.limit).toBe(100); // capped at 100
    });
  });
});

