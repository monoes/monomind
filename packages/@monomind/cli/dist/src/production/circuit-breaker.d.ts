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
export declare class CircuitBreaker {
    private config;
    private state;
    private failures;
    private successCount;
    private stateChangedAt;
    private totalRequests;
    private totalFailures;
    private totalSuccesses;
    private lastFailure;
    private lastSuccess;
    constructor(config?: Partial<CircuitBreakerConfig>);
    /**
     * Get current circuit state
     */
    getState(): CircuitState;
    /**
     * Check if request is allowed
     */
    isAllowed(): boolean;
    /**
     * Execute a function through the circuit breaker
     */
    execute<T>(fn: () => Promise<T>): Promise<T>;
    /**
     * Record a successful operation
     */
    recordSuccess(): void;
    /**
     * Record a failed operation
     */
    recordFailure(): void;
    /**
     * Manually open the circuit
     */
    open(): void;
    /**
     * Manually close the circuit
     */
    close(): void;
    /**
     * Reset the circuit breaker
     */
    reset(): void;
    /**
     * Get circuit statistics
     */
    getStats(): CircuitBreakerStats;
    /**
     * Get failure rate
     */
    getFailureRate(): number;
    private checkStateTransition;
    private transitionTo;
}
/**
 * Get or create a circuit breaker by name
 */
export declare function getCircuitBreaker(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker;
/**
 * Get all circuit breaker stats
 */
export declare function getAllCircuitStats(): Record<string, CircuitBreakerStats>;
/**
 * Reset all circuit breakers
 */
export declare function resetAllCircuits(): void;
export default CircuitBreaker;
//# sourceMappingURL=circuit-breaker.d.ts.map