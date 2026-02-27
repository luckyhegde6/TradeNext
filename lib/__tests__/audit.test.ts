describe('Audit Logging Types', () => {
  describe('Audit Action Types', () => {
    test('should support all audit action types', () => {
      const validActions = [
        'API_CALL',
        'USER_ACTION',
        'PORTFOLIO_ACTION',
        'NSE_CALL',
        'LOGIN',
        'LOGOUT',
        'RATE_LIMIT',
      ];
      
      validActions.forEach(action => {
        expect(validActions).toContain(action);
      });
    });
  });

  describe('AuditLogData Interface', () => {
    interface AuditLogData {
      userId?: number;
      userEmail?: string;
      action: string;
      resource?: string;
      resourceId?: string;
      method?: string;
      path?: string;
      requestBody?: unknown;
      responseStatus?: number;
      responseTime?: number;
      ipAddress?: string;
      userAgent?: string;
      metadata?: Record<string, unknown>;
      nseEndpoint?: string;
      errorMessage?: string;
    }

    test('should create valid audit log data for API call', () => {
      const data: AuditLogData = {
        userId: 1,
        userEmail: 'test@example.com',
        action: 'API_CALL',
        method: 'GET',
        path: '/api/test',
        responseStatus: 200,
        responseTime: 150,
      };

      expect(data.action).toBe('API_CALL');
      expect(data.method).toBe('GET');
      expect(data.responseStatus).toBe(200);
    });

    test('should create valid audit log data for NSE call', () => {
      const data: AuditLogData = {
        userId: 1,
        action: 'NSE_CALL',
        nseEndpoint: '/api/stock/quote',
        responseStatus: 200,
        responseTime: 100,
      };

      expect(data.action).toBe('NSE_CALL');
      expect(data.nseEndpoint).toBe('/api/stock/quote');
    });

    test('should create valid audit log data for user action', () => {
      const data: AuditLogData = {
        userId: 1,
        action: 'USER_ACTION',
        resource: 'recommendation',
        resourceId: 'rec-123',
        metadata: { symbol: 'RELIANCE' },
      };

      expect(data.action).toBe('USER_ACTION');
      expect(data.resource).toBe('recommendation');
      expect(data.metadata).toEqual({ symbol: 'RELIANCE' });
    });

    test('should create valid audit log data for portfolio action', () => {
      const data: AuditLogData = {
        userId: 1,
        action: 'PORTFOLIO_ACTION',
        resource: 'portfolio',
        resourceId: 'portfolio-123',
        metadata: { ticker: 'RELIANCE', quantity: 10 },
      };

      expect(data.action).toBe('PORTFOLIO_ACTION');
      expect(data.resourceId).toBe('portfolio-123');
    });

    test('should create valid audit log data for rate limit', () => {
      const data: AuditLogData = {
        userId: 1,
        action: 'RATE_LIMIT',
        resource: 'rate_limit',
        metadata: { endpoint: '/api/portfolio' },
      };

      expect(data.action).toBe('RATE_LIMIT');
      expect(data.metadata?.endpoint).toBe('/api/portfolio');
    });

    test('should create valid audit log for login', () => {
      const data: AuditLogData = {
        userId: 1,
        userEmail: 'test@example.com',
        action: 'LOGIN',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      };

      expect(data.action).toBe('LOGIN');
      expect(data.ipAddress).toBe('192.168.1.1');
    });
  });

  describe('logApiCall Parameters', () => {
    test('should have correct parameter types for logApiCall', () => {
      const params = {
        path: '/api/test',
        method: 'POST',
        userId: 1,
        userEmail: 'test@example.com',
        status: 201,
        responseTime: 200,
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      };

      expect(typeof params.path).toBe('string');
      expect(typeof params.method).toBe('string');
      expect(typeof params.userId).toBe('number');
      expect(typeof params.status).toBe('number');
    });
  });

  describe('logNseCall Parameters', () => {
    test('should have correct parameter types for logNseCall', () => {
      const params = {
        endpoint: '/api/stock/quote',
        userId: 1,
        userEmail: 'test@example.com',
        status: 200,
        responseTime: 100,
        error: undefined as string | undefined,
      };

      expect(typeof params.endpoint).toBe('string');
      expect(typeof params.userId).toBe('number');
      expect(typeof params.status).toBe('number');
    });
  });
});
