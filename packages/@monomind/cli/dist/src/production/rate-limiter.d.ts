/**
 * Production Rate Limiting
 *
 * Provides token bucket rate limiting with:
 * - Per-operation limits
 * - Per-user/agent limits
 * - Burst allowance
 * - Sliding window tracking
 *
 * @module @monoes/cli/production/rate-limiter
 */
export interface RateLimiterConfig {
    maxRequests: number;
    windowMs: number;
    burstMultiplier: number;
    whitelist: string[];
    operationLimits: Record<string, {
        maxRequests: number;
        windowMs: number;
    }>;
    perUserLimits: boolean;
    maxTrackedUsers: number;
}
export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetAt: number;
    retryAfterMs?: number;
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
    getStatus(operation: string, userId?: string): {
        current: number;
        limit: number;
        remaining: number;
        resetAt: number;
    };
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
    getStats(): {
        totalBuckets: number;
        activeUsers: number;
        mostLimitedOperations: Array<{
            operation: string;
            requests: number;
        }>;
    };
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