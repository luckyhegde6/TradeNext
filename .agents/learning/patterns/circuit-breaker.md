# Pattern: Circuit Breaker

## Problem
External service failures (AI provider, API, database) cascade and block the entire system.

## Solution
Implement circuit breaker with 3 states:
- **CLOSED**: Normal operation, requests pass through
- **OPEN**: Service is failing, requests are blocked
- **HALF_OPEN**: Testing if service has recovered

## Example (AI Provider)
```typescript
class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly threshold = 3;
  private readonly cooldownMs = 30000;

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.cooldownMs) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await fn();
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED';
        this.failureCount = 0;
      }
      return result;
    } catch (e) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      if (this.failureCount >= this.threshold) {
        this.state = 'OPEN';
      }
      throw e;
    }
  }
}
```

## Configuration
- **Threshold**: 3 consecutive failures to open
- **Cooldown**: 30 seconds before half-open
- **Success reset**: 1 success in half-open closes circuit

## When to Use
- Calling external APIs (AI providers, payment gateways)
- Database connections under load
- Any service that can fail intermittently

## Monitoring
- Log state transitions (CLOSED→OPEN, OPEN→HALF_OPEN, HALF_OPEN→CLOSED)
- Track failure counts and success rates
- Alert on circuit open events
