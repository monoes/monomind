/**
 * Production Rate Limiting
 *
 * Provides token bucket rate limiting with:
 * - Per-operation limits
 * - Per-user/agent limits
 * - Burst allowance
 * - Sliding window tracking
 *
 * @module @monomind/cli/production/rate-limiter
 */
/**
 * Per-operation rate limit override.
 */
export interface OperationLimit {
    /** Maximum number of requests allowed within the window. */
    maxRequests: number;
    /** Window size in milliseconds. */
    windowMs: number;
}
/**
 * Rate limiter configuration. All fields are optional when constructing —
 * unspecified values fall back to {@link DEFAULT_CONFIG}.
 */
export interface RateLimiterConfig {
    /** Default maximum requests per window. */
    maxRequests: number;
    /** Default window size in milliseconds. */
    windowMs: number;
    /** Multiplier applied for burst allowance. */
    burstMultiplier: number;
    /** Operations that bypass rate limiting entirely. */
    whitelist: string[];
    /** Per-operation limit overrides keyed by operation name. */
    operationLimits: Record<string, OperationLimit>;
    /** Whether to track limits per user/agent in addition to per operation. */
    perUserLimits: boolean;
    /** Maximum number of distinct buckets to retain before eviction. */
    maxTrackedUsers: number;
}
/**
 * Result of a rate limit check.
 */
export interface RateLimitResult {
    /** Whether the request is permitted. */
    allowed: boolean;
    /** Remaining requests in the current window. */
    remaining: number;
    /** Epoch timestamp (ms) at which the window resets. */
    resetAt: number;
    /** When rate limited, milliseconds to wait before retrying. */
    retryAfterMs?: number;
}
/**
 * Snapshot of the current rate limit state for a key.
 */
export interface RateLimitStatus {
    /** Number of requests counted in the current window. */
    current: number;
    /** Configured limit for the operation. */
    limit: number;
    /** Remaining requests in the current window. */
    remaining: number;
    /** Epoch timestamp (ms) at which the window resets. */
    resetAt: number;
}
/**
 * Aggregate operation usage entry used in statistics.
 */
export interface OperationStat {
    /** Operation name. */
    operation: string;
    /** Total requests counted across buckets for the operation. */
    requests: number;
}
/**
 * Aggregate rate limiter statistics.
 */
export interface RateLimiterStats {
    /** Total number of active buckets. */
    totalBuckets: number;
    /** Number of distinct users currently tracked. */
    activeUsers: number;
    /** Top operations by request volume. */
    mostLimitedOperations: OperationStat[];
}
export declare class RateLimiter {
    private config;
    private buckets;
    private globalBucket;
    constructor(config?: Partial<RateLimiterConfig>);
    /**
     * Check if a request is allowed
     */
    check(operation: string, userId?: string): RateLimitResult;
    /**
     * Consume a token (use after successful request)
     */
    consume(operation: string, userId?: string): boolean;
    /**
     * Get current rate limit status
     */
    getStatus(operation: string, userId?: string): RateLimitStatus;
    /**
     * Reset limits for a specific key
     */
    reset(operation: string, userId?: string): void;
    /**
     * Reset all limits
     */
    resetAll(): void;
    /**
     * Get statistics
     */
    getStats(): RateLimiterStats;
    private getLimits;
    private createBucket;
    private cleanupBuckets;
}
/**
 * Create a rate limiter with default config
 */
export declare function createRateLimiter(config?: Partial<RateLimiterConfig>): RateLimiter;
export default RateLimiter;
//# sourceMappingURL=rate-limiter.d.ts.map