// packages/@monomind/cli/src/orgrt/documents/definition.ts
/**
 * Org sections spec sections 5, 7.3 and 9.1 (piece P3.1): the checks a
 * definition on the sections surface must pass. Runs only after
 * `sectionsSurface(def).enabled` (validate-checklist.ts asks); nothing here
 * runs for an org without `sections`. Pure: reads the definition, returns
 * findings. Every message names the path it is about and a remedy.
 */
import type { OrgDef } from '../types.js';
import { completionFindings } from './completion-accessor.js';
import { copyInventoryFindings } from './copy-inventory.js';
import { checkDocuments } from './definition-documents.js';
import type { Findings } from './definition-util.js';
import { isObject, NAME_RE, RESERVED_TYPES } from './definition-util.js';
import { writerDefinitionFindings } from './definition-writes.js';
import { leadRulesFindings } from './lead-rules.js';
import { loopFindings } from './loops.js';
import { sectionBudgetChecklist } from './section-budget-wire.js';

const SECTION_FIELDS = [
  'lead',
  'members',
  'mode',
  'consumes',
  'publishes',
  'requests',
  'writes',
  'budget',
  'max_rework_rounds',
  'parallelism',
];

const describe = (v: unknown): string =>
  v === null
    ? 'null'
    : Array.isArray(v)
      ? 'a list'
      : typeof v === 'object'
        ? 'an object'
        : `${JSON.stringify(v) ?? 'nothing'}`;

/** A list of strings at `path`, or undefined (after recording why it is not one). */
function strings(v: unknown, path: string, f: Findings, what: string): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || x === '')) {
    f.errors.push(`${path}: must be a list of ${what} — got ${describe(v)}`);
    return undefined;
  }
  return v as string[];
}

/** Requirements the surface places on the rest of the definition (13.1.3, 9.1, 9.2, 7.3). */
function checkSurfaceKeys(def: OrgDef, f: Findings): void {
  const raw = def as unknown as Record<string, unknown>;
  const rc = (def.run_config ?? {}) as Record<string, unknown>;
  const req = raw.requires;
  if (!isObject(req) || req.sections !== 1)
    f.errors.push(
      'requires: a sections org must declare requires: {"sections": 1} so a runtime without sections refuses it — add it',
    );
  else
    for (const k of Object.keys(req))
      if (k !== 'sections')
        f.errors.push(
          `requires.${k}: unknown capability "${k}" — this runtime supports only "sections"; remove it`,
        );
  if (rc.experimental !== 'eval')
    f.errors.push(
      `run_config.experimental: a sections org must set "eval" until the release build qualifies — got ${describe(rc.experimental)}`,
    );
  f.errors.push(...completionFindings(rc, describe));
  if (def.schedule !== null && def.schedule !== undefined)
    f.errors.push(
      'schedule: not yet supported: recurring section orgs need document carry-forward — remove schedule (a section org runs once, or is resumed by hand)',
    );
}

function checkRoles(def: OrgDef, f: Findings): void {
  for (const r of def.roles)
    if (r.policy?.access === 'full')
      f.errors.push(
        `roles.${r.id}.policy.access: "full" is refused in a sections org (a full-access role runs with no authority mask and could read protected documents) — set "scoped"`,
      );
}

/** The structural checks of every section; returns what each publishes and consumes. */
function checkSections(
  def: OrgDef,
  sections: Record<string, unknown>,
  docTypes: string[],
  f: Findings,
): void {
  const rc = (def.run_config ?? {}) as Record<string, unknown>;
  const roleIds = def.roles.map((r) => r.id);
  const byId = new Map(def.roles.map((r) => [r.id, r]));
  const root =
    def.roles.find((r) => r.type === 'boss') ?? def.roles.find((r) => r.reports_to == null);
  const home = new Map<string, string>();
  const publishers = new Map<string, string[]>();
  const consumers = new Map<string, string[]>();
  const writers: string[] = [];
  const known = `roles are: ${roleIds.join(', ')}`;

  for (const [name, sec] of Object.entries(sections)) {
    const at = `sections.${name}`;
    if (!NAME_RE.test(name))
      f.errors.push(
        `${at}: "${name}" is not a valid section name — use lowercase letters, digits and "-", starting with a letter, at most 40 characters (it becomes a path segment)`,
      );
    if (!isObject(sec)) {
      f.errors.push(
        `${at}: must be an object with "members" (and usually "lead") — got ${describe(sec)}`,
      );
      continue;
    }
    for (const k of Object.keys(sec))
      if (!SECTION_FIELDS.includes(k))
        f.errors.push(
          `${at}.${k}: unknown section field — known fields: ${SECTION_FIELDS.join(', ')}`,
        );

    // Roster.
    const members = strings(sec.members, `${at}.members`, f, 'role ids') ?? [];
    if (sec.members === undefined || (Array.isArray(sec.members) && members.length === 0))
      f.errors.push(`${at}.members: a section needs at least one member role — list its role ids`);
    const lead = typeof sec.lead === 'string' ? sec.lead : undefined;
    if (sec.lead !== undefined && lead === undefined)
      f.errors.push(`${at}.lead: must be a role id — got ${describe(sec.lead)}`);
    if (lead === undefined && sec.lead === undefined && members.length > 1)
      f.errors.push(
        `${at}.lead: a section with ${members.length} members must name its lead (only a one-member section leads itself) — add "lead": one of ${members.join(', ')}, or a dedicated lead role`,
      );
    const seen = new Set<string>();
    for (const id of members) {
      if (seen.has(id))
        f.errors.push(`${at}.members: role "${id}" is listed twice — remove the duplicate`);
      seen.add(id);
    }
    const roster = new Set(members);
    if (lead) roster.add(lead);
    for (const id of roster) {
      if (!byId.has(id)) f.errors.push(`${at}: role "${id}" does not exist — ${known}`);
      else if (root && id === root.id)
        f.errors.push(
          `${at}: role "${id}" is the root (it reports to no one); the root is in no section and reads every document — remove it from the section`,
        );
      const other = home.get(id);
      if (other !== undefined && other !== name)
        f.errors.push(
          `role "${id}" is in sections "${other}" and "${name}" — a role belongs to at most one section; remove it from one`,
        );
      else home.set(id, name);
    }
    // A dedicated lead must resolve to role scope (7.3 item 8, A39).
    const leadRole = lead ? byId.get(lead) : undefined;
    if (leadRole && !members.includes(lead as string)) {
      const scope = leadRole.session_scope ?? (rc.session_scope as string | undefined) ?? 'role';
      if (scope === 'task')
        f.errors.push(
          `${at}.lead: dedicated lead "${lead}" resolves to session scope "task" — a lead spans tasks; set session_scope: "role" on role "${lead}"`,
        );
    }

    // Edges.
    const edges: Record<'consumes' | 'publishes', string[]> = { consumes: [], publishes: [] };
    for (const key of ['consumes', 'publishes'] as const) {
      const list = strings(sec[key], `${at}.${key}`, f, 'document types') ?? [];
      edges[key] = list;
      const dup = new Set<string>();
      for (const t of list) {
        if (dup.has(t))
          f.errors.push(`${at}.${key}: type "${t}" is listed twice — declare each edge once`);
        dup.add(t);
        if (RESERVED_TYPES.includes(t))
          f.errors.push(
            `${at}.${key}: "${t}" is a reserved built-in type with its own routing — it cannot appear in consumes or publishes`,
          );
        else if (!NAME_RE.test(t))
          f.errors.push(
            `${at}.${key}: "${t}" is not a valid type name — lowercase letters, digits and "-"`,
          );
        else if (!docTypes.includes(t))
          f.errors.push(
            `${at}.${key}: type "${t}" is not declared — add documents.${t} with its schema (declared: ${docTypes.join(', ') || 'none'})`,
          );
        const map = key === 'publishes' ? publishers : consumers;
        map.set(t, [...(map.get(t) ?? []), name]);
      }
    }
    for (const t of edges.consumes)
      if (edges.publishes.includes(t))
        f.errors.push(
          `${at}: type "${t}" is both consumed and published by this section — a section cannot hand a document to itself; remove one`,
        );

    // Fields with fixed MVP values.
    if (sec.mode !== undefined && sec.mode !== 'execution')
      f.errors.push(
        sec.mode === 'deliberative'
          ? `${at}.mode: "deliberative" is not yet supported — use "execution" and a separate deliberative role`
          : `${at}.mode: must be "execution" — got ${describe(sec.mode)}`,
      );
    if (sec.requests !== undefined && sec.requests !== 'via-lead')
      f.errors.push(
        sec.requests === 'direct'
          ? `${at}.requests: "direct" is not yet supported — use "via-lead" or remove it`
          : `${at}.requests: must be "via-lead" — got ${describe(sec.requests)}`,
      );
    if (
      sec.max_rework_rounds !== undefined &&
      !(Number.isInteger(sec.max_rework_rounds) && (sec.max_rework_rounds as number) > 0)
    )
      f.errors.push(
        `${at}.max_rework_rounds: must be a positive integer — got ${describe(sec.max_rework_rounds)}`,
      );
    if (sec.parallelism !== undefined) {
      const p = sec.parallelism;
      if (!isObject(p))
        f.errors.push(
          `${at}.parallelism: must be an object like {"max_parallel": 2} — got ${describe(p)}`,
        );
      else {
        for (const k of Object.keys(p))
          if (k === 'max_depth')
            f.errors.push(
              `${at}.parallelism.max_depth: not yet supported — remove it (max_parallel is planning guidance only)`,
            );
          else if (k !== 'max_parallel')
            f.errors.push(`${at}.parallelism.${k}: unknown field — only max_parallel is known`);
        if (
          p.max_parallel !== undefined &&
          !(Number.isInteger(p.max_parallel) && (p.max_parallel as number) > 0)
        )
          f.errors.push(
            `${at}.parallelism.max_parallel: must be a positive integer — got ${describe(p.max_parallel)}`,
          );
      }
    }
    const writes = strings(sec.writes, `${at}.writes`, f, 'repository paths') ?? [];
    if (writes.length > 0) writers.push(name);
  }
  if (writers.length > 1)
    f.errors.push(
      `sections.${writers.join(', sections.')}: only one section may declare writes in this build (a single writer per repository, merge_owner is not yet supported) — keep writes on one section and hand the rest off as documents`,
    );

  // Producers and consumers of every declared type.
  for (const t of docTypes) {
    const p = publishers.get(t) ?? [];
    if (p.length === 0)
      f.errors.push(
        `documents.${t}: no section publishes it — add "${t}" to a section's publishes, or remove the type`,
      );
    else if (p.length > 1)
      f.errors.push(
        `documents.${t}: published by ${p.join(' and ')} — a type has one producing section; give each its own type`,
      );
    if (!consumers.has(t))
      f.warnings.push(
        `documents.${t}: no section consumes it — nothing will read it (add it to a consumes list, or remove the type)`,
      );
  }
}

/** All findings for a definition on the sections surface. Call only when it is. */
export function sectionsDefinitionFindings(def: OrgDef): Findings {
  const f: Findings = { errors: [], warnings: [] };
  const raw = def as unknown as Record<string, unknown>;
  checkSurfaceKeys(def, f);
  const docTypes = checkDocuments(raw.documents, f);
  const sections = raw.sections as Record<string, unknown>;
  checkSections(def, sections, docTypes, f);
  checkRoles(def, f);
  leadRulesFindings(def, f);
  const budget = sectionBudgetChecklist(def); // P4.5: shape, partition and org budget
  f.errors.push(...budget.errors);
  f.warnings.push(...budget.warnings);
  writerDefinitionFindings(def, f);
  const inventory = copyInventoryFindings(def); // GA row R5: every runner's native copies are inventoried
  f.errors.push(...inventory.errors);
  f.warnings.push(...inventory.warnings);
  const loops = loopFindings(raw, ['CYCLE_SELF_EDGE']); // P4.8: a self-edge is already an error above
  f.errors.push(...loops.errors);
  f.warnings.push(...loops.warnings);
  return f;
}
