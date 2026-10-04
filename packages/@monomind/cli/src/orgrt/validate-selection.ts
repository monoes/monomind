// packages/@monomind/cli/src/orgrt/validate-selection.ts
/**
 * Org sections spec 7.1 and 7.3 items 19 to 21 (Phase 5): warnings for a structure
 * that the measured results (spec 14) say fits the work badly. Advice only, never an
 * error: shape alone cannot prove the work is sequential, independent or hand-off
 * critical, so each message states what it saw and the measured reason.
 */
import type { OrgDef } from './types.js';

const isAgent = (r: OrgDef['roles'][number]): boolean => r.kind !== 'endpoint';
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Warnings for items 19 (chain), 20 (team without a deadline) and 21 (documents without checks). */
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

  // #21 a document type nobody can check: the consumer's org_doc_check has nothing to run.
  if (sectionsOn && isObject((def as unknown as Record<string, unknown>).documents))
    for (const [type, c] of Object.entries(
      (def as unknown as { documents: Record<string, unknown> }).documents,
    ))
      if (isObject(c) && !(Array.isArray(c.checks) && c.checks.length > 0))
        out.push(
          `#21 documents.${type}: no checks declared, so a consumer's org_doc_check has nothing to run; measured, a consumer with per-answer evidence and checks caught 8 of 8 injected inconsistencies where one without caught 3 of 8 (0 of 4 wrong values) — add checks over the evidence the producer attaches (errors that agree with their own evidence still pass any check)`,
        );
  return out;
}
