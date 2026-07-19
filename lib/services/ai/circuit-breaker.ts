import logger from "@/lib/logger";

/** Circuit breaker states */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/** Configuration for circuit breaker behavior */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening the circuit. Default: 3 */
  failureThreshold: number;
  /** Milliseconds to wait in OPEN state before trying HALF_OPEN. Default: 30000 */
  cooldownMs: number;
  /** Consecutive successes in HALF_OPEN needed to close the circuit. Default: 1 */
  successThreshold: number;
}

/** Current statistics of the circuit breaker */
export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
}

/**
 * Circuit Breaker pattern for AI provider resilience.
 *
 * Three states:
 * - **CLOSED**: Normal operation. Requests pass through. Failures increment counter.
 * - **OPEN**: Service is failing. Requests are blocked immediately. Transitions to HALF_OPEN after cooldown.
 * - **HALF_OPEN**: Testing recovery. First successful request closes the circuit. Any failure reopens it.
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private totalRequests = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = {
      failureThreshold: config?.failureThreshold ?? 3,
      cooldownMs: config?.cooldownMs ?? 30000,
      successThreshold: config?.successThreshold ?? 1,
    };
  }

  /**
   * Execute a function with circuit breaker protection.
   * @throws {CircuitBreakerError} when the circuit is OPEN and cooldown hasn't elapsed
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    this.totalRequests++;

    if (this.state === 'OPEN') {
      if (this.canTryHalfOpen()) {
        this.transitionTo('HALF_OPEN');
      } else {
        throw new CircuitBreakerError('Circuit breaker is OPEN', this.getStats());
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /** Check if cooldown has elapsed and we should transition to HALF_OPEN */
  private canTryHalfOpen(): boolean {
    if (!this.lastFailureTime) return false;
    return Date.now() - this.lastFailureTime >= this.config.cooldownMs;
  }

  /** Handle successful call — may close the circuit from HALF_OPEN */
  private onSuccess(): void {
    this.totalSuccesses++;
    this.lastSuccessTime = Date.now();
    this.successCount++;

    if (this.state === 'HALF_OPEN') {
      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo('CLOSED');
      }
    } else {
      // Reset failure count on success in CLOSED state
      this.failureCount = 0;
    }
  }

  /** Handle failed call — may open the circuit */
  private onFailure(): void {
    this.totalFailures++;
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.successCount = 0;

    if (this.state === 'HALF_OPEN') {
      this.transitionTo('OPEN');
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.transitionTo('OPEN');
    }
  }

  /** Transition to a new state with logging */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.successCount = 0;

    logger.warn({
      msg: "Circuit breaker state transition",
      from: oldState,
      to: newState,
      failureCount: this.failureCount,
      totalRequests: this.totalRequests,
    });
  }

  /** Get current statistics snapshot */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
    };
  }

  /** Reset circuit breaker to CLOSED state */
  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.lastSuccessTime = null;
    logger.info({ msg: "Circuit breaker reset" });
  }

  /** Check if the circuit is healthy (CLOSED or HALF_OPEN with at least one success) */
  isHealthy(): boolean {
    return this.state === 'CLOSED' ||
      (this.state === 'HALF_OPEN' && this.successCount > 0);
  }
}

/** Error thrown when the circuit breaker is OPEN and blocking requests */
export class CircuitBreakerError extends Error {
  public readonly stats: CircuitBreakerStats;
  constructor(message: string, stats: CircuitBreakerStats) {
    super(message);
    this.name = 'CircuitBreakerError';
    this.stats = stats;
  }
}

/** Singleton AI provider circuit breaker */
let aiCircuitBreaker: CircuitBreaker | null = null;

/** Get or create the singleton AI circuit breaker instance */
export function getAICircuitBreaker(): CircuitBreaker {
  if (!aiCircuitBreaker) {
    aiCircuitBreaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30000 });
  }
  return aiCircuitBreaker;
}
