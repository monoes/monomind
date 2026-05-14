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
export interface ErrorContext {
    operation: string;
    tool?: string;
    input?: Record<string, unknown>;
    userId?: string;
    agentId?: string;
    requestId?: string;
    timestamp: string;
}
export interface ErrorHandlerConfig {
    includeStack: boolean;
    sanitize: boolean;
    reportToMonitoring: boolean;
    maxErrorsPerMinute: number;
    errorCategories: Record<string, string[]>;
}
export type ErrorCategory = 'validation' | 'authentication' | 'authorization' | 'not_found' | 'rate_limit' | 'timeout' | 'circuit_open' | 'external_service' | 'internal' | 'unknown';
export interface StructuredError {
    success: false;
    error: {
        code: string;
        message: string;
        category: ErrorCategory;
        retryable: boolean;
        retryAfterMs?: number;
        details?: Record<string, unknown>;
    };
    context?: Partial<ErrorContext>;
    timestamp: string;
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
    sanitize(input: Record<string, unknown>, _seen?: WeakSet<object>, _depth?: number): Record<string, unknown>;
    /**
     * Handle an error and return a structured response
     */
    handle(error: Error | string, context?: Partial<ErrorContext>): StructuredError;
    /**
     * Wrap a handler with error handling
     */
    wrap<T extends (...args: unknown[]) => Promise<unknown>>(handler: T, context: Partial<ErrorContext>): T;
    /**
     * Get error statistics
     */
    getStats(): {
        totalErrors: number;
        byCategory: Record<string, number>;
        recentErrors: StructuredError[];
        errorRate: number;
    };
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
export declare function withErrorHandling<T extends (...args: unknown[]) => Promise<unknown>>(handler: T, context?: Partial<ErrorContext>): T;
export default ErrorHandler;
//# sourceMappingURL=error-handler.d.ts.map