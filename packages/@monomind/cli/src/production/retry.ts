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

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: 0.1,
  nonRetryableErrors: [
    'validation',
    'authentication',
    'authorization',
    'not_found',
  ],
};

// ============================================================================
// Retry Implementation
// ============================================================================

/**
 * Calculate delay for a given attempt
 */
function calculateDelay(
  attempt: number,
  config: RetryConfig,
  strategy: RetryStrategy = 'exponential',
): number {
  let delay: number;
  switch (strategy) {
    case 'linear':
      delay = config.initialDelayMs * attempt;
      break;
    case 'constant':
      delay = config.initialDelayMs;
      break;
    case 'fibonacci':
      delay = config.initialDelayMs * fibonacci(attempt);
      break;
    case 'exponential':
    default:
      delay =
        config.initialDelayMs *
        Math.pow(config.backoffMultiplier, attempt - 1);
  }

  // Apply max delay cap
  delay = Math.min(delay, config.maxDelayMs);

  // Apply jitter
  if (config.jitter > 0) {
    const jitterRange = delay * config.jitter;
    delay += (Math.random() - 0.5) * 2 * jitterRange;
  }

  return Math.round(Math.max(0, delay));
}

/**
 * Fibonacci helper for fibonacci backoff
 */
function fibonacci(n: number): number {
  if (n <= 1) return 1;
  let a = 1,
    b = 1;
  for (let i = 2; i <= n; i++) {
    [a, b] = [b, a + b];
  }
  return b;
}

/**
 * Check if an error should be retried
 */
function shouldRetryError(
  error: Error,
  attempt: number,
  config: RetryConfig,
): boolean {
  // Check custom retry function
  if (config.shouldRetry) {
    return config.shouldRetry(error, attempt);
  }

  // Check non-retryable error patterns
  const message = error.message.toLowerCase();
  for (const pattern of config.nonRetryableErrors) {
    if (message.includes(pattern.toLowerCase())) {
      return false;
    }
  }

  // Default: retry if we haven't exceeded max attempts
  return attempt < config.maxAttempts;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  strategy: RetryStrategy = 'exponential',
): Promise<RetryResult<T>> {
  const finalConfig: RetryConfig = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();
  const retryHistory: RetryResult<T>['retryHistory'] = [];
  let lastError: Error | undefined;
  let attempt = 0;

  while (attempt < finalConfig.maxAttempts) {
    attempt++;
    try {
      const result = await fn();
      return {
        success: true,
        result,
        attempts: attempt,
        totalTimeMs: Date.now() - startTime,
        retryHistory,
      };
    } catch (error) {
      lastError = error as Error;

      // Check if we should retry
      if (!shouldRetryError(lastError, attempt, finalConfig)) {
        return {
          success: false,
          error: lastError,
          attempts: attempt,
          totalTimeMs: Date.now() - startTime,
          retryHistory,
        };
      }

      // Calculate delay
      const delay = calculateDelay(attempt, finalConfig, strategy);

      // Record retry
      retryHistory.push({
        attempt,
        error: lastError.message,
        delayMs: delay,
      });

      // Call retry callback
      if (finalConfig.onRetry) {
        finalConfig.onRetry(lastError, attempt, delay);
      }

      // Wait before retrying
      if (attempt < finalConfig.maxAttempts) {
        await sleep(delay);
      }
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: attempt,
    totalTimeMs: Date.now() - startTime,
    retryHistory,
  };
}

/**
 * Create a retryable version of a function
 */
export function makeRetryable<
  T extends (...args: unknown[]) => Promise<unknown>,
>(
  fn: T,
  config: Partial<RetryConfig> = {},
  strategy: RetryStrategy = 'exponential',
): (...args: Parameters<T>) => Promise<RetryResult<Awaited<ReturnType<T>>>> {
  return async (...args: Parameters<T>) => {
    return withRetry(
      () => fn(...args) as Promise<Awaited<ReturnType<T>>>,
      config,
      strategy,
    );
  };
}

/**
 * Retry decorator for class methods
 */
export function Retryable(
  config: Partial<RetryConfig> = {},
  strategy: RetryStrategy = 'exponential',
): (
  _target: unknown,
  _propertyKey: string,
  descriptor: PropertyDescriptor,
) => PropertyDescriptor {
  return function (
    _target: unknown,
    _propertyKey: string,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    const originalMethod = descriptor.value as (
      ...args: unknown[]
    ) => Promise<unknown>;
    descriptor.value = async function (
      this: unknown,
      ...args: unknown[]
    ): Promise<unknown> {
      const result = await withRetry(
        () => originalMethod.apply(this, args),
        config,
        strategy,
      );
      if (result.success) {
        return result.result;
      }
      throw result.error;
    };
    return descriptor;
  };
}

export default withRetry;
