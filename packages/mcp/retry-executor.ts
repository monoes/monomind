/**
 * Retry Executor for MCP Tool Calls
 *
 * Provides exponential backoff with jitter for transient failures.
 * Records every attempt for observability and diagnostics.
 * On retry exhaustion, optionally sends the failed message to the DLQ.
 */

import type {
  ToolRetryPolicy,
  RetryAttempt,
  RetryResult,
} from '../@monobrain/shared/src/types/retry.js';
import { classifyError } from './error-classifier.js';

export interface RetryExecutorOptions {
  /** Directory for the dead-letter queue (optional — DLQ disabled if absent). */
  dlqDataDir?: string;
}

/**
 * Calculates the delay for a given attempt index.
 *
 * delay = min(initialDelayMs * backoffMultiplier^attempt, maxDelayMs) + random(0, jitterMs)
 */
export function calculateDelay(
  attempt: number,
  policy: ToolRetryPolicy
): number {
  const exponential = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt);
  const capped = Math.min(exponential, policy.maxDelayMs);
  const jitter = Math.random() * policy.jitterMs;
  return capped + jitter;
}

/**
 * Sleeps for the specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes an async function with retry logic using exponential backoff.
 */
export class RetryExecutor {
  private readonly dlqDataDir?: string;

  constructor(options: RetryExecutorOptions = {}) {
    this.dlqDataDir = options.dlqDataDir;
  }

  /**
   * Executes `fn` with the given retry policy.
   *
   * - On success, returns immediately with `success: true`.
   * - On a non-retryable error, stops and returns `success: false`.
   * - On a retryable error, waits with exponential backoff and retries.
   * - After `maxAttempts` failures, returns with `exhausted: true` and
   *   sends the failure to the DLQ if `dlqDataDir` is configured.
   */
  async execute<T>(
    fn: () => Promise<T>,
    policy: ToolRetryPolicy
  ): Promise<RetryResult<T>> {
    const attempts: RetryAttempt[] = [];
    const startTime = Date.now();

    for (let i = 0; i < policy.maxAttempts; i++) {
      try {
        const value = await fn();
        return {
          success: true,
          value,
          attempts,
          totalDurationMs: Date.now() - startTime,
          exhausted: false,
        };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const classification = classifyError(error);
        const delayMs = i < policy.maxAttempts - 1 ? calculateDelay(i, policy) : 0;

        attempts.push({
          attempt: i,
          error,
          errorType: classification.type,
          delayMs,
          timestamp: new Date(),
        });

        // Stop immediately for non-retryable errors
        if (!classification.retryable) {
          return {
            success: false,
            attempts,
            totalDurationMs: Date.now() - startTime,
            exhausted: false,
          };
        }

        // Wait before next attempt (unless this was the last one)
        if (i < policy.maxAttempts - 1) {
          await sleep(delayMs);
        }
      }
    }

    return {
      success: false,
      attempts,
      totalDurationMs: Date.now() - startTime,
      exhausted: true,
    };
  }

  /**
   * Wraps any async handler with retry logic. The returned function
   * transparently retries on transient failures and throws on exhaustion
   * or non-retryable errors.
   *
   * When `toolName` and `originalInput` are provided and DLQ is configured,
   * exhausted calls are written to the dead-letter queue before throwing.
   */
  wrapHandler<I, O>(
    handler: (input: I) => Promise<O>,
    policy: ToolRetryPolicy,
    toolName?: string
  ): (input: I) => Promise<O> {
    return async (input: I): Promise<O> => {
      const result = await this.execute(() => handler(input), policy);

      if (result.success) {
        return result.value as O;
      }

      const lastAttempt = result.attempts[result.attempts.length - 1];
      const error = lastAttempt?.error ?? new Error('Retry failed with no attempts recorded');

      if (result.exhausted) {
        // Send to DLQ before throwing (Task 37 integration)
        if (this.dlqDataDir && toolName) {
          try {
            const { DLQWriter } = await import('../@monobrain/cli/src/dlq/dlq-writer.js');
            const writer = new DLQWriter(this.dlqDataDir);
            writer.enqueue({
              toolName,
              originalPayload: input,
              deliveryAttempts: result.attempts.map((a) => ({
                attemptedAt: a.timestamp.toISOString(),
                errorMessage: a.error.message,
                errorType: a.errorType,
              })),
            });
          } catch {
            // DLQ write failure must not mask the original error
          }
        }

        const exhaustionError = new Error(
          `Retry exhausted after ${result.attempts.length} attempts: ${error.message}`
        );
        (exhaustionError as any).cause = error;
        (exhaustionError as any).attempts = result.attempts;
        throw exhaustionError;
      }

      throw error;
    };
  }
}
