/**
 * RetryPolicy - Configuration for structured output auto-retry behavior
 * Task 06: Structured Output Auto-Retry
 */

export interface RetryPolicy {
  maxAttempts: number;
  appendErrorsToReprompt: boolean;
  logRetries: boolean;
  gracefulDegradation: boolean;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  appendErrorsToReprompt: true,
  logRetries: true,
  gracefulDegradation: true,
};

export const STRICT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  appendErrorsToReprompt: true,
  logRetries: true,
  gracefulDegradation: false,
};

export const LENIENT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 1,
  appendErrorsToReprompt: false,
  logRetries: false,
  gracefulDegradation: true,
};
