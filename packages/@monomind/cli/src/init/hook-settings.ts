/**
 * Monomind-owned hooks in .claude/settings.json: find them, add the ones an
 * older install is missing, and fix timeouts written in milliseconds.
 *
 * A hook is monomind-owned when its command runs a script under
 * `.claude/helpers/` (hook-handler.cjs, handlers/capture-handler.cjs,
 * auto-memory-hook.mjs, standalone helpers). Every other hook is the user's
 * and is never touched.
 *
 * Claude Code reads a hook `timeout` in SECONDS. Installs before 2.17 wrote
 * milliseconds (4000, 10000, ...), which Claude Code reads as hours. No real
 * hook timeout is over 600 s, so a monomind-owned timeout above 600 is a
 * millisecond value.
 */

/** A single hook command entry inside a hook group's `hooks` array. */
export interface HookEntry {
  type?: string;
  command?: string;
  timeout?: number;
  [key: string]: unknown;
}

/** A hook group as it appears in settings.json's `hooks.<Event>` arrays. */
export interface HookGroup {
  matcher?: string;
  hooks?: HookEntry[];
  [key: string]: unknown;
}

export type HooksByEvent = Record<string, HookGroup[]>;

/** Largest timeout (seconds) treated as already in seconds. */
export const MAX_SECONDS_TIMEOUT = 600;

const HELPER_SCRIPT = /\.claude\/helpers\/((?:[\w.-]+\/)*[\w.-]+\.(?:cjs|mjs|js))/g;

/**
 * `<script> <subcommand>` for a monomind-owned hook command, or undefined for
 * a user hook. The same hook written by different versions (plain
 * `node .claude/helpers/x.cjs route`, the `sh -c` project-dir resolver, the
 * `node -e` git-root resolver) gets the same id.
 */
export function monomindHookId(command: unknown): string | undefined {
  if (typeof command !== 'string') return undefined;
  const scripts = [...command.matchAll(HELPER_SCRIPT)];
  if (scripts.length === 0) return undefined;
  const script = scripts[scripts.length - 1][1];
  const last = (command.trim().split(/\s+/).pop() ?? '').replace(/^["'(]+|["')]+$/g, '');
  const sub = /^[a-z][a-z0-9-]*$/.test(last) ? last : '';
  return sub ? `${script} ${sub}` : script;
}

/** A hook's id may also be satisfied under another event (older layouts). */
const EQUIVALENT_EVENTS: Record<string, string[]> = {
  // Older `init upgrade` put the auto-memory sync on SessionEnd; now it is Stop.
  'auto-memory-hook.mjs sync': ['Stop', 'SessionEnd'],
};

function idsIn(hooks: HooksByEvent, event: string): Set<string> {
  const ids = new Set<string>();
  for (const group of hooks[event] ?? []) {
    for (const entry of group?.hooks ?? []) {
      const id = monomindHookId(entry?.command);
      if (id) ids.add(id);
    }
  }
  return ids;
}

function present(hooks: HooksByEvent, event: string, id: string): boolean {
  return (EQUIVALENT_EVENTS[id] ?? [event]).some((e) => idsIn(hooks, e).has(id));
}

/** Monomind hooks in `reference` that `existing` lacks, as `Event: id`. */
export function missingMonomindHooks(existing: HooksByEvent, reference: HooksByEvent): string[] {
  const missing: string[] = [];
  for (const [event, groups] of Object.entries(reference)) {
    for (const group of groups) {
      for (const entry of group.hooks ?? []) {
        const id = monomindHookId(entry.command);
        if (id && !present(existing, event, id)) missing.push(`${event}: ${id}`);
      }
    }
  }
  return missing;
}

/** Monomind-owned hook entries whose timeout is in milliseconds. */
export function msTimeoutHooks(existing: HooksByEvent): string[] {
  const out: string[] = [];
  for (const [event, groups] of Object.entries(existing)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      for (const entry of group?.hooks ?? []) {
        const id = monomindHookId(entry?.command);
        if (id && typeof entry.timeout === 'number' && entry.timeout > MAX_SECONDS_TIMEOUT)
          out.push(`${event}: ${id} (${entry.timeout})`);
      }
    }
  }
  return out;
}

export interface HookMergeResult {
  hooks: HooksByEvent;
  /** `Event: id` of every hook added. */
  added: string[];
  /** How many monomind-owned timeouts were converted from ms to seconds. */
  timeoutsFixed: number;
}

/**
 * Add every monomind hook in `reference` that `existing` lacks and convert
 * monomind-owned millisecond timeouts to seconds. A missing hook joins the
 * existing group with the same matcher, else a new group is appended. User
 * hooks are left as they are; nothing is removed; running it twice changes
 * nothing the second time.
 */
export function mergeMonomindHooks(
  existing: HooksByEvent,
  reference: HooksByEvent,
): HookMergeResult {
  const hooks: HooksByEvent = JSON.parse(JSON.stringify(existing ?? {}));
  let timeoutsFixed = 0;
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      for (const entry of group?.hooks ?? []) {
        if (
          monomindHookId(entry?.command) &&
          typeof entry.timeout === 'number' &&
          entry.timeout > MAX_SECONDS_TIMEOUT
        ) {
          entry.timeout = Math.ceil(entry.timeout / 1000);
          timeoutsFixed++;
        }
      }
    }
  }

  const added: string[] = [];
  for (const [event, refGroups] of Object.entries(reference)) {
    for (const refGroup of refGroups) {
      const missing = (refGroup.hooks ?? []).filter((entry) => {
        const id = monomindHookId(entry.command);
        return id !== undefined && !present(hooks, event, id);
      });
      if (missing.length === 0) continue;
      if (!Array.isArray(hooks[event])) hooks[event] = [];
      const target = hooks[event].find((g) => (g?.matcher ?? '') === (refGroup.matcher ?? ''));
      const copies = missing.map((e) => ({ ...e }));
      if (target) target.hooks = [...(target.hooks ?? []), ...copies];
      else
        hooks[event].push(
          refGroup.matcher !== undefined
            ? { matcher: refGroup.matcher, hooks: copies }
            : { hooks: copies },
        );
      for (const e of missing) added.push(`${event}: ${monomindHookId(e.command)}`);
    }
  }
  return { hooks, added, timeoutsFixed };
}
