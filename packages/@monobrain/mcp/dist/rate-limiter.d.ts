/**
 * @monobrain/mcp - Rate Limiter
 *
 * Token bucket rate limiting for DoS protection
 */
import { EventEmitter } from 'events';
import type { ILogger } from './types.js';
export interface RateLimitConfig {
    /** Requests per second */
    requestsPerSecond: number;
    /** Burst size (max tokens) */
    burstSize: number;
    /** Per-session limits (if different from global) */
    perSessionLimit?: number;
    /** Cleanup interval for expired sessions */
    cleanupInterval?: number;
}
export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetIn: number;
    retryAfter?: number;
}
export declare class RateLimiter extends EventEmitter {
    private readonly logger;
    private readonly config;
    private globalBucket;
    private sessionBuckets;
    private cleanupTimer?;
    constructor(logger: ILogger, config?: Partial<RateLimitConfig>);
    /**
     * Check if request is allowed (global limit)
     */
    checkGlobal(): RateLimitResult;
    /**
     * Check if request is allowed (per-session limit)
     */
    checkSession(sessionId: string): RateLimitResult;
    /**
     * Check both global and session limits
     */
    check(sessionId?: string): RateLimitResult;
    /**
     * Consume a token (call after request is processed)
     */
    consume(sessionId?: string): void;
    /**
     * Reset session bucket
     */
    resetSession(sessionId: string): void;
    /**
     * Get current stats
     */
    getStats(): {
        globalTokens: number;
        globalBurstSize: number;
        sessionCount: number;
        config: RateLimitConfig;
    };
    /**
     * Destroy the rate limiter
     */
    destroy(): void;
    /**
     * Check bucket and refill tokens
     */
    private checkBucket;
    /**
     * Refill tokens based on elapsed time
     */
    private refillBucket;
    /**
     * Consume a token from bucket
     */
    private consumeFromBucket;
    /**
     * Start cleanup timer for expired sessions
     */
    private startCleanup;
}
export declare function createRateLimiter(logger: ILogger, config?: Partial<RateLimitConfig>): RateLimiter;
/**
 * Express/Connect middleware for rate limiting
 */
export declare function rateLimitMiddleware(rateLimiter: RateLimiter): (req: any, res: any, next: () => void) => void;
//# sourceMappingURL=rate-limiter.d.ts.map