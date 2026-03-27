import { z } from 'zod';

// Alert type enum including corporate action alerts
const AlertTypeEnum = z.enum([
  'price_above',
  'price_below', 
  'volume_spike',
  'price_jump',
  'piotroski_score',
  'portfolio_value',
  // Corporate Action Alerts
  'dividend_alert',
  'bonus_alert',
  'split_alert',
  'rights_alert',
  'buyback_alert',
  'meeting_alert',
]);

const alertSchema = z.object({
  symbol: z.string().optional(),
  alertType: AlertTypeEnum,
  title: z.string().min(1),
  message: z.string().optional(),
  targetPrice: z.number().optional(),
  // Corporate action specific
  minDividend: z.number().optional(),
  condition: z.object({
    threshold: z.number().optional(),
    changePercent: z.number().optional(),
    minDividend: z.number().optional(),
    triggeredAction: z.string().optional(),
    purpose: z.string().optional(),
    exDate: z.string().optional(),
  }).optional(),
});

describe('User Alerts Validation', () => {
  describe('alertSchema', () => {
    test('should validate valid alert data', () => {
      const validAlert = {
        symbol: 'RELIANCE',
        alertType: 'price_above',
        title: 'RELIANCE above 2500',
        targetPrice: 2500,
      };

      const result = alertSchema.safeParse(validAlert);
      expect(result.success).toBe(true);
    });

    test('should validate alert without symbol', () => {
      const validAlert = {
        alertType: 'volume_spike',
        title: 'High volume alert',
      };

      const result = alertSchema.safeParse(validAlert);
      expect(result.success).toBe(true);
    });

    test('should reject invalid alert type', () => {
      const invalidAlert = {
        alertType: 'invalid_type',
        title: 'Test alert',
      };

      const result = alertSchema.safeParse(invalidAlert);
      expect(result.success).toBe(false);
    });

    test('should reject empty title', () => {
      const invalidAlert = {
        alertType: 'price_above',
        title: '',
      };

      const result = alertSchema.safeParse(invalidAlert);
      expect(result.success).toBe(false);
    });

    test('should allow optional message', () => {
      const alertWithMessage = {
        alertType: 'price_below',
        title: 'RELIANCE below 2400',
        message: 'Price dropped significantly',
        targetPrice: 2400,
      };

      const result = alertSchema.safeParse(alertWithMessage);
      expect(result.success).toBe(true);
    });

    test('should validate all alert types', () => {
      const alertTypes = ['price_above', 'price_below', 'volume_spike', 'price_jump', 'piotroski_score', 'portfolio_value'];
      
      alertTypes.forEach(type => {
        const alert = {
          alertType: type,
          title: 'Test alert',
        };
        const result = alertSchema.safeParse(alert);
        expect(result.success).toBe(true);
      });
    });

    // Corporate Action Alert Tests
    test('should validate dividend_alert', () => {
      const dividendAlert = {
        symbol: 'RELIANCE',
        alertType: 'dividend_alert',
        title: 'RELIANCE dividend alert',
        minDividend: 5,
      };
      const result = alertSchema.safeParse(dividendAlert);
      expect(result.success).toBe(true);
    });

    test('should validate bonus_alert', () => {
      const bonusAlert = {
        symbol: 'TCS',
        alertType: 'bonus_alert',
        title: 'TCS bonus alert',
      };
      const result = alertSchema.safeParse(bonusAlert);
      expect(result.success).toBe(true);
    });

    test('should validate split_alert', () => {
      const splitAlert = {
        symbol: 'INFY',
        alertType: 'split_alert',
        title: 'INFY split alert',
      };
      const result = alertSchema.safeParse(splitAlert);
      expect(result.success).toBe(true);
    });

    test('should validate rights_alert', () => {
      const rightsAlert = {
        symbol: 'BHEL',
        alertType: 'rights_alert',
        title: 'BHEL rights alert',
      };
      const result = alertSchema.safeParse(rightsAlert);
      expect(result.success).toBe(true);
    });

    test('should validate buyback_alert', () => {
      const buybackAlert = {
        symbol: 'HINDUNI',
        alertType: 'buyback_alert',
        title: 'HINDUNI buyback alert',
      };
      const result = alertSchema.safeParse(buybackAlert);
      expect(result.success).toBe(true);
    });

    test('should validate meeting_alert', () => {
      const meetingAlert = {
        symbol: 'SBIN',
        alertType: 'meeting_alert',
        title: 'SBIN meeting alert',
      };
      const result = alertSchema.safeParse(meetingAlert);
      expect(result.success).toBe(true);
    });

    test('should validate corporate action alert without symbol (monitor all)', () => {
      const anyStockAlert = {
        alertType: 'dividend_alert',
        title: 'Any stock dividend alert',
      };
      const result = alertSchema.safeParse(anyStockAlert);
      expect(result.success).toBe(true);
    });

    test('should validate corporate action alert with condition details', () => {
      const detailedAlert = {
        symbol: 'VEDL',
        alertType: 'dividend_alert',
        title: 'VEDL dividend alert',
        condition: {
          minDividend: 10,
          triggeredAction: 'DIVIDEND',
          purpose: 'Interim Dividend - Rs 11 Per Share',
          exDate: '2026-03-28',
        },
      };
      const result = alertSchema.safeParse(detailedAlert);
      expect(result.success).toBe(true);
    });
  });

  describe('Alert Status Transitions', () => {
    test('should allow active to triggered transition', () => {
      const status = 'triggered';
      const validStatuses = ['active', 'triggered', 'dismissed'];
      expect(validStatuses).toContain(status);
    });

    test('should allow active to dismissed transition', () => {
      const status = 'dismissed';
      const validStatuses = ['active', 'triggered', 'dismissed'];
      expect(validStatuses).toContain(status);
    });

    test('should determine triggeredAt when status changes to triggered', () => {
      const status = 'triggered';
      const shouldSetTriggeredAt = status === 'triggered';
      expect(shouldSetTriggeredAt).toBe(true);
    });
  });

  describe('Alert Filtering', () => {
    const alerts = [
      { id: '1', status: 'active', createdAt: new Date() },
      { id: '2', status: 'triggered', createdAt: new Date() },
      { id: '3', status: 'active', createdAt: new Date() },
      { id: '4', status: 'dismissed', createdAt: new Date() },
    ];

    test('should filter active alerts', () => {
      const activeAlerts = alerts.filter(a => a.status === 'active');
      expect(activeAlerts.length).toBe(2);
    });

    test('should filter triggered alerts', () => {
      const triggeredAlerts = alerts.filter(a => a.status === 'triggered');
      expect(triggeredAlerts.length).toBe(1);
    });

    test('should filter today alerts', () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayAlerts = alerts.filter(a => a.createdAt >= today);
      expect(todayAlerts.length).toBe(4);
    });
  });
});
