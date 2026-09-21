/** Small shared helpers for the report collectors. */

/** Budget for one non-navigation collector (AX tree, screenshot, eval). */
export const STEP_TIMEOUT_MS = 15_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => {
    const t = setTimeout(r, ms);
    t.unref?.();
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
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        timer.unref?.();
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
