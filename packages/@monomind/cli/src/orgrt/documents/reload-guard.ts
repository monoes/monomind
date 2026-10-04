// packages/@monomind/cli/src/orgrt/documents/reload-guard.ts
/**
 * Org sections spec 6.14 and 13.2 (piece P4.10): the reload guard of the sections surface. A hot reload carries a
 * small set of keys into a running org (budgets, caps, loop rounds, role policy). Every other key of the sections
 * surface is read once, at start (the section map, the document contracts, the single-writer overlay, the
 * completion policy, the loops), so a reload that changed one would be applied by nothing, or by half of the
 * runtime. `structuralReloadChanges` names those changes; the reload refuses the whole file when it finds any.
 *
 * Pure: reads the two definitions, mutates nothing, returns typed changes (code, path, message, remedy). Nothing
 * is reported for an org that is not on the sections surface in either definition, so a sections-off reload is
 * what it was before.
 *
 * ALLOWED (not reported): `sections.<s>.budget`, `sections.<s>.max_rework_rounds`, `loops[i].max_rounds` when the
 * entry's `between` and `types` are unchanged, `run_config` keys other than `completion` and `experimental`
 * (`budget_usd`, deadlines, ...), a role's caps, policy and tool fields, a new role that belongs to no section.
 * STRUCTURAL (reported): section added, removed or renamed; a section's `members`, `lead`, `writes`, `consumes`,
 * `publishes`, `requests`, `mode`, `parallelism` (any field but the two allowed); `documents`; `requires`;
 * `run_config.completion`; `run_config.experimental`; `loops` added or removed and `between`/`types` of a loop;
 * the root role; turning the sections surface on or off.
 */
import { canonicalJson } from './canonical.js';
import { completionPolicy } from './completion-accessor.js';
import { sectionsSurface } from './surface.js';

export type ReloadChangeCode =
  | 'sections-enabled'
  | 'sections-disabled'
  | 'section-added'
  | 'section-removed'
  | 'section-members'
  | 'section-lead'
  | 'section-writes'
  | 'section-flow'
  | 'section-other'
  | 'documents'
  | 'requires'
  | 'completion'
  | 'experimental'
  | 'loops-added'
  | 'loops-removed'
  | 'loops-structure'
  | 'root';

export interface ReloadChange {
  code: ReloadChangeCode;
  /** The key path, as the definition spells it (`sections.dev.writes`, `loops[0].between`). */
  path: string;
  message: string;
  /** What the author does about it. */
  remedy: string;
}

/** The part of a definition the guard reads; an `OrgDef` fits it. */
export interface ReloadGuardDef {
  sections?: unknown;
  documents?: unknown;
  requires?: unknown;
  loops?: unknown;
  roles?: unknown;
  run_config?: unknown;
}

export const RELOAD_REMEDY =
  'stop and start the org to apply it (a running org does not reload this key), or revert it in the definition to keep reloading';

/** The section fields a reload carries live (P4.5, P4.7); every other field is structural. */
const LIVE_SECTION_FIELDS = new Set(['budget', 'max_rework_rounds']);
const FIELD_CODE: Record<string, ReloadChangeCode> = {
  members: 'section-members',
  lead: 'section-lead',
  writes: 'section-writes',
  consumes: 'section-flow',
  publishes: 'section-flow',
  requests: 'section-flow',
};

/** The `run_config` keys of the sections surface that are read once, at start; the completion policy is read
 *  through its accessor, so a legacy "boss" and an unset value are not a change. */
const GUARDED_RUN_CONFIG: Array<{
  code: 'completion' | 'experimental';
  read: (rc: Record<string, unknown>) => unknown;
}> = [
  { code: 'completion', read: (rc) => completionPolicy(rc) },
  { code: 'experimental', read: (rc) => rc.experimental },
];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

function canon(v: unknown): string {
  try {
    return canonicalJson(v);
  } catch {
    return JSON.stringify(v) ?? 'undefined';
  }
}

/** Equal as JSON; a list of strings is equal to the same strings in another order. */
function same(a: unknown, b: unknown): boolean {
  if (isStrings(a) && isStrings(b)) return canon([...a].sort()) === canon([...b].sort());
  return canon(a) === canon(b);
}

const show = (v: unknown): string => (v === undefined ? 'nothing' : canon(v));

/** What moved in a list of names: "added a, b; removed c". */
function listDelta(a: unknown, b: unknown): string {
  if (!isStrings(a) || !isStrings(b)) return `from ${show(a)} to ${show(b)}`;
  const added = b.filter((x) => !a.includes(x));
  const removed = a.filter((x) => !b.includes(x));
  return (
    [
      added.length ? `added ${added.join(', ')}` : '',
      removed.length ? `removed ${removed.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ') || `from ${show(a)} to ${show(b)}`
  );
}

function rootOf(def: ReloadGuardDef): string | undefined {
  if (!Array.isArray(def.roles)) return undefined;
  const roles = def.roles.filter(isObject);
  const r = roles.find((x) => x.type === 'boss') ?? roles.find((x) => x.reports_to == null);
  return typeof r?.id === 'string' ? r.id : undefined;
}

function sectionChanges(
  live: Record<string, unknown>,
  next: Record<string, unknown>,
  out: ReloadChange[],
): void {
  for (const name of Object.keys(next))
    if (!(name in live))
      out.push({
        code: 'section-added',
        path: `sections.${name}`,
        message: `section "${name}" is new: the section map, its members and its leads are read at start`,
        remedy: RELOAD_REMEDY,
      });
  for (const name of Object.keys(live))
    if (!(name in next))
      out.push({
        code: 'section-removed',
        path: `sections.${name}`,
        message: `section "${name}" was removed: the section map is read at start`,
        remedy: RELOAD_REMEDY,
      });
  for (const [name, was] of Object.entries(live)) {
    const now = next[name];
    if (!isObject(was) || !isObject(now)) {
      if (name in next && !same(was, now))
        out.push({
          code: 'section-other',
          path: `sections.${name}`,
          message: `section "${name}" changed shape`,
          remedy: RELOAD_REMEDY,
        });
      continue;
    }
    for (const field of new Set([...Object.keys(was), ...Object.keys(now)])) {
      if (LIVE_SECTION_FIELDS.has(field) || same(was[field], now[field])) continue;
      const code = FIELD_CODE[field] ?? 'section-other';
      const detail =
        code === 'section-members'
          ? `its members changed (${listDelta(was[field], now[field])}): membership is read at start, so a role added to or removed from a section would still resolve against the old section map`
          : code === 'section-lead'
            ? `its lead changed (from ${show(was[field])} to ${show(now[field])}): leads are read at start`
            : code === 'section-writes'
              ? `its writes changed (from ${show(was[field])} to ${show(now[field])}): the single-writer assignment is applied to each role's policy and sandbox when the role starts`
              : `${field} changed (from ${show(was[field])} to ${show(now[field])}): it is read at start`;
      out.push({
        code,
        path: `sections.${name}.${field}`,
        message: `section "${name}": ${detail}`,
        remedy: RELOAD_REMEDY,
      });
    }
  }
}

function documentChanges(live: unknown, next: unknown, out: ReloadChange[]): void {
  if (same(live, next)) return;
  if (!isObject(live) || !isObject(next)) {
    out.push({
      code: 'documents',
      path: 'documents',
      message:
        'the document contracts changed: contracts, types and edges are fixed when the org starts',
      remedy: RELOAD_REMEDY,
    });
    return;
  }
  for (const type of new Set([...Object.keys(live), ...Object.keys(next)]))
    if (!same(live[type], next[type]))
      out.push({
        code: 'documents',
        path: `documents.${type}`,
        message: `document type "${type}" ${!(type in live) ? 'was added' : !(type in next) ? 'was removed' : 'changed'}: contracts, types and edges are fixed when the org starts`,
        remedy: RELOAD_REMEDY,
      });
}

function loopChanges(live: unknown, next: unknown, out: ReloadChange[]): void {
  const a = Array.isArray(live) ? live : [];
  const b = Array.isArray(next) ? next : [];
  if (!Array.isArray(live) && !Array.isArray(next) && same(live, next)) return;
  for (let i = b.length; i < a.length; i++)
    out.push({
      code: 'loops-removed',
      path: `loops[${i}]`,
      message: `loop ${i} was removed: the declared loops are read at start`,
      remedy: RELOAD_REMEDY,
    });
  for (let i = a.length; i < b.length; i++)
    out.push({
      code: 'loops-added',
      path: `loops[${i}]`,
      message: `loop ${i} is new: the declared loops are read at start`,
      remedy: RELOAD_REMEDY,
    });
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const was = isObject(a[i]) ? a[i] : {};
    const now = isObject(b[i]) ? b[i] : {};
    for (const field of new Set([...Object.keys(was), ...Object.keys(now)])) {
      if (field === 'max_rounds' || same(was[field], now[field])) continue;
      out.push({
        code: 'loops-structure',
        path: `loops[${i}].${field}`,
        message: `loop ${i}: ${field} changed (from ${show(was[field])} to ${show(now[field])}): only max_rounds reloads, and only while between and types are unchanged`,
        remedy: RELOAD_REMEDY,
      });
    }
  }
}

/** The changes in `next` against the running `live` definition that a hot reload cannot apply; empty when the
 *  reload is allowed, and always empty when neither definition is on the sections surface. */
export function structuralReloadChanges(
  live: ReloadGuardDef,
  next: ReloadGuardDef,
): ReloadChange[] {
  const wasOn = sectionsSurface(live).enabled;
  const nowOn = sectionsSurface(next).enabled;
  if (!wasOn && !nowOn) return [];
  const out: ReloadChange[] = [];
  if (!wasOn)
    out.push({
      code: 'sections-enabled',
      path: 'sections',
      message:
        'the running org is not a sections org: the document runtime is installed when the org starts',
      remedy: RELOAD_REMEDY,
    });
  else if (!nowOn)
    out.push({
      code: 'sections-disabled',
      path: 'sections',
      message:
        'the definition no longer declares any section: the running org keeps its document runtime',
      remedy: RELOAD_REMEDY,
    });
  else
    sectionChanges(
      live.sections as Record<string, unknown>,
      next.sections as Record<string, unknown>,
      out,
    );
  documentChanges(live.documents, next.documents, out);
  if (!same(live.requires, next.requires))
    out.push({
      code: 'requires',
      path: 'requires',
      message: 'the capability contract changed: it is checked when the org starts',
      remedy: RELOAD_REMEDY,
    });
  const lrc = isObject(live.run_config) ? live.run_config : {};
  const nrc = isObject(next.run_config) ? next.run_config : {};
  for (const { code, read } of GUARDED_RUN_CONFIG) {
    const [was, now] = [read(lrc), read(nrc)];
    if (!same(was, now))
      out.push({
        code,
        path: `run_config.${code}`,
        message: `run_config.${code} changed (from ${show(was)} to ${show(now)}): it is read when the org starts`,
        remedy: RELOAD_REMEDY,
      });
  }
  loopChanges(live.loops, next.loops, out);
  if (rootOf(live) !== rootOf(next))
    out.push({
      code: 'root',
      path: 'roles',
      message: `the root role changed (from ${rootOf(live) ?? 'nothing'} to ${rootOf(next) ?? 'nothing'}): escalations and the section map are anchored on it at start`,
      remedy: RELOAD_REMEDY,
    });
  return out;
}

/** The refusal text of a reload: every change, its path and the remedy once. */
export function reloadRefusalText(name: string, changes: readonly ReloadChange[]): string {
  const lines = changes.map((c) => `${c.path}: ${c.message}`).join('; ');
  return `org ${name}: reload refused, the running org keeps its definition and nothing was applied: ${lines} — ${RELOAD_REMEDY}`;
}
