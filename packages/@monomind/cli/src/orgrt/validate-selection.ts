// packages/@monomind/cli/src/orgrt/validate-selection.ts
/**
 * Org sections spec 7.1 and 7.3 items 19 to 21 (Phase 5), plus #25 (roster size): warnings for a structure
 * that the measured results (spec 14) say fits the work badly. Advice only, never an
 * error: shape alone cannot prove the work is sequential, independent or hand-off
 * critical, so each message states what it saw and the measured reason.
 */
import type { OrgDef } from './types.js';

const isAgent = (r: OrgDef['roles'][number]): boolean => r.kind !== 'endpoint';
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Roles a flat (sectionless) org may carry before #25 advises merging or sectioning. */
const FLAT_ROSTER_LIMIT = 4;
/** A sections org: sections it may declare and roles one section may hold (lead included). */
const MAX_SECTIONS = 10;
const MAX_SECTION_ROLES = 4;

/** The checks dialect runs over answer sheets (`{ sheets: [...] }`) only, so #21 applies to a
 *  document whose schema declares a `sheets` property; a free-form document has no check to add. */
const usesAnswerSheet = (contract: Record<string, unknown>): boolean => {
  const schema = contract.schema;
  return isObject(schema) && isObject(schema.properties) && 'sheets' in schema.properties;
};

/** Warnings for items 19 (chain), 20 (team without a deadline), 21 (answer-sheet documents without checks) and 25 (large flat roster). */
export function selectionWarnings(def: OrgDef, sectionsOn: boolean): string[] {
  const out: string[] = [];
  const agents = def.roles.filter(isAgent);
  const reports = new Map<string, number>();
  for (const r of agents)
    if (r.reports_to) reports.set(r.reports_to, (reports.get(r.reports_to) ?? 0) + 1);

  // #19 a strict chain: every role has at most one direct report.
  if (!sectionsOn && agents.length >= 3 && agents.every((r) => (reports.get(r.id) ?? 0) <= 1))
    out.push(
      `#19 the ${agents.length} roles form a single chain (each reports to the previous one); sequential work gains little from separate roles — measured, one agent held growth-like work at about a quarter to a third of the cost with the same accepted units. Consider a single agent session`,
    );

  // #20 a parallel team with no deadline to beat.
  const rc = (def.run_config ?? {}) as Record<string, unknown>;
  const workers = agents.filter((r) => r.reports_to && !reports.has(r.id));
  const hasDeadline =
    (def.schedule !== null && def.schedule !== undefined) || rc.max_run !== undefined;
  if (!sectionsOn && workers.length >= 4 && !hasDeadline)
    out.push(
      `#20 ${workers.length} workers run in parallel but no deadline is declared (run_config.max_run, or a schedule); measured, a parallel team pays only when one agent's serial time exceeds the deadline (32 independent sheets in 600 s) and otherwise cost 3.8x to 4.8x a single agent — state the deadline, or use a single agent if the parts are small`,
    );

  // #21 an answer-sheet document type nobody can check: the consumer's org_doc_check has nothing to run.
  if (sectionsOn && isObject((def as unknown as Record<string, unknown>).documents))
    for (const [type, c] of Object.entries(
      (def as unknown as { documents: Record<string, unknown> }).documents,
    ))
      if (isObject(c) && usesAnswerSheet(c) && !(Array.isArray(c.checks) && c.checks.length > 0))
        out.push(
          `#21 documents.${type}: no checks declared, so a consumer's org_doc_check has nothing to run; measured, a consumer with per-answer evidence and checks caught 8 of 8 injected inconsistencies where one without caught 3 of 8 (0 of 4 wrong values) — add checks over the evidence the producer attaches (errors that agree with their own evidence still pass any check)`,
        );

  // #25 a large roster with no sections: every role is its own seat under one boss.
  if (!sectionsOn && agents.length > FLAT_ROSTER_LIMIT)
    out.push(
      `#25 ${agents.length} roles and no sections; every role pays its own startup context and the boss briefs each one — merge roles that share a skill set or a stage (a reviewer into its executor, near-duplicate workers into one), or group the stages that hand typed work to each other into sections. Keep a flat org to ${FLAT_ROSTER_LIMIT} roles or fewer`,
    );

  // #25 (sections form) too many sections, or a section too large to lead.
  const sections = (def as unknown as { sections?: unknown }).sections;
  if (sectionsOn && isObject(sections)) {
    const names = Object.keys(sections);
    if (names.length > MAX_SECTIONS)
      out.push(
        `#25 ${names.length} sections; keep an org to ${MAX_SECTIONS} sections or fewer — merge sections whose output is consumed by the same stage`,
      );
    for (const [name, sec] of Object.entries(sections)) {
      if (!isObject(sec)) continue;
      const roster = new Set<string>(
        [...(Array.isArray(sec.members) ? sec.members : []), sec.lead].filter(
          (x): x is string => typeof x === 'string',
        ),
      );
      if (roster.size > MAX_SECTION_ROLES)
        out.push(
          `#25 sections.${name} holds ${roster.size} roles; keep a section to ${MAX_SECTION_ROLES} or fewer (3 is the default, 1 is fine when one role can do the stage) — split it or merge roles`,
        );
    }
  }
  return out;
}
