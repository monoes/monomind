// packages/@monomind/cli/src/orgrt/documents/guidance-phase4.ts
//
// Role text for the Phase 4 keys (org sections plan P4.11): a few compact lines appended to the P3.12 block of
// documents/guidance.ts, only for a role of an org that sets a Phase 4 key. A pure function of the definition and
// the role: the single writer (`writes`), the section budgets (`budget`, `run_config.budget_usd`), the rework cap
// (`max_rework_rounds`) and the declared `loops`. An org that sets none of them gets an empty list, so its prompt
// stays byte for byte what P3.12 pinned. Every value comes from the definition; nothing here names a fixture.
import type { OrgDef } from '../types.js';
import { isObject } from './definition-util.js';
import { sectionLead } from './lead-rules.js';
import { capsFromDef } from './loop-rounds.js';
import { declaredLoops } from './loops.js';
import { rootRoleId, sectionOf } from './routing.js';
import { isPositiveUsd } from './section-budget.js';
import { usd } from './section-budget-text.js';
import { standingOf, type WriterDef, writingSections } from './writer-overlay.js';

const MAX_LISTED = 4;

/** What guidance.ts already worked out for the role: the types it publishes and decides, and who consumes a type. */
export interface Phase4Context {
  produces: readonly string[];
  decides: readonly string[];
  consumerSections: (type: string) => readonly string[];
}

const more = (n: number): string => (n > MAX_LISTED ? ` and ${n - MAX_LISTED} more` : '');
const shown = (xs: readonly string[]): string =>
  xs.slice(0, MAX_LISTED).join(', ') + more(xs.length);

const sectionRaw = (def: OrgDef, name: string): Record<string, unknown> => {
  const s = isObject(def.sections) ? def.sections[name] : undefined;
  return isObject(s) ? s : {};
};

/** The USD allocation of each section that has one, in declaration order. */
function allocations(def: OrgDef): [string, number][] {
  const out: [string, number][] = [];
  for (const name of Object.keys(isObject(def.sections) ? def.sections : {})) {
    const b = sectionRaw(def, name).budget;
    if (isObject(b) && isPositiveUsd(b.usd)) out.push([name, b.usd]);
  }
  return out;
}

const orgBudget = (def: OrgDef): number | undefined => {
  const v = (def.run_config as Record<string, unknown> | undefined)?.budget_usd;
  return isPositiveUsd(v) ? v : undefined;
};

/** True when the definition sets at least one Phase 4 key to a usable value. */
export function usesPhase4Keys(def: OrgDef): boolean {
  return (
    writingSections(def as unknown as WriterDef).length > 0 ||
    allocations(def).length > 0 ||
    orgBudget(def) !== undefined ||
    Object.keys(capsFromDef(def)).length > 0 ||
    declaredLoops(def).length > 0
  );
}

function writerLines(def: OrgDef, roleId: string): string[] {
  const writing = writingSections(def as unknown as WriterDef);
  if (writing.length !== 1) return [];
  const { standing } = standingOf(def as unknown as WriterDef, roleId);
  if (standing === 'endpoint') return [];
  const globs = shown(writing[0].writes);
  if (standing.startsWith('writing-'))
    return [
      `Your section "${writing[0].name}" owns writes to the workspace (${globs}): it is the only section that changes files there, and only inside those paths.`,
    ];
  const route =
    standing === 'root'
      ? 'ask a role of that section to apply it'
      : 'hand it to your lead or the root; the writer applies it';
  return [
    `You cannot change files in the workspace: section "${writing[0].name}" is its only writer (${globs}). Hand a change over as a document (org_doc_publish) or ${route}. A refused write is a rule, not an error: do not retry it or work around it.`,
  ];
}

function budgetLines(
  def: OrgDef,
  roleId: string,
  section: string | undefined,
  isRoot: boolean,
): string[] {
  const alloc = allocations(def);
  const out: string[] = [];
  const mine = alloc.find(([name]) => name === section);
  if (mine && sectionLead(def, mine[0]) === roleId)
    out.push(
      `Your section "${mine[0]}" has a USD allocation of ${usd(mine[1])}. You and the root are told at 80 percent; at 100 percent the section closes (no new work, no new task assigned into it, open tasks held) until the allocation is raised and the org reloaded.`,
    );
  else if (mine)
    out.push(
      'Your section has a USD budget; a closed section pauses (no new work or tasks) until its allocation is raised and the org reloaded.',
    );
  if (isRoot && alloc.length)
    out.push(
      `Section allocations: ${alloc
        .slice(0, MAX_LISTED)
        .map(([n, v]) => `${n} ${usd(v)}`)
        .join(
          ', ',
        )}${more(alloc.length)}. You and the section lead are told at 80 percent; a closed section takes no new work until you raise its allocation and reload.`,
    );
  const total = orgBudget(def);
  if (total !== undefined)
    out.push(
      `The org has a USD budget of ${usd(total)}; when spent, every role pauses until it is raised and the org reloaded.`,
    );
  return out;
}

function reworkLines(
  def: OrgDef,
  _roleId: string,
  section: string | undefined,
  isRoot: boolean,
  ctx: Phase4Context,
): string[] {
  const caps = capsFromDef(def);
  const out: string[] = [];
  const deciderCap = ctx.decides.length && section ? caps[section] : undefined;
  if (deciderCap !== undefined)
    out.push(
      `Rework cap: your section rejects at most ${deciderCap} versions of a document; the rejection that reaches it freezes the thread (the producer waits, the root decides): do not decide it again.`,
    );
  const capped = new Map<string, number>();
  for (const t of ctx.produces)
    for (const s of ctx.consumerSections(t)) if (caps[s] !== undefined) capped.set(s, caps[s]);
  if (capped.size)
    out.push(
      `Rework cap: ${[...capped]
        .slice(0, MAX_LISTED)
        .map(([s, n]) => `section "${s}" rejects at most ${n} versions of a document`)
        .join(
          '; ',
        )}${more(capped.size)}; at the cap the thread is frozen and a revision is refused (REWORK_EXHAUSTED): stop, tell your lead, wait for the root.`,
    );
  const mySection = section;
  const loops = declaredLoops(def).filter(
    (l) =>
      mySection &&
      l.between.includes(mySection) &&
      [...ctx.produces, ...ctx.decides].some((t) => l.types.includes(t)),
  );
  for (const l of loops.slice(0, 2))
    out.push(
      `Loop with section ${shown(l.between.filter((s) => s !== mySection).map((s) => `"${s}"`))} (${shown(l.types)}): at most ${l.max_rounds} rounds. When spent, a further return is refused (LOOP_EXHAUSTED): stop and wait for the root.`,
    );
  if (loops.length > 2)
    out.push(`${loops.length - 2} more loops are declared (org_doc_list shows the documents).`);
  if (out.length && !isRoot)
    out.push(
      'The root decides an exhausted thread or loop; its decision ends it. Do not publish it again.',
    );
  if (isRoot && (Object.keys(caps).length || declaredLoops(def).length))
    out.push(
      'A spent rework cap or loop reaches you as a notice ("rework exhausted", "loop exhausted") and you decide: accept the document yourself with org_doc_decide, raise the cap in the definition and reload it, or reassign the work. Your decision ends it.',
    );
  return out;
}

/** The Phase 4 lines for `roleId`: empty when the org sets no Phase 4 key or the role has nothing to be told. */
export function phase4Guidance(def: OrgDef, roleId: string, ctx: Phase4Context): string[] {
  if (!usesPhase4Keys(def)) return [];
  const role = def.roles.find((r) => r.id === roleId);
  if (!role || role.kind === 'endpoint') return [];
  const isRoot = roleId === rootRoleId(def);
  const section = sectionOf(def, roleId);
  const out = [
    ...writerLines(def, roleId),
    ...budgetLines(def, roleId, section, isRoot),
    ...reworkLines(def, roleId, section, isRoot, ctx),
  ];
  if (section && sectionLead(def, section) === roleId)
    out.push(
      'As section lead you assign tasks only inside your section (an org_task for another section is refused); raise a cross-section need with the root, who can reach any section.',
    );
  return out;
}
