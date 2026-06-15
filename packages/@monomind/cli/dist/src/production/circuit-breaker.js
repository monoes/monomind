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
// Default Configuration
// ============================================================================
const DEFAULT_CONFIG = {
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
    config;
    state = 'closed';
    failures = [];
    successCount = 0;
    stateChangedAt = Date.now();
    totalRequests = 0;
    totalFailures = 0;
    totalSuccesses = 0;
    lastFailure = null;
    lastSuccess = null;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Get current circuit state
     */
    getState() {
        this.checkStateTransition();
        return this.state;
    }
    /**
     * Check if request is allowed
     */
    isAllowed() {
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
    async execute(fn) {
        if (!this.isAllowed()) {
            throw new Error('Circuit breaker is open. Service temporarily unavailable.');
        }
        this.totalRequests++;
        try {
            const result = await fn();
            this.recordSuccess();
            return result;
        }
        catch (error) {
            this.recordFailure();
            throw error;
        }
    }
    /**
     * Record a successful operation
     */
    recordSuccess() {
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
    recordFailure() {
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
    open() {
        if (this.state !== 'open') {
            this.transitionTo('open');
        }
    }
    /**
     * Manually close the circuit
     */
    close() {
        if (this.state !== 'closed') {
            this.transitionTo('closed');
        }
    }
    /**
     * Reset the circuit breaker
     */
    reset() {
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
    getStats() {
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
    getFailureRate() {
        if (this.totalRequests === 0)
            return 0;
        return this.totalFailures / this.totalRequests;
    }
    // ============================================================================
    // Private Methods
    // ============================================================================
    checkStateTransition() {
        const now = Date.now();
        if (this.state === 'open') {
            // Check if we should transition to half-open
            if (now - this.stateChangedAt >= this.config.resetTimeoutMs) {
                this.transitionTo('half-open');
            }
        }
    }
    transitionTo(newState) {
        const oldState = this.state;
        if (oldState === newState)
            return;
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
const circuitBreakers = new Map();
const MAX_CIRCUIT_BREAKERS = 1000;
const MAX_CIRCUIT_BREAKER_NAME_LEN = 256;
const FORBIDDEN_CB_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
/**
 * Get or create a circuit breaker by name
 */
export function getCircuitBreaker(name, config) {
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
    return circuitBreakers.get(safeName);
}
/**
 * Get all circuit breaker stats
 */
export function getAllCircuitStats() {
    const stats = {};
    for (const [name, breaker] of circuitBreakers) {
        stats[name] = breaker.getStats();
    }
    return stats;
}
/**
 * Reset all circuit breakers
 */
export function resetAllCircuits() {
    for (const breaker of circuitBreakers.values()) {
        breaker.reset();
    }
}
export default CircuitBreaker;
//# sourceMappingURL=circuit-breaker.js.map