// packages/@monomind/cli/src/orgrt/documents/completion-accessor.ts
/**
 * Org sections spec 9.1 / 13.1 P3.2: the ONE reader of `run_config.completion`.
 * The field is either a legacy string ('boss' | 'dag', unchanged) or, for a
 * sections org, the object `{mode, protocol?}` (the protocol is optional and
 * ignored; older definitions carry 'sections-v1'). Every runtime reader goes
 * through here (a source-scan test enforces it), so no caller can flatten the
 * object into a string or read `.mode` off a string.
 */

export type CompletionMode = 'boss' | 'dag';

export interface CompletionPolicy {
  /** The completion mode; 'boss' when unset or not a recognised value. */
  mode: CompletionMode;
  /** The discriminator an object carries; null for a legacy string or when unset. */
  protocol: string | null;
}

type RunConfigLike = { completion?: unknown } | null | undefined;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const asMode = (v: unknown): CompletionMode => (v === 'dag' ? 'dag' : 'boss');

/** Pure: reads `runConfig.completion` only. */
export function completionPolicy(runConfig: RunConfigLike): CompletionPolicy {
  const c = runConfig?.completion;
  if (isObject(c))
    return { mode: asMode(c.mode), protocol: typeof c.protocol === 'string' ? c.protocol : null };
  return { mode: asMode(c), protocol: null };
}

export const completionMode = (runConfig: RunConfigLike): CompletionMode =>
  completionPolicy(runConfig).mode;

export const completionProtocol = (runConfig: RunConfigLike): string | null =>
  completionPolicy(runConfig).protocol;

/** True when `completion` is the object form, whatever is inside it. */
export const completionIsObject = (runConfig: RunConfigLike): boolean =>
  isObject(runConfig?.completion);

/** What the dashboard shows: a legacy value is echoed verbatim (unset is
 *  'boss'), an object shows its `mode`, never the object itself. */
export function completionDisplay(runConfig: RunConfigLike): unknown {
  const c = runConfig?.completion;
  return isObject(c) ? (c.mode ?? 'boss') : (c ?? 'boss');
}

/** The dashboard Config tab sends `completion` as a string or null. Map it
 *  onto the saved value: an object keeps its protocol and takes the new mode,
 *  null is refused (it would delete the discriminator); a legacy value is
 *  applied as before (`null` clears it). */
export function patchCompletion(
  runConfig: RunConfigLike,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; problem: string } {
  const c = runConfig?.completion;
  if (!isObject(c)) return { ok: true, value };
  if (value === null)
    return {
      ok: false,
      problem:
        'run_config.completion: a sections org cannot clear completion (it carries the "sections-v1" protocol) — choose "boss" or "dag"',
    };
  return { ok: true, value: { ...c, mode: value } };
}
