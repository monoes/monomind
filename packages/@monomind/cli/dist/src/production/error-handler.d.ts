/**
 * Production Error Handling
 *
 * Provides standardized error handling with:
 * - Error classification
 * - Sanitization (no sensitive data leak)
 * - Structured error responses
 * - Error aggregation and reporting
 *
 * @module @monomind/cli/production/error-handler
 */
/**
 * Error category derived from message-pattern classification.
 */
export type ErrorCategory = 'validation' | 'authentication' | 'authorization' | 'not_found' | 'rate_limit' | 'timeout' | 'circuit_open' | 'external_service' | 'internal' | 'unknown';
/**
 * Configuration for the {@link ErrorHandler}.
 */
export interface ErrorHandlerConfig {
    /** Include stack traces in structured errors (default: off in production). */
    includeStack: boolean;
    /** Redact sensitive keys/values from context and messages. */
    sanitize: boolean;
    /** Whether errors should be forwarded to monitoring. */
    reportToMonitoring: boolean;
    /** Per-category cap before responses are rate-limited. */
    maxErrorsPerMinute: number;
    /** Optional per-category overrides. */
    errorCategories: Record<string, unknown>;
}
/**
 * Contextual metadata attached to a handled error.
 */
export interface ErrorContext {
    /** The input that triggered the error (sanitized when handled). */
    input?: unknown;
    /** Arbitrary additional context fields. */
    [key: string]: unknown;
}
/**
 * The error payload embedded in a structured error response.
 */
export interface StructuredErrorPayload {
    code: string;
    message: string;
    category: ErrorCategory;
    retryable: boolean;
    retryAfterMs?: number;
    details?: {
        stack: string;
    };
}
/**
 * A standardized, structured error response.
 */
export interface StructuredError {
    success: false;
    error: StructuredErrorPayload;
    context: ErrorContext;
    timestamp: string;
}
/**
 * Aggregated error statistics returned by {@link ErrorHandler.getStats}.
 */
export interface ErrorStats {
    totalErrors: number;
    byCategory: Record<string, number>;
    recentErrors: StructuredError[];
    /** Errors per minute over the last 5 minutes. */
    errorRate: number;
}
export declare class ErrorHandler {
    private config;
    private errorCounts;
    private errorLog;
    private maxLogSize;
    constructor(config?: Partial<ErrorHandlerConfig>);
    /**
     * Classify an error into a category
     */
    classifyError(error: Error | string): ErrorCategory;
    /**
     * Check if an error category is retryable
     */
    isRetryable(category: ErrorCategory): boolean;
    /**
     * Sanitize input to remove sensitive data
     * Cycle-safe and depth-bounded — circular references and deeply nested objects
     * will not cause stack overflow.
     */
    sanitize(input: unknown, _seen?: WeakSet<object>, _depth?: number): unknown;
    /**
     * Handle an error and return a structured response
     */
    handle(error: Error | string, context?: ErrorContext): StructuredError;
    /**
     * Wrap a handler with error handling
     */
    wrap<TArgs extends unknown[], TResult>(handler: (...args: TArgs) => Promise<TResult>, context?: ErrorContext): (...args: TArgs) => Promise<TResult | StructuredError>;
    /**
     * Get error statistics
     */
    getStats(): ErrorStats;
    /**
     * Clear error log
     */
    clearLog(): void;
    private getErrorCode;
    private getRetryDelay;
    private sanitizeMessage;
    private trackError;
    private logError;
}
/**
 * Wrap a handler with error handling (convenience function)
 */
export declare function withErrorHandling<TArgs extends unknown[], TResult>(handler: (...args: TArgs) => Promise<TResult>, context?: ErrorContext): (...args: TArgs) => Promise<TResult | StructuredError>;
export default ErrorHandler;
//# sourceMappingURL=error-handler.d.ts.map