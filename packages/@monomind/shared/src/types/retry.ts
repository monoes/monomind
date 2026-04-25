/**
 * Tool Failure Retry Types
 *
 * Defines retry policies, error classifications, and result types
 * for exponential backoff retry logic in MCP tool execution.
 */

// ============================================================================
// Error Type Classifications
// ============================================================================

/**
 * Errors that are safe to retry (transient failures).
 */
export type RetryableErrorType =
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'SERVER_ERROR'
  | 'DB_LOCK'
  | 'NETWORK';

/**
 * Errors that should not be retried (permanent failures).
 */
export type NonRetryableErrorType =
  | 'VALIDATION'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNKNOWN';

// ============================================================================
// Retry Policy
// ============================================================================

/**
 * Configuration for retry behavior with exponential backoff.
 */
export interface ToolRetryPolicy {
  /** Maximum number of attempts (including the initial attempt). */
  maxAttempts: number;
  /** Initial delay in milliseconds before the first retry. */
  initialDelayMs: number;
  /** Maximum delay cap in milliseconds. */
  maxDelayMs: number;
  /** Multiplier applied to the delay after each attempt. */
  backoffMultiplier: number;
  /** Maximum random jitter added to each delay in milliseconds. */
  jitterMs: number;
}

// ============================================================================
// Retry Tracking
// ============================================================================

/**
 * Records a single retry attempt for observability.
 */
export interface RetryAttempt {
  /** Zero-based attempt index. */
  attempt: number;
  /** The error that triggered the retry (or final failure). */
  error: Error;
  /** Classified error type. */
  errorType: RetryableErrorType | NonRetryableErrorType;
  /** Delay in milliseconds before this attempt was made. */
  delayMs: number;
  /** When this attempt occurred. */
  timestamp: Date;
}

/**
 * Result of a retried operation, including full attempt history.
 */
export interface RetryResult<T> {
  /** Whether the operation eventually succeeded. */
  success: boolean;
  /** The resolved value on success. */
  value?: T;
  /** History of all failed attempts. */
  attempts: RetryAttempt[];
  /** Wall-clock duration from first attempt to final resolution. */
  totalDurationMs: number;
  /** True if all attempts were exhausted without success. */
  exhausted: boolean;
}

// ============================================================================
// Preset Policies
// ============================================================================

/**
 * Default retry policy: 3 attempts, 1s initial delay, 2x backoff, 500ms jitter.
 */
export const DEFAULT_TOOL_RETRY: ToolRetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2.0,
  jitterMs: 500,
};

/**
 * Aggressive retry policy: 5 attempts, 500ms initial delay, faster recovery.
 */
export const AGGRESSIVE_TOOL_RETRY: ToolRetryPolicy = {
  maxAttempts: 5,
  initialDelayMs: 500,
  maxDelayMs: 30000,
  backoffMultiplier: 2.0,
  jitterMs: 200,
};

/**
 * No-retry policy: single attempt, fail immediately.
 */
export const NO_RETRY: ToolRetryPolicy = {
  maxAttempts: 1,
  initialDelayMs: 0,
  maxDelayMs: 0,
  backoffMultiplier: 1,
  jitterMs: 0,
};
