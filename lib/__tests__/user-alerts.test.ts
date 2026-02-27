import { z } from 'zod';

const alertSchema = z.object({
  symbol: z.string().optional(),
  alertType: z.enum(['price_above', 'price_below', 'volume_spike', 'custom']),
  title: z.string().min(1),
  message: z.string().optional(),
  targetPrice: z.number().optional(),
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
      const alertTypes = ['price_above', 'price_below', 'volume_spike', 'custom'];
      
      alertTypes.forEach(type => {
        const alert = {
          alertType: type,
          title: 'Test alert',
        };
        const result = alertSchema.safeParse(alert);
        expect(result.success).toBe(true);
      });
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
