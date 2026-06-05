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
export function createInitState(opts = {}) {
    const max = opts.maxAttempts ?? 3;
    let status = 'pending';
    let count = 0;
    return {
        canTry() { return status === 'pending' && count < max; },
        markReady() { status = 'ready'; },
        markFailed() {
            count++;
            if (count >= max)
                status = 'failed';
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
//# sourceMappingURL=init-state.js.map