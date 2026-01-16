/**
 * Tests for RetryRunner - Structured Output Auto-Retry
 * Task 06
 */

import { describe, it, expect, vi } from 'vitest';

import { z } from 'zod';
import { runAgentWithRetry } from '../../packages/@monobrain/shared/src/retry-runner.js';
import { isAgentErrorResult } from '../../packages/@monobrain/shared/src/agent-error-result.js';
import {
  DEFAULT_RETRY_POLICY,
  STRICT_RETRY_POLICY,
} from '../../packages/@monobrain/shared/src/retry-policy.js';

const outputSchema = z.object({
  summary: z.string(),
  count: z.number(),
});

type Output = z.infer<typeof outputSchema>;

describe('runAgentWithRetry', () => {
  it('returns parsed output when first run succeeds', async () => {
    const runner = vi.fn().mockResolvedValue({ summary: 'ok', count: 42 });

    const result = await runAgentWithRetry<Output>({
      agentSlug: 'test-agent',
      task: 'do something',
      agentRunner: runner,
      outputSchema,
    });

    expect(runner).toHaveBeenCalledTimes(1);
    expect(isAgentErrorResult(result)).toBe(false);
    expect(result).toEqual({ summary: 'ok', count: 42 });
  });

  it('retries when output fails validation, succeeds on second attempt', async () => {
    const runner = vi
      .fn()
      .mockResolvedValueOnce({ summary: 'bad' }) // missing count
      .mockResolvedValueOnce({ summary: 'good', count: 7 });

    const result = await runAgentWithRetry<Output>({
      agentSlug: 'test-agent',
      task: 'do something',
      agentRunner: runner,
      outputSchema,
    });

    expect(runner).toHaveBeenCalledTimes(2);
    expect(isAgentErrorResult(result)).toBe(false);
    expect(result).toEqual({ summary: 'good', count: 7 });
  });

  it('appends error context to re-prompt task on retry', async () => {
    const runner = vi
      .fn()
      .mockResolvedValueOnce({ summary: 123 }) // wrong type
      .mockResolvedValueOnce({ summary: 'ok', count: 1 });

    await runAgentWithRetry<Output>({
      agentSlug: 'test-agent',
      task: 'original task',
      agentRunner: runner,
      outputSchema,
      policy: { ...DEFAULT_RETRY_POLICY, logRetries: false },
    });

    // Second call should have a longer task with error context appended
    const secondCallTask = runner.mock.calls[1][0] as string;
    expect(secondCallTask.length).toBeGreaterThan('original task'.length);
    expect(secondCallTask).toContain('original task');
  });

  it('calls onRetry callback on each failed attempt', async () => {
    const onRetry = vi.fn();
    const runner = vi
      .fn()
      .mockResolvedValueOnce({ bad: true })
      .mockResolvedValueOnce({ also: 'bad' })
      .mockResolvedValueOnce({ summary: 'ok', count: 1 });

    await runAgentWithRetry<Output>({
      agentSlug: 'test-agent',
      task: 'task',
      agentRunner: runner,
      outputSchema,
      policy: { ...DEFAULT_RETRY_POLICY, logRetries: false },
      onRetry,
    });

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][0]).toBe(1); // attempt 1
    expect(onRetry.mock.calls[1][0]).toBe(2); // attempt 2
  });

  it('returns AgentErrorResult when all attempts fail with gracefulDegradation', async () => {
    const runner = vi.fn().mockResolvedValue({ wrong: 'shape' });

    const result = await runAgentWithRetry<Output>({
      agentSlug: 'failing-agent',
      task: 'task',
      agentRunner: runner,
      outputSchema,
      policy: { ...DEFAULT_RETRY_POLICY, logRetries: false },
    });

    expect(isAgentErrorResult(result)).toBe(true);
    if (isAgentErrorResult(result)) {
      expect(result.attemptsExhausted).toBe(DEFAULT_RETRY_POLICY.maxAttempts);
    }
  });

  it('throws when all attempts fail with gracefulDegradation=false', async () => {
    const runner = vi.fn().mockResolvedValue({ wrong: 'shape' });

    await expect(
      runAgentWithRetry<Output>({
        agentSlug: 'strict-agent',
        task: 'task',
        agentRunner: runner,
        outputSchema,
        policy: { ...STRICT_RETRY_POLICY },
      })
    ).rejects.toThrow('failed validation after 5 attempts');
  });

  it('AgentErrorResult includes agentSlug', async () => {
    const runner = vi.fn().mockResolvedValue({});

    const result = await runAgentWithRetry<Output>({
      agentSlug: 'my-slug',
      task: 'task',
      agentRunner: runner,
      outputSchema,
      policy: { ...DEFAULT_RETRY_POLICY, logRetries: false },
    });

    expect(isAgentErrorResult(result)).toBe(true);
    if (isAgentErrorResult(result)) {
      expect(result.agentSlug).toBe('my-slug');
    }
  });

  it('AgentErrorResult preserves lastRawOutput', async () => {
    const badOutput = { summary: 'ok' }; // missing count
    const runner = vi.fn().mockResolvedValue(badOutput);

    const result = await runAgentWithRetry<Output>({
      agentSlug: 'test',
      task: 'task',
      agentRunner: runner,
      outputSchema,
      policy: { ...DEFAULT_RETRY_POLICY, logRetries: false },
    });

    expect(isAgentErrorResult(result)).toBe(true);
    if (isAgentErrorResult(result)) {
      expect(result.lastRawOutput).toEqual(badOutput);
    }
  });

  it('returns AgentErrorResult when runner throws with gracefulDegradation', async () => {
    const runner = vi.fn().mockRejectedValue(new Error('network failure'));

    const result = await runAgentWithRetry<Output>({
      agentSlug: 'crasher',
      task: 'task',
      agentRunner: runner,
      outputSchema,
      policy: { ...DEFAULT_RETRY_POLICY, logRetries: false },
    });

    expect(isAgentErrorResult(result)).toBe(true);
    if (isAgentErrorResult(result)) {
      expect(result.errorSummary).toContain('network failure');
      expect(result.attemptsExhausted).toBe(1);
    }
  });
});

describe('isAgentErrorResult', () => {
  it('returns true for a valid AgentErrorResult', () => {
    const err = {
      __agentError: true as const,
      agentSlug: 'x',
      errorSummary: 'fail',
      validationErrors: [],
      lastRawOutput: null,
      attemptsExhausted: 1,
      failedAt: new Date().toISOString(),
    };
    expect(isAgentErrorResult(err)).toBe(true);
  });

  it('returns false for normal output', () => {
    expect(isAgentErrorResult({ summary: 'ok', count: 1 })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isAgentErrorResult(null)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isAgentErrorResult('hello')).toBe(false);
  });
});
