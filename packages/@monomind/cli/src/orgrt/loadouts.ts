/**
 * ADR-O001 D7 — specialisation via a small catalog of stable loadouts.
 *
 * `buildRolePrompt` runs once per session, so a role's system prompt is a
 * stable cache prefix: one cache write, then 0.1x forever. Specialisation is
 * therefore cheap and VARIETY is expensive — every distinct system prompt is
 * its own cache namespace. A loadout is a named, stable bundle of role-prompt
 * text + skills; the boss selects one by name when it creates a task and never
 * composes prompt text. Everything per-task (which diff, which criteria, what
 * failed last time) goes in the task MESSAGE instead.
 *
 * Catalog size: more than MAX_LOADOUTS is an error at `org validate` and at
 * daemon start. Fewer than TARGET_MIN_LOADOUTS is ALLOWED with a warning — a
 * small org with two kinds of work is not wrong, it just is not the shape the
 * ADR tuned for. An empty `loadouts: {}` is an error (omit the field instead),
 * because it would still switch on the tool argument with nothing to select.
 *
 * Today each role holds ONE long SDK session for its life (see session.ts), so
 * a loadout can only take effect when a role's session is BUILT: the daemon
 * picks it from the role's first ready task (`sessionLoadoutFor`), freezes it
 * on the incarnation (`AgentRuntime.loadout`) and in the checkpoint, and never
 * rewrites it. A later task that asked for a different loadout is delivered to
 * the live session anyway and recorded as a `loadout-mismatch` event — honest,
 * not silently applied. When D3 makes sessions task-keyed, the session for
 * (role, taskKey) is built with `resolveLoadout(def, task.loadout, root)` via
 * the same `SessionOpts.loadout` field, and the mismatch path disappears.
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { getSkill } from './skill-library.js';
import type { OrgTask, TaskDag } from './task-dag.js';
import type { OrgDef } from './types.js';

export const MAX_LOADOUTS = 15;
export const TARGET_MIN_LOADOUTS = 5;
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/i;

/** What the boss sees to select by (org_task's description). */
export interface LoadoutSummary {
  name: string;
  description?: string;
}

/** A loadout ready to go into a session's system prompt. Plain data, resolved
 *  once when the session is built, so nothing can change it mid-session. */
export interface ResolvedLoadout {
  name: string;
  guidance: string;
}

type LoadoutEntry = NonNullable<OrgDef['loadouts']>[string];

function filePath(file: string, root: string): string {
  return isAbsolute(file) ? file : join(root, file);
}

/** Errors fail `org validate` and `org run`; warnings are printed only. */
export function validateLoadouts(
  def: Pick<OrgDef, 'loadouts'>,
  root: string,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const cat = def.loadouts;
  if (!cat) return { errors, warnings };
  const names = Object.keys(cat);
  if (names.length === 0) {
    errors.push('loadouts: the catalog is empty — omit the field instead');
    return { errors, warnings };
  }
  if (names.length > MAX_LOADOUTS) {
    errors.push(
      `loadouts: ${names.length} loadouts declared, at most ${MAX_LOADOUTS} allowed — each distinct system prompt is its own cache namespace (ADR-O001 D7); merge similar kinds of work`,
    );
  } else if (names.length < TARGET_MIN_LOADOUTS) {
    warnings.push(
      `loadouts: ${names.length} loadouts declared, below the ${TARGET_MIN_LOADOUTS}–${MAX_LOADOUTS} target (allowed)`,
    );
  }
  for (const name of names) {
    const l = cat[name] as LoadoutEntry;
    if (!NAME_RE.test(name)) {
      errors.push(`loadout "${name}": name must be letters, digits, "-" or "_" (max 48)`);
    }
    if (!l.prompt?.trim() && !l.skills?.length && !l.instructions_file) {
      errors.push(`loadout "${name}": has no prompt, skills or instructions_file`);
    }
    for (const s of l.skills ?? []) {
      // Name check first: a skill is a file lookup, so "../x" must never reach it.
      if (!getSkill(s, root)) {
        errors.push(`loadout "${name}": unknown skill "${s}"`);
      }
    }
    if (l.instructions_file && !existsSync(filePath(l.instructions_file, root))) {
      errors.push(`loadout "${name}": instructions_file not found: ${l.instructions_file}`);
    }
  }
  return { errors, warnings };
}

/** The catalog as the boss's tools present it, or undefined when the org has
 *  none — the signal that keeps every tool byte-identical for such orgs. */
export function loadoutCatalog(
  def: Pick<OrgDef, 'loadouts'> | undefined,
): LoadoutSummary[] | undefined {
  const cat = def?.loadouts;
  if (!cat || Object.keys(cat).length === 0) return undefined;
  return Object.entries(cat).map(([name, l]) =>
    l.description ? { name, description: l.description } : { name },
  );
}

/** Build the system-prompt text for a loadout: header, prompt, skills in the
 *  declared order, then the instructions file. Deterministic for a given
 *  config, which is what makes two sessions of the same kind byte-identical. */
export function resolveLoadout(
  def: Pick<OrgDef, 'loadouts'>,
  name: string,
  root: string,
): ResolvedLoadout {
  // hasOwn, not a bare lookup: "constructor" must not resolve via the prototype.
  const l = def.loadouts && Object.hasOwn(def.loadouts, name) ? def.loadouts[name] : undefined;
  if (!l) throw new Error(`unknown loadout "${name}"`);
  const parts = [`## Loadout: ${name}`];
  if (l.prompt?.trim()) parts.push(l.prompt.trim());
  for (const s of l.skills ?? []) {
    const text = getSkill(s, root)?.body;
    if (text) parts.push(text);
  }
  if (l.instructions_file) {
    const text = readFileSync(filePath(l.instructions_file, root), 'utf-8').trim();
    if (text) parts.push(text);
  }
  return { name, guidance: parts.join('\n\n') };
}

/** Why a selection is refused, or null when it is fine (or absent). */
export function checkLoadoutSelection(
  def: Pick<OrgDef, 'loadouts'>,
  loadout: string | undefined,
): string | null {
  if (loadout === undefined) return null;
  if (!def.loadouts) return `this org has no loadout catalog — omit "loadout"`;
  if (!Object.hasOwn(def.loadouts, loadout)) {
    return `unknown loadout "${loadout}" — one of: ${Object.keys(def.loadouts).join(', ')}`;
  }
  return null;
}

/** The loadout a NEW session for `roleId` is built with: that of the role's
 *  first ready task in DAG order. Deterministic, and it is exactly the task
 *  the lazy spawn is happening for when dispatch spawns the role. */
export function sessionLoadoutFor(dag: TaskDag | undefined, roleId: string): string | undefined {
  return dag?.ready().find((t) => t.assignee === roleId)?.loadout;
}

/** The task reference that opens every dispatch/re-dispatch message. The
 *  loadout rides in the MESSAGE (layer 2), never the prompt, and only when one
 *  was selected — so an org without a catalog sends exactly what it did. */
export function taskTag(task: Pick<OrgTask, 'id' | 'loadout'>): string {
  return task.loadout ? `[task:${task.id}] [loadout:${task.loadout}]` : `[task:${task.id}]`;
}
