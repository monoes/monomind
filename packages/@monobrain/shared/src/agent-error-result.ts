/**
 * AgentErrorResult - Typed error container for failed agent retries
 * Task 06: Structured Output Auto-Retry
 */

import type { ValidationError } from './schema-validator.js';

export interface AgentErrorResult {
  __agentError: true;
  agentSlug: string;
  errorSummary: string;
  validationErrors: ValidationError[];
  lastRawOutput: unknown;
  attemptsExhausted: number;
  failedAt: string;
}

export function isAgentErrorResult(value: unknown): value is AgentErrorResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__agentError' in value &&
    (value as AgentErrorResult).__agentError === true
  );
}

export function createAgentErrorResult(
  agentSlug: string,
  validationErrors: ValidationError[],
  lastRawOutput: unknown,
  attemptsExhausted: number
): AgentErrorResult {
  return {
    __agentError: true,
    agentSlug,
    errorSummary:
      `Agent "${agentSlug}" failed schema validation after ${attemptsExhausted} attempt(s). ` +
      `Last errors: ${validationErrors.map((e) => e.message).join('; ')}`,
    validationErrors,
    lastRawOutput,
    attemptsExhausted,
    failedAt: new Date().toISOString(),
  };
}
