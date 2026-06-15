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
// ============================================================================
// Error Classification
// ============================================================================
const ERROR_PATTERNS = {
    validation: [
        /invalid/i,
        /required/i,
        /missing/i,
        /must be/i,
        /cannot be/i,
        /validation/i,
    ],
    authentication: [
        /unauthorized/i,
        /unauthenticated/i,
        /not authenticated/i,
        /invalid token/i,
        /expired token/i,
    ],
    authorization: [
        /forbidden/i,
        /permission denied/i,
        /access denied/i,
        /not allowed/i,
    ],
    not_found: [
        /not found/i,
        /does not exist/i,
        /no such/i,
        /unknown/i,
    ],
    rate_limit: [
        /rate limit/i,
        /too many requests/i,
        /throttled/i,
    ],
    timeout: [
        /timeout/i,
        /timed out/i,
        /deadline/i,
    ],
    circuit_open: [
        /circuit open/i,
        /service unavailable/i,
        /temporarily unavailable/i,
    ],
    external_service: [
        /ECONNREFUSED/i,
        /ENOTFOUND/i,
        /ETIMEDOUT/i,
        /network/i,
        /connection/i,
    ],
    internal: [
        /internal/i,
        /unexpected/i,
    ],
    unknown: [],
};
const RETRYABLE_CATEGORIES = [
    'timeout',
    'external_service',
    'rate_limit',
    'circuit_open',
];
// Sensitive keys to sanitize
const SENSITIVE_KEYS = [
    'password',
    'token',
    'api_key',
    'apiKey',
    'secret',
    'authorization',
    'bearer',
    'credential',
    'private',
];
// ============================================================================
// Error Handler
// ============================================================================
const DEFAULT_CONFIG = {
    includeStack: process.env.NODE_ENV !== 'production',
    sanitize: true,
    reportToMonitoring: true,
    maxErrorsPerMinute: 100,
    errorCategories: {},
};
export class ErrorHandler {
    config;
    errorCounts = new Map();
    errorLog = [];
    maxLogSize = 1000;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Classify an error into a category
     */
    classifyError(error) {
        const message = typeof error === 'string' ? error : error.message;
        for (const [category, patterns] of Object.entries(ERROR_PATTERNS)) {
            for (const pattern of patterns) {
                if (pattern.test(message)) {
                    return category;
                }
            }
        }
        return 'unknown';
    }
    /**
     * Check if an error category is retryable
     */
    isRetryable(category) {
        return RETRYABLE_CATEGORIES.includes(category);
    }
    /**
     * Sanitize input to remove sensitive data
     * Cycle-safe and depth-bounded — circular references and deeply nested objects
     * will not cause stack overflow.
     */
    sanitize(input, _seen = new WeakSet(), _depth = 0) {
        if (!this.config.sanitize)
            return input;
        if (_depth > 20)
            return { '[MAX_DEPTH]': true };
        // Primitives and null cannot be stored in a WeakSet — return them as-is.
        if (input === null || typeof input !== 'object')
            return input;
        if (_seen.has(input))
            return { '[CIRCULAR]': true };
        _seen.add(input);
        const sanitized = {};
        for (const [key, value] of Object.entries(input)) {
            const lowerKey = key.toLowerCase();
            const isSensitive = SENSITIVE_KEYS.some(sk => lowerKey.includes(sk.toLowerCase()));
            if (isSensitive) {
                sanitized[key] = '[REDACTED]';
            }
            else if (typeof value === 'object' && value !== null) {
                sanitized[key] = this.sanitize(value, _seen, _depth + 1);
            }
            else {
                sanitized[key] = value;
            }
        }
        return sanitized;
    }
    /**
     * Handle an error and return a structured response
     */
    handle(error, context = {}) {
        const message = typeof error === 'string' ? error : error.message;
        const category = this.classifyError(error);
        const retryable = this.isRetryable(category);
        const now = new Date().toISOString();
        // Track error counts for rate limiting and enforce cap
        this.trackError(category);
        const rateEntry = this.errorCounts.get(category);
        if (rateEntry && rateEntry.count > this.config.maxErrorsPerMinute) {
            return {
                success: false,
                error: {
                    code: 'ERR_RATE_LIMITED',
                    message: 'Error rate limit exceeded',
                    category,
                    retryable: false,
                },
                context,
                timestamp: new Date().toISOString(),
            };
        }
        // Build structured error
        const structured = {
            success: false,
            error: {
                code: this.getErrorCode(category),
                message: this.sanitizeMessage(message),
                category,
                retryable,
                retryAfterMs: retryable ? this.getRetryDelay(category) : undefined,
            },
            context: context.input
                ? { ...context, input: this.sanitize(context.input) }
                : context,
            timestamp: now,
        };
        // Include stack trace in non-production
        if (this.config.includeStack && error instanceof Error && error.stack) {
            structured.error.details = { stack: error.stack };
        }
        // Log error
        this.logError(structured);
        return structured;
    }
    /**
     * Wrap a handler with error handling
     */
    wrap(handler, context) {
        return (async (...args) => {
            try {
                return await handler(...args);
            }
            catch (error) {
                return this.handle(error, {
                    ...context,
                    input: args[0],
                });
            }
        });
    }
    /**
     * Get error statistics
     */
    getStats() {
        const byCategory = {};
        for (const error of this.errorLog) {
            const cat = error.error.category;
            byCategory[cat] = (byCategory[cat] || 0) + 1;
        }
        // Calculate error rate (errors per minute in last 5 minutes)
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        const recentCount = this.errorLog.filter(e => new Date(e.timestamp).getTime() > fiveMinutesAgo).length;
        const errorRate = recentCount / 5;
        return {
            totalErrors: this.errorLog.length,
            byCategory,
            recentErrors: this.errorLog.slice(-10),
            errorRate,
        };
    }
    /**
     * Clear error log
     */
    clearLog() {
        this.errorLog = [];
        this.errorCounts.clear();
    }
    // ============================================================================
    // Private Methods
    // ============================================================================
    getErrorCode(category) {
        const codes = {
            validation: 'ERR_VALIDATION',
            authentication: 'ERR_AUTHENTICATION',
            authorization: 'ERR_AUTHORIZATION',
            not_found: 'ERR_NOT_FOUND',
            rate_limit: 'ERR_RATE_LIMIT',
            timeout: 'ERR_TIMEOUT',
            circuit_open: 'ERR_CIRCUIT_OPEN',
            external_service: 'ERR_EXTERNAL_SERVICE',
            internal: 'ERR_INTERNAL',
            unknown: 'ERR_UNKNOWN',
        };
        return codes[category];
    }
    getRetryDelay(category) {
        const delays = {
            timeout: 1000,
            external_service: 2000,
            rate_limit: 5000,
            circuit_open: 30000,
            validation: 0,
            authentication: 0,
            authorization: 0,
            not_found: 0,
            internal: 0,
            unknown: 0,
        };
        return delays[category];
    }
    sanitizeMessage(message) {
        if (!this.config.sanitize)
            return message;
        // Remove potential sensitive data from message
        let sanitized = message;
        for (const key of SENSITIVE_KEYS) {
            // Use a non-backtracking pattern: key followed by = or : then non-whitespace
            const pattern = new RegExp(`${key}[=:]\\S+`, 'gi');
            sanitized = sanitized.replace(pattern, `${key}=[REDACTED]`);
        }
        return sanitized;
    }
    trackError(category) {
        const now = Date.now();
        const key = category;
        const entry = this.errorCounts.get(key);
        if (!entry || now > entry.resetAt) {
            this.errorCounts.set(key, { count: 1, resetAt: now + 60000 });
        }
        else {
            entry.count++;
        }
    }
    logError(error) {
        this.errorLog.push(error);
        // Trim log if too large
        if (this.errorLog.length > this.maxLogSize) {
            this.errorLog = this.errorLog.slice(-this.maxLogSize / 2);
        }
    }
}
// ============================================================================
// Convenience Functions
// ============================================================================
const defaultHandler = new ErrorHandler();
/**
 * Wrap a handler with error handling (convenience function)
 */
export function withErrorHandling(handler, context = {}) {
    return defaultHandler.wrap(handler, context);
}
export default ErrorHandler;
//# sourceMappingURL=error-handler.js.map