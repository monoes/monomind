/**
 * Error Classifier for MCP Tool Retry
 *
 * Inspects error messages and properties to determine whether an error
 * is transient (retryable) or permanent (non-retryable).
 */

import type { RetryableErrorType, NonRetryableErrorType } from '../@monobrain/shared/src/types/retry.js';

export interface ErrorClassification {
  type: RetryableErrorType | NonRetryableErrorType;
  retryable: boolean;
}

/**
 * Pattern-based rules evaluated in order. First match wins.
 */
const RETRYABLE_PATTERNS: Array<{
  pattern: RegExp;
  type: RetryableErrorType;
}> = [
  { pattern: /429|rate.?limit/i, type: 'RATE_LIMIT' },
  { pattern: /timeout|ETIMEDOUT|timed?\s*out/i, type: 'TIMEOUT' },
  { pattern: /5\d{2}\b|internal.?server.?error|bad.?gateway|service.?unavailable/i, type: 'SERVER_ERROR' },
  { pattern: /SQLITE_BUSY|database.?is.?locked|lock/i, type: 'DB_LOCK' },
  { pattern: /ECONNRESET|ENOTFOUND|ECONNREFUSED|ENETUNREACH|network|socket.?hang.?up/i, type: 'NETWORK' },
];

const NON_RETRYABLE_PATTERNS: Array<{
  pattern: RegExp;
  type: NonRetryableErrorType;
}> = [
  { pattern: /permission.?denied|forbidden|403|unauthorized|401/i, type: 'PERMISSION_DENIED' },
  { pattern: /not.?found|404/i, type: 'NOT_FOUND' },
  { pattern: /conflict|409/i, type: 'CONFLICT' },
];

/**
 * Classifies an error as retryable or non-retryable based on its message
 * and common HTTP/system error patterns.
 */
export function classifyError(error: Error): ErrorClassification {
  const message = error.message || '';

  for (const { pattern, type } of RETRYABLE_PATTERNS) {
    if (pattern.test(message)) {
      return { type, retryable: true };
    }
  }

  for (const { pattern, type } of NON_RETRYABLE_PATTERNS) {
    if (pattern.test(message)) {
      return { type, retryable: false };
    }
  }

  // Default: unclassified error (non-retryable)
  return { type: 'UNKNOWN', retryable: false };
}
