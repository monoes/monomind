/**
 * RetryRunner - Core retry loop for structured output auto-retry
 * Task 06: Structured Output Auto-Retry
 *
 * Validates agent output against a Zod or JSON Schema, retrying with
 * error context appended to the re-prompt when validation fails.
 */

import type { ZodSchema } from 'zod';
import { SchemaValidator } from './schema-validator.js';
import type { ValidationError, ValidationResult } from './schema-validator.js';
import type { AgentErrorResult } from './agent-error-result.js';
import { createAgentErrorResult } from './agent-error-result.js';
import type { RetryPolicy } from './retry-policy.js';
import { DEFAULT_RETRY_POLICY } from './retry-policy.js';

export interface RetryRunnerConfig<T> {
  agentSlug: string;
  task: string;
  agentRunner: (task: string) => Promise<unknown>;
  outputSchema: ZodSchema<T> | string;
  policy?: RetryPolicy;
  onRetry?: (attempt: number, errors: ValidationError[], rawOutput: unknown) => void;
}

export async function runAgentWithRetry<T>(
  config: RetryRunnerConfig<T>
): Promise<T | AgentErrorResult> {
  const policy = config.policy ?? DEFAULT_RETRY_POLICY;
  const validator = new SchemaValidator();
  let currentTask = config.task;
  let lastValidationErrors: ValidationError[] = [];
  let lastRawOutput: unknown = undefined;

  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    let rawOutput: unknown;
    try {
      rawOutput = await config.agentRunner(currentTask);
    } catch (runError) {
      if (policy.gracefulDegradation) {
        return createAgentErrorResult(
          config.agentSlug,
          [{ path: '', message: `Agent runner threw: ${String(runError)}` }],
          undefined,
          attempt + 1
        );
      }
      throw runError;
    }

    lastRawOutput = rawOutput;

    let validationResult: ValidationResult;
    if (typeof config.outputSchema === 'string') {
      validationResult = validator.validateWithJsonSchemaFile(rawOutput, config.outputSchema);
    } else {
      validationResult = validator.validateWithZod(rawOutput, config.outputSchema);
    }

    if (validationResult.valid) {
      return rawOutput as T;
    }

    lastValidationErrors = validationResult.errors;

    if (policy.logRetries) {
      console.warn(
        `[RetryRunner] Attempt ${attempt + 1}/${policy.maxAttempts} failed for "${config.agentSlug}":`,
        lastValidationErrors.map((e) => `${e.path}: ${e.message}`).join('; ')
      );
    }

    if (config.onRetry) {
      config.onRetry(attempt + 1, lastValidationErrors, rawOutput);
    }

    if (policy.appendErrorsToReprompt && attempt < policy.maxAttempts - 1) {
      const errorContext = validator.formatErrorsForReprompt(lastValidationErrors);
      currentTask = `${config.task}\n\n${errorContext}`;
    }
  }

  if (policy.gracefulDegradation) {
    return createAgentErrorResult(
      config.agentSlug,
      lastValidationErrors,
      lastRawOutput,
      policy.maxAttempts
    );
  }

  throw new Error(
    `Agent "${config.agentSlug}" failed validation after ${policy.maxAttempts} attempts. ` +
      `Last errors: ${lastValidationErrors.map((e) => e.message).join('; ')}`
  );
}
