/**
 * Production Circuit Breaker
 *
 * Implements the circuit breaker pattern to prevent cascading failures:
 * - Closed: Normal operation
 * - Open: Failing fast, not calling service
 * - Half-Open: Testing if service recovered
 *
 * @module @monoes/cli/production/circuit-breaker
 */
export type CircuitState = 'closed' | 'open' | 'half-open';
export interface CircuitBreakerConfig {
    failureThreshold: number;
    resetTimeoutMs: number;
    successThreshold: number;
    failureWindowMs: number;
    halfOpenRequestPercentage: number;
    onStateChange?: (from: CircuitState, to: CircuitState) => void;
    onOpen?: (failures: number) => void;
    onClose?: () => void;
}
export interface CircuitStats {
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
    getStats(): CircuitStats;
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
export declare function getAllCircuitStats(): Record<string, CircuitStats>;
/**
 * Reset all circuit breakers
 */
export declare function resetAllCircuits(): void;
export default CircuitBreaker;
//# sourceMappingURL=circuit-breaker.d.ts.map