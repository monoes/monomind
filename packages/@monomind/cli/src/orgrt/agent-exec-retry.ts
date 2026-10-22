// packages/@monomind/cli/src/orgrt/agent-exec-retry.ts
/**
 * Rate-limit retry for `agent exec` (doc/agent-exec-protocol.md §3.4, rev 20).
 *
 * A turn whose runner failed on a transient provider rate limit (HTTP 429 —
 * `code: "rate-limited"`, see provider-limit.ts; exhausted quota or billing
 * stays `quota` and is never retried) is run again, up to
 * RATE_LIMIT_MAX_ATTEMPTS attempts in all, after an exponential backoff with
 * jitter (~2s, ~4s) or the provider's own Retry-After hint, each wait capped
 * at 30s. Before each retry the caller gets
 *   {"type":"status","phase":"notice","message":"Rate limited (429) by <x>; retrying in Ns (attempt 2/3)"}
 * The failed attempt's `error` and `done` are held back, so the caller sees
 * one `start` and one `done` for the whole turn.
 *
 * Safety: a retry starts the turn from scratch only when the failed attempts
 * ran no tool (no `tool_activity` start, no `tool_call`) — nothing to redo
 * twice. When tools ran and the runtime resumes (`agent scan`'s `resume`) a
 * session it bound, the retry resumes that session with RESUME_PROMPT;
 * otherwise the turn fails without a retry. A runtime with no tool signal
 * (`tool_activity_fidelity: "none"`) counts as having run tools.
 *
 * No multiplied retries: when the runtime's CLI already retried the 429
 * itself (pi's auto_retry, aider's litellm backoff, codex's "exceeded retry
 * limit"), the turn fails at once. All waits stay inside `--timeout`: each
 * attempt gets the time left, and a wait that would outlast it ends the turn.
 * A `cancel` frame or SIGINT/SIGTERM during a wait ends it as `cancelled`.
 *
 * After the last attempt: `error {code:"rate-limited", fatal:true}` with
 * "Rate limited by <x> (429) after 3 attempts. Free models are rate-limited;
 * try again later or pick another model." and `done {exit_code: 1}`.
 */

import type { RateLimitHit } from './agent-exec-errors.js';
import type { AgentExecOptions } from './agent-exec-options.js';
import { runnerSpec } from './runner-registry.js';

export const RATE_LIMIT_MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 2_000;
const MAX_WAIT_MS = 30_000;

/** The prompt a resumed retry sends in place of the original one. */
export const RESUME_PROMPT =
  'Continue where you left off. Your previous attempt was cut short by a provider rate limit ' +
  '(429); do not redo steps that already completed.';

const HINT = 'Free models are rate-limited; try again later or pick another model.';

/** Shared between the wrapper and one attempt (agent-exec.ts's runAgentExecOnce). */
export interface AttemptContext {
  /** 1-based attempt number; above 1 the attempt skips `start`. */
  attempt: number;
  /** Set by the attempt when it failed on a transient rate limit. */
  rateLimit?: RateLimitHit;
}

type Event = Record<string, unknown>;
type Attempt = (opts: AgentExecOptions, ctx: AttemptContext) => Promise<number>;

/** Backoff before attempt `next` (2, 3, …): the provider's hint, else
 *  2s·2^(next-2) ±20% jitter; capped at 30s. */
export function backoffMs(next: number, retryAfterMs?: number, random = Math.random): number {
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, MAX_WAIT_MS);
  const base = BASE_BACKOFF_MS * 2 ** (next - 2);
  return Math.min(Math.round(base * (0.8 + 0.4 * random())), MAX_WAIT_MS);
}

/** Run `once` until it succeeds, fails for another reason, or the rate-limit
 *  retry budget is spent (see the module doc). Returns the exit code. */
export async function runWithRateLimitRetry(
  opts: AgentExecOptions,
  once: Attempt,
): Promise<number> {
  const started = Date.now();
  const who = opts.model ?? opts.runtime;
  const spec = runnerSpec(opts.runtime);
  let ranTools = spec?.toolActivityFidelity === 'none';
  let sessionId: string | undefined;
  let attemptOpts = opts;

  const fail = (message: string): number => {
    opts.emit({ v: 1, type: 'error', code: 'rate-limited', fatal: true, message });
    opts.emit({ v: 1, type: 'done', exit_code: 1 });
    return 1;
  };

  for (let attempt = 1; ; attempt++) {
    const ctx: AttemptContext = { attempt };
    const held: Event[] = [];
    const emit = (ev: Event): void => {
      if (held.length > 0 || (ev.type === 'error' && ev.code === 'rate-limited')) {
        held.push(ev);
        return;
      }
      if ((ev.type === 'tool_activity' && ev.phase === 'start') || ev.type === 'tool_call')
        ranTools = true;
      if (ev.type === 'session' && typeof ev.session_id === 'string') sessionId = ev.session_id;
      opts.emit(ev);
    };
    const left = opts.timeoutMs === undefined ? undefined : opts.timeoutMs - (Date.now() - started);
    const exit = await once(
      { ...attemptOpts, emit, ...(left === undefined ? {} : { timeoutMs: Math.max(1, left) }) },
      ctx,
    );
    const hit = ctx.rateLimit;
    if (!hit) {
      for (const ev of held) opts.emit(ev);
      return exit;
    }

    const attempts = attempt + (hit.vendorRetries ?? 0);
    const plural = attempts === 1 ? 'attempt' : 'attempts';
    const vendorNote =
      hit.vendorRetries === undefined
        ? ''
        : ` (${opts.runtime} retried it itself${hit.vendorRetries > 0 ? ` ${hit.vendorRetries} times` : ''})`;
    const exhausted = `Rate limited by ${who} (429) after ${attempts} ${plural}${vendorNote}. ${HINT}`;
    if (hit.vendorRetries !== undefined || attempt >= RATE_LIMIT_MAX_ATTEMPTS)
      return fail(exhausted);

    const resume = ranTools ? (spec?.resume ? sessionId : undefined) : null;
    if (resume === undefined) {
      return fail(
        `Rate limited by ${who} (429) after ${attempts} ${plural}; not retried because the turn ` +
          `had already run tools and ${opts.runtime} cannot resume it. ${HINT}`,
      );
    }
    const wait = backoffMs(attempt + 1, hit.retryAfterMs);
    const leftNow =
      opts.timeoutMs === undefined ? undefined : opts.timeoutMs - (Date.now() - started);
    if (leftNow !== undefined && wait >= leftNow) {
      return fail(
        `Rate limited by ${who} (429) after ${attempts} ${plural}; not retried because the ` +
          `wait would outlast --timeout. ${HINT}`,
      );
    }

    opts.emit({
      v: 1,
      type: 'status',
      phase: 'notice',
      message: `Rate limited (429) by ${who}; retrying in ${Math.ceil(wait / 1000)}s (attempt ${attempt + 1}/${RATE_LIMIT_MAX_ATTEMPTS})`,
    });
    if (await waitOrCancel(wait, opts)) {
      opts.emit({
        v: 1,
        type: 'error',
        code: 'cancelled',
        fatal: false,
        message: 'cancelled by caller',
      });
      opts.emit({ v: 1, type: 'done', exit_code: 130 });
      return 130;
    }
    // A resumed session already holds the `--attach` files (rev 32); resend none.
    attemptOpts =
      resume === null ? opts : { ...opts, resume, prompt: RESUME_PROMPT, attachments: undefined };
  }
}

/** Wait `ms`; resolves true early on SIGINT/SIGTERM or a caller `cancel`
 *  frame (read only when the attempt would read frames: --tools stdio). */
function waitOrCancel(ms: number, opts: AgentExecOptions): Promise<boolean> {
  const stdin =
    (opts.toolSpecs && opts.toolSpecs.length > 0) || opts.stdioFrames
      ? (opts.stdin ?? process.stdin)
      : null;
  return new Promise((resolve) => {
    let buffer = '';
    const settle = (cancelled: boolean): void => {
      clearTimeout(timer);
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      stdin?.removeListener('data', onData);
      resolve(cancelled);
    };
    const onSignal = (): void => settle(true);
    const onData = (chunk: string | Buffer): void => {
      buffer += String(chunk);
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        try {
          if ((JSON.parse(line) as { type?: unknown })?.type === 'cancel') {
            settle(true);
            return;
          }
        } catch {
          /* not a frame; the next attempt's bridge reports bad frames */
        }
      }
    };
    const timer = setTimeout(() => settle(false), ms);
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    stdin?.on('data', onData);
  });
}
