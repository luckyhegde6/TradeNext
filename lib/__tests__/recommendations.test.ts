import { z } from 'zod';

const recommendationSchema = z.object({
  symbol: z.string().min(1),
  entryRange: z.string().optional(),
  shortTerm: z.string().optional(),
  longTerm: z.string().optional(),
  intraday: z.string().optional(),
  recommendation: z.enum(['ACCUMULATE', 'BUY', 'HOLD', 'SELL', 'NEUTRAL']),
  analystRating: z.string().optional(),
  profitRangeMin: z.number().optional(),
  profitRangeMax: z.number().optional(),
  targetPrice: z.number().optional(),
  analysis: z.string().optional(),
  imageUrl: z.string().optional(),
});

describe('Stock Recommendations Validation', () => {
  describe('recommendationSchema', () => {
    test('should validate valid recommendation data', () => {
      const validRecommendation = {
        symbol: 'RELIANCE',
        recommendation: 'BUY',
        targetPrice: 2500,
        analysis: 'Strong buy signal',
      };

      const result = recommendationSchema.safeParse(validRecommendation);
      expect(result.success).toBe(true);
    });

    test('should validate all recommendation types', () => {
      const types = ['ACCUMULATE', 'BUY', 'HOLD', 'SELL', 'NEUTRAL'];
      
      types.forEach(type => {
        const rec = {
          symbol: 'RELIANCE',
          recommendation: type,
        };
        const result = recommendationSchema.safeParse(rec);
        expect(result.success).toBe(true);
      });
    });

    test('should reject invalid recommendation type', () => {
      const invalidRecommendation = {
        symbol: 'RELIANCE',
        recommendation: 'INVALID',
      };

      const result = recommendationSchema.safeParse(invalidRecommendation);
      expect(result.success).toBe(false);
    });

    test('should reject empty symbol', () => {
      const invalidRecommendation = {
        symbol: '',
        recommendation: 'BUY',
      };

      const result = recommendationSchema.safeParse(invalidRecommendation);
      expect(result.success).toBe(false);
    });

    test('should allow optional fields', () => {
      const minimalRecommendation = {
        symbol: 'RELIANCE',
        recommendation: 'HOLD',
      };

      const result = recommendationSchema.safeParse(minimalRecommendation);
      expect(result.success).toBe(true);
    });

    test('should validate profit range', () => {
      const recommendationWithProfitRange = {
        symbol: 'RELIANCE',
        recommendation: 'BUY',
        profitRangeMin: 2400,
        profitRangeMax: 2600,
        targetPrice: 2500,
      };

      const result = recommendationSchema.safeParse(recommendationWithProfitRange);
      expect(result.success).toBe(true);
    });

    test('should validate analyst rating', () => {
      const recommendationWithRating = {
        symbol: 'RELIANCE',
        recommendation: 'BUY',
        analystRating: '4.5/5',
      };

      const result = recommendationSchema.safeParse(recommendationWithRating);
      expect(result.success).toBe(true);
    });

    test('should validate image URL', () => {
      const recommendationWithImage = {
        symbol: 'RELIANCE',
        recommendation: 'BUY',
        imageUrl: 'https://example.com/chart.png',
      };

      const result = recommendationSchema.safeParse(recommendationWithImage);
      expect(result.success).toBe(true);
    });

    test('should validate all timeframes', () => {
      const recommendationWithTimeframes = {
        symbol: 'RELIANCE',
        recommendation: 'ACCUMULATE',
        entryRange: '1450-1500',
        shortTerm: 'BULLISH',
        longTerm: 'BULLISH',
        intraday: 'NEUTRAL',
      };

      const result = recommendationSchema.safeParse(recommendationWithTimeframes);
      expect(result.success).toBe(true);
    });

    test('should validate base64 image data', () => {
      const base64Image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const recommendationWithBase64Image = {
        symbol: 'RELIANCE',
        recommendation: 'BUY',
        imageUrl: base64Image,
      };

      const result = recommendationSchema.safeParse(recommendationWithBase64Image);
      expect(result.success).toBe(true);
    });
  });

  describe('Partial Update Schema', () => {
    const updateRecommendationSchema = recommendationSchema.partial();

    test('should allow partial updates', () => {
      const partialUpdate = {
        targetPrice: 2600,
      };

      const result = updateRecommendationSchema.safeParse(partialUpdate);
      expect(result.success).toBe(true);
    });

    test('should allow empty partial updates', () => {
      const emptyUpdate = {};

      const result = updateRecommendationSchema.safeParse(emptyUpdate);
      expect(result.success).toBe(true);
    });
  });
});
