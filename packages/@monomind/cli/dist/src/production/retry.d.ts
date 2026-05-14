/**
 * Production Retry Mechanisms
 *
 * Provides retry with:
 * - Exponential backoff
 * - Jitter
 * - Per-error-type configuration
 * - Circuit breaker integration
 *
 * @module @monoes/cli/production/retry
 */
export interface RetryConfig {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    jitter: number;
    nonRetryableErrors: string[];
    shouldRetry?: (error: Error, attempt: number) => boolean;
    onRetry?: (error: Error, attempt: number, delayMs: number) => void;
}
export interface RetryResult<T> {
    success: boolean;
    result?: T;
    error?: Error;
    attempts: number;
    totalTimeMs: number;
    retryHistory: Array<{
        attempt: number;
        error: string;
        delayMs: number;
    }>;
}
export type RetryStrategy = 'exponential' | 'linear' | 'constant' | 'fibonacci';
/**
 * Execute a function with retry logic
 */
export declare function withRetry<T>(fn: () => Promise<T>, config?: Partial<RetryConfig>, strategy?: RetryStrategy): Promise<RetryResult<T>>;
/**
 * Create a retryable version of a function
 */
export declare function makeRetryable<T extends (...args: unknown[]) => Promise<unknown>>(fn: T, config?: Partial<RetryConfig>, strategy?: RetryStrategy): (...args: Parameters<T>) => Promise<RetryResult<Awaited<ReturnType<T>>>>;
/**
 * Retry decorator for class methods
 */
export declare function Retryable(config?: Partial<RetryConfig>, strategy?: RetryStrategy): (_target: unknown, _propertyKey: string, descriptor: PropertyDescriptor) => PropertyDescriptor;
export default withRetry;
//# sourceMappingURL=retry.d.ts.map