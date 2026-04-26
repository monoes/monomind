/**
 * Tests for RetryExecutor, classifyError, and retry types.
 *
 * Uses vitest with --globals (describe/it/expect are global).
 */

import { describe, it, expect, vi } from 'vitest';

import { RetryExecutor, calculateDelay } from '../../packages/mcp/retry-executor.js';
import { classifyError } from '../../packages/mcp/error-classifier.js';
import {
  DEFAULT_TOOL_RETRY,
  AGGRESSIVE_TOOL_RETRY,
  NO_RETRY,
  type ToolRetryPolicy,
} from '../../packages/@monomind/shared/src/types/retry.js';

const executor = new RetryExecutor();

// A fast policy so tests don't wait on real delays
const FAST_POLICY: ToolRetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 1,
  maxDelayMs: 10,
  backoffMultiplier: 2,
  jitterMs: 0,
};

// ============================================================================
// RetryExecutor.execute
// ============================================================================

describe('RetryExecutor.execute', () => {
  it('succeeds on first attempt without retrying', async () => {
    const handler = vi.fn().mockResolvedValue('ok');
    const result = await executor.execute(handler, FAST_POLICY);

    expect(result.success).toBe(true);
    expect(result.value).toBe('ok');
    expect(result.attempts).toHaveLength(0);
    expect(result.exhausted).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable error and succeeds on 2nd attempt', async () => {
    const handler = vi.fn()
      .mockRejectedValueOnce(new Error('429 rate limit exceeded'))
      .mockResolvedValue('recovered');

    const result = await executor.execute(handler, FAST_POLICY);

    expect(result.success).toBe(true);
    expect(result.value).toBe('recovered');
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].errorType).toBe('RATE_LIMIT');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('exhausts all attempts and returns exhausted=true', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('connection ECONNRESET'));

    const result = await executor.execute(handler, FAST_POLICY);

    expect(result.success).toBe(false);
    expect(result.exhausted).toBe(true);
    expect(result.attempts).toHaveLength(3);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retryable errors', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('validation failed'));

    const result = await executor.execute(handler, FAST_POLICY);

    expect(result.success).toBe(false);
    expect(result.exhausted).toBe(false);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].errorType).toBe('UNKNOWN');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('records increasing delays for exponential backoff', async () => {
    const policy: ToolRetryPolicy = {
      maxAttempts: 4,
      initialDelayMs: 1,
      maxDelayMs: 100,
      backoffMultiplier: 2,
      jitterMs: 0,
    };
    const handler = vi.fn().mockRejectedValue(new Error('timeout'));

    const result = await executor.execute(handler, policy);

    expect(result.exhausted).toBe(true);
    // With jitter=0: delays should be 1, 2, 4 (last attempt has 0 delay)
    expect(result.attempts[0].delayMs).toBeCloseTo(1, 0);
    expect(result.attempts[1].delayMs).toBeCloseTo(2, 0);
    expect(result.attempts[2].delayMs).toBeCloseTo(4, 0);
  });

  it('adds jitter randomness to delays', async () => {
    const policy: ToolRetryPolicy = {
      maxAttempts: 3,
      initialDelayMs: 10,
      maxDelayMs: 1000,
      backoffMultiplier: 2,
      jitterMs: 100,
    };
    const handler = vi.fn().mockRejectedValue(new Error('timeout'));

    const result = await executor.execute(handler, policy);

    // With jitter=100: delay >= base and delay < base + 100
    expect(result.attempts[0].delayMs).toBeGreaterThanOrEqual(10);
    expect(result.attempts[0].delayMs).toBeLessThan(110);
  });

  it('respects maxDelayMs cap', async () => {
    const policy: ToolRetryPolicy = {
      maxAttempts: 5,
      initialDelayMs: 100,
      maxDelayMs: 50,
      backoffMultiplier: 10,
      jitterMs: 0,
    };
    const handler = vi.fn().mockRejectedValue(new Error('500 internal server error'));

    const result = await executor.execute(handler, policy);

    // All delays should be capped at maxDelayMs (50)
    for (const attempt of result.attempts) {
      if (attempt.delayMs > 0) {
        expect(attempt.delayMs).toBeLessThanOrEqual(50);
      }
    }
  });
});

// ============================================================================
// classifyError
// ============================================================================

describe('classifyError', () => {
  it('classifies 429 as RATE_LIMIT (retryable)', () => {
    const classification = classifyError(new Error('HTTP 429 Too Many Requests'));
    expect(classification.type).toBe('RATE_LIMIT');
    expect(classification.retryable).toBe(true);
  });

  it('classifies timeout as TIMEOUT (retryable)', () => {
    const classification = classifyError(new Error('Request timed out (ETIMEDOUT)'));
    expect(classification.type).toBe('TIMEOUT');
    expect(classification.retryable).toBe(true);
  });

  it('classifies SQLITE_BUSY as DB_LOCK (retryable)', () => {
    const classification = classifyError(new Error('SQLITE_BUSY: database is locked'));
    expect(classification.type).toBe('DB_LOCK');
    expect(classification.retryable).toBe(true);
  });

  it('classifies unknown error as UNKNOWN (non-retryable)', () => {
    const classification = classifyError(new Error('invalid input format'));
    expect(classification.type).toBe('UNKNOWN');
    expect(classification.retryable).toBe(false);
  });

  it('classifies ECONNRESET as NETWORK (retryable)', () => {
    const classification = classifyError(new Error('read ECONNRESET'));
    expect(classification.type).toBe('NETWORK');
    expect(classification.retryable).toBe(true);
  });

  it('classifies 403 as PERMISSION_DENIED (non-retryable)', () => {
    const classification = classifyError(new Error('403 Forbidden'));
    expect(classification.type).toBe('PERMISSION_DENIED');
    expect(classification.retryable).toBe(false);
  });

  it('classifies 404 as NOT_FOUND (non-retryable)', () => {
    const classification = classifyError(new Error('Resource not found (404)'));
    expect(classification.type).toBe('NOT_FOUND');
    expect(classification.retryable).toBe(false);
  });
});

// ============================================================================
// RetryExecutor.wrapHandler
// ============================================================================

describe('RetryExecutor.wrapHandler', () => {
  it('throws after exhausting all retries', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('500 server error'));
    const wrapped = executor.wrapHandler(handler, FAST_POLICY);

    await expect(wrapped('input')).rejects.toThrow(/Retry exhausted after 3 attempts/);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('returns value on eventual success', async () => {
    const handler = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue(42);

    const wrapped = executor.wrapHandler(handler, FAST_POLICY);
    const result = await wrapped('input');

    expect(result).toBe(42);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on non-retryable error', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('permission denied'));
    const wrapped = executor.wrapHandler(handler, FAST_POLICY);

    await expect(wrapped('test')).rejects.toThrow('permission denied');
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Preset policies
// ============================================================================

describe('Preset policies', () => {
  it('DEFAULT_TOOL_RETRY has expected values', () => {
    expect(DEFAULT_TOOL_RETRY.maxAttempts).toBe(3);
    expect(DEFAULT_TOOL_RETRY.initialDelayMs).toBe(1000);
    expect(DEFAULT_TOOL_RETRY.backoffMultiplier).toBe(2.0);
    expect(DEFAULT_TOOL_RETRY.jitterMs).toBe(500);
  });

  it('AGGRESSIVE_TOOL_RETRY has 5 attempts', () => {
    expect(AGGRESSIVE_TOOL_RETRY.maxAttempts).toBe(5);
    expect(AGGRESSIVE_TOOL_RETRY.initialDelayMs).toBe(500);
  });

  it('NO_RETRY has 1 attempt', () => {
    expect(NO_RETRY.maxAttempts).toBe(1);
  });
});
