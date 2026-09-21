/** Small shared helpers for the report collectors. */

/** Budget for one non-navigation collector (AX tree, screenshot, eval). */
export const STEP_TIMEOUT_MS = 15_000;

/** Not unref'd: callers `await sleep(...)` (e.g. the web-vitals settle
 *  window), so this timer is on an actively-awaited path. An unref'd timer
 *  does not keep the event loop alive, so once the CDP socket closes Node
 *  would drain and exit mid-report instead of resuming after the sleep. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => {
    setTimeout(r, ms);
  });
}

export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Races a promise against a timer. Used everywhere in collect.ts so a wedged
 * page degrades into a note instead of hanging the command forever.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      // Not unref'd: this timer is the only thing that settles the race when
      // `promise` is waiting on a socket that quietly went away, and every
      // caller awaits the result. The finally below clears it, so work that
      // finishes in time never holds the event loop open.
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * HTML-escape a value for interpolation into the report. Lives here rather
 * than in render.ts so the renderer and its section modules can share it
 * without importing each other.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
