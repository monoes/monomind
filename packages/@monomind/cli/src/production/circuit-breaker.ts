/**
 * Production Circuit Breaker
 *
 * Implements the circuit breaker pattern to prevent cascading failures:
 * - Closed: Normal operation
 * - Open: Failing fast, not calling service
 * - Half-Open: Testing if service recovered
 *
 * @module @monomind/cli/production/circuit-breaker
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Circuit breaker states.
 * - `closed`: Normal operation, requests pass through.
 * - `open`: Failing fast, requests are rejected immediately.
 * - `half-open`: Testing recovery, a percentage of requests pass through.
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker configuration options.
 */
export interface CircuitBreakerConfig {
  /** Number of failures within the window before opening the circuit. */
  failureThreshold: number;
  /** Time (ms) to wait in the open state before transitioning to half-open. */
  resetTimeoutMs: number;
  /** Number of consecutive successes in half-open before closing. */
  successThreshold: number;
  /** Sliding window (ms) over which failures are counted. */
  failureWindowMs: number;
  /** Fraction of requests (0-1) allowed through while half-open. */
  halfOpenRequestPercentage: number;
  /** Called when the circuit transitions to the open state. */
  onOpen?: (failureCount: number) => void;
  /** Called when the circuit transitions to the closed state. */
  onClose?: () => void;
  /** Called on any state transition. */
  onStateChange?: (oldState: CircuitState, newState: CircuitState) => void;
}

/**
 * Snapshot of circuit breaker statistics.
 */
export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: Date | null;
  lastSuccess: Date | null;
  stateChangedAt: Date;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  successThreshold: 3,
  failureWindowMs: 60000,
  halfOpenRequestPercentage: 0.1,
};

// ============================================================================
// Circuit Breaker Implementation
// ============================================================================

export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: CircuitState = 'closed';
  private failures: number[] = [];
  private successCount = 0;
  private stateChangedAt = Date.now();
  private totalRequests = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private lastFailure: Date | null = null;
  private lastSuccess: Date | null = null;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    this.checkStateTransition();
    return this.state;
  }

  /**
   * Check if request is allowed
   */
  isAllowed(): boolean {
    this.checkStateTransition();

    switch (this.state) {
      case 'closed':
        return true;

      case 'open':
        return false;

      case 'half-open':
        // Allow a percentage of requests through
        return Math.random() < this.config.halfOpenRequestPercentage;

      default:
        return true;
    }
  }

  /**
   * Execute a function through the circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.isAllowed()) {
      throw new Error('Circuit breaker is open. Service temporarily unavailable.');
    }

    this.totalRequests++;

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Record a successful operation
   */
  recordSuccess(): void {
    this.totalSuccesses++;
    this.lastSuccess = new Date();

    if (this.state === 'half-open') {
      this.successCount++;

      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo('closed');
      }
    }

    // Reset failure count on success in closed state
    if (this.state === 'closed') {
      this.failures = [];
    }
  }

  /**
   * Record a failed operation
   */
  recordFailure(): void {
    const now = Date.now();
    this.totalFailures++;
    this.lastFailure = new Date();

    // Add failure timestamp
    this.failures.push(now);

    // Clean old failures outside window
    this.failures = this.failures.filter(t => t > now - this.config.failureWindowMs);

    // Hard cap: prevent unbounded growth under rapid-fire recordFailure() calls
    // before the window filter prunes entries (e.g. clock skew or test hammering).
    if (this.failures.length > 10_000) {
      this.failures = this.failures.slice(-10_000);
    }

    // Check if we should open the circuit
    if (this.state === 'closed' && this.failures.length >= this.config.failureThreshold) {
      this.transitionTo('open');
      if (this.config.onOpen) {
        this.config.onOpen(this.failures.length);
      }
    }

    // If half-open and we fail, go back to open
    if (this.state === 'half-open') {
      this.transitionTo('open');
      if (this.config.onOpen) {
        this.config.onOpen(this.failures.length);
      }
    }
  }

  /**
   * Manually open the circuit
   */
  open(): void {
    if (this.state !== 'open') {
      this.transitionTo('open');
    }
  }

  /**
   * Manually close the circuit
   */
  close(): void {
    if (this.state !== 'closed') {
      this.transitionTo('closed');
    }
  }

  /**
   * Reset the circuit breaker
   */
  reset(): void {
    this.state = 'closed';
    this.failures = [];
    this.successCount = 0;
    this.stateChangedAt = Date.now();
    this.totalRequests = 0;
    this.totalFailures = 0;
    this.totalSuccesses = 0;
    this.lastFailure = null;
    this.lastSuccess = null;
  }

  /**
   * Get circuit statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures.length,
      successes: this.successCount,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
      stateChangedAt: new Date(this.stateChangedAt),
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
    };
  }

  /**
   * Get failure rate
   */
  getFailureRate(): number {
    if (this.totalRequests === 0) return 0;
    return this.totalFailures / this.totalRequests;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private checkStateTransition(): void {
    const now = Date.now();

    if (this.state === 'open') {
      // Check if we should transition to half-open
      if (now - this.stateChangedAt >= this.config.resetTimeoutMs) {
        this.transitionTo('half-open');
      }
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    if (oldState === newState) return;

    this.state = newState;
    this.stateChangedAt = Date.now();

    // Reset counters on state change
    if (newState === 'half-open') {
      this.successCount = 0;
    }

    if (newState === 'closed') {
      this.failures = [];
      this.successCount = 0;
      if (this.config.onClose) {
        this.config.onClose();
      }
    }

    // Notify state change
    if (this.config.onStateChange) {
      this.config.onStateChange(oldState, newState);
    }
  }
}

// ============================================================================
// Circuit Breaker Registry
// ============================================================================

const circuitBreakers = new Map<string, CircuitBreaker>();
const MAX_CIRCUIT_BREAKERS = 1000;

const MAX_CIRCUIT_BREAKER_NAME_LEN = 256;
const FORBIDDEN_CB_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Get or create a circuit breaker by name
 */
export function getCircuitBreaker(
  name: string,
  config?: Partial<CircuitBreakerConfig>,
): CircuitBreaker {
  // Sanitize name: cap length and block prototype-pollution keys
  const safeName = typeof name === 'string'
    ? name.slice(0, MAX_CIRCUIT_BREAKER_NAME_LEN)
    : 'default';
  if (FORBIDDEN_CB_NAMES.has(safeName)) {
    throw new Error(`Invalid circuit breaker name: ${safeName}`);
  }
  if (!circuitBreakers.has(safeName)) {
    if (circuitBreakers.size >= MAX_CIRCUIT_BREAKERS) {
      throw new Error(`Circuit breaker registry full (max ${MAX_CIRCUIT_BREAKERS})`);
    }
    circuitBreakers.set(safeName, new CircuitBreaker(config));
  }
  return circuitBreakers.get(safeName)!;
}

/**
 * Get all circuit breaker stats
 */
export function getAllCircuitStats(): Record<string, CircuitBreakerStats> {
  const stats: Record<string, CircuitBreakerStats> = {};
  for (const [name, breaker] of circuitBreakers) {
    stats[name] = breaker.getStats();
  }
  return stats;
}

/**
 * Reset all circuit breakers
 */
export function resetAllCircuits(): void {
  for (const breaker of circuitBreakers.values()) {
    breaker.reset();
  }
}

export default CircuitBreaker;
