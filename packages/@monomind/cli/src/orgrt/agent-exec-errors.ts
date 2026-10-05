// packages/@monomind/cli/src/orgrt/agent-exec-errors.ts

import { classifyStderr } from './kimicode-runner-parse.js';
import { parseRetryAfterMs, vendorRetriesOf } from './provider-limit.js';
import { RunnerTransportError } from './runner-transport-error.js';

// ─── errors (§3.4 taxonomy) ─────────────────────────────────────────────────

export type ExecErrorCode =
  | 'auth'
  | 'quota'
  | 'rate-limited'
  | 'missing-binary'
  | 'no-runner'
  | 'budget'
  | 'runner-error'
  | 'timeout'
  | 'cancelled'
  | 'bad-frame'
  | 'unsafe'
  | 'unsupported';

export const FATAL_CODES = new Set<ExecErrorCode>([
  'auth',
  'quota',
  // rev 20: only ever emitted once agent-exec-retry.ts has given up.
  'rate-limited',
  'missing-binary',
  'no-runner',
  'budget',
  'unsafe',
  'unsupported',
]);

/** A turn that failed on a transient provider rate limit (rev 20). */
export interface RateLimitHit {
  /** The runner's own error text. */
  message: string;
  /** The provider's Retry-After hint, capped (provider-limit.ts). */
  retryAfterMs?: number;
  /** Retries the runtime's CLI already made itself (0 = count unknown);
   *  undefined when it made none. */
  vendorRetries?: number;
}

/** A credential that was never set: pi's "No API key found for …", the
 *  runners' own "missing API key: set X" (#532), and hermes's "No inference
 *  provider configured" / "no API keys or providers found". §3.4 `auth`. */
const MISSING_KEY_RE =
  /\bmissing api key\b|\bno api key (?:found|configured)\b|\bno inference provider configured\b|\bno api keys or providers found\b/i;

/** Runners put text they did not write themselves (a CLI's stdout, the
 *  model's final words) after this marker in an error message.
 *  execErrorCode classifies only what comes before it, so model output can
 *  never turn a failure into auth, quota or a rate limit. */
export const UNCLASSIFIED_MARKER = '\n[output below is not classified]\n';

/** The part of an error message execErrorCode classifies. */
export function classifiedText(message: string): string {
  const i = message.indexOf(UNCLASSIFIED_MARKER);
  return i === -1 ? message : message.slice(0, i);
}

/** §3.4 code for a runner failure's text (anything but a missing binary). */
export function execErrorCode(
  err: unknown,
  fullMessage: string,
): { code: ExecErrorCode; rateLimit?: RateLimitHit } {
  if (err instanceof RunnerTransportError && err.code !== 'rate-limited') return { code: err.code };
  const message = classifiedText(fullMessage);
  if (MISSING_KEY_RE.test(message)) return { code: 'auth' };
  const cls = classifyStderr(message);
  if (!cls.fatal) return { code: 'runner-error' };
  if (/auth/i.test(cls.label ?? '')) return { code: 'auth' };
  if (!cls.rateLimited) return { code: 'quota' };
  const retryAfterMs = parseRetryAfterMs(message);
  const vendorRetries = vendorRetriesOf(err, message);
  return {
    code: 'rate-limited',
    rateLimit: {
      message,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      ...(vendorRetries !== undefined ? { vendorRetries } : {}),
    },
  };
}
