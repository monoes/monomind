/**
 * Reusable init-state tracker with a counter-with-max pattern.
 *
 * - Allows transient failures (returns NOT_READY) without permanently disabling
 * - Permanently disables after maxAttempts consecutive failures
 * - Thread-safe for single-threaded JS (no concurrent writes)
 *
 * Usage:
 *   const state = createInitState({ maxAttempts: 3 });
 *   if (state.canTry()) {
 *     try { ... state.markReady(); }
 *     catch { state.markFailed(); }
 *   }
 */

export type InitStatus = 'pending' | 'ready' | 'failed';

export interface InitState {
  /** True if another init attempt should be made */
  canTry(): boolean;
  /** Mark initialization as permanently successful */
  markReady(): void;
  /** Mark this attempt as failed; permanently fails after maxAttempts */
  markFailed(): void;
  /** Immediately mark as permanently failed without consuming retry budget */
  markPermanentlyFailed(): void;
  /** True if init succeeded */
  isReady(): boolean;
  /** True if permanently failed (exhausted retries) */
  isFailed(): boolean;
  /** Number of failed attempts so far */
  attempts(): number;
}

export function createInitState(opts: { maxAttempts?: number } = {}): InitState {
  const max = opts.maxAttempts ?? 3;
  let status: InitStatus = 'pending';
  let count = 0;

  return {
    canTry() { return status === 'pending' && count < max; },
    markReady() { status = 'ready'; },
    markFailed() {
      count++;
      if (count >= max) status = 'failed';
    },
    markPermanentlyFailed() {
      count = max;
      status = 'failed';
    },
    isReady() { return status === 'ready'; },
    isFailed() { return status === 'failed'; },
    attempts() { return count; },
  };
}
