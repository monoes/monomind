// packages/@monomind/cli/src/orgrt/documents/section-budget-report.ts
/**
 * Org sections spec 6.9 and 13.2 (piece P4.5): the per-section budget report. Derived at any moment from
 * spend the runtime already keeps, never persisted (no checkpoint field, no migration):
 *  - live: each role's `metrics.costUsd` (its live incarnation, restored from the checkpoint on resume) plus its
 *    slot's `retiredUsage.costUsd` (replaced incarnations), as one entry per role. The live POLICY usage is not
 *    used: a replacement's policy is seeded with the retired spend (role-respawn.ts), so adding the two would
 *    count a replaced incarnation twice.
 *  - offline (`org report`): the spend of each role summed from the run's usage events, which already include
 *    every incarnation of the role, so nothing is retired separately.
 * Reporting only: a section over its allocation is `closed` in the table and nothing is closed (P4.6).
 */
import type { RunningOrg } from '../daemon-types.js';
import { type AllocationStatus, allocationStatus, type GroupStatus, type SpendSnapshot } from './section-budget-status.js';
import { type BudgetDef } from './section-budget.js';
import { sectionBudgetsDeclared } from './section-budget-wire.js';
import { sectionsSurface } from './surface.js';

/** True when the report has something to say: the surface is on and a section budget or an org budget is set. */
export function sectionBudgetReportApplies(def: BudgetDef): boolean {
  const org = def.run_config?.budget_usd;
  return sectionsSurface(def).enabled && (sectionBudgetsDeclared(def) || org !== undefined);
}

/** The live spend snapshot: one entry per role of the definition. A role with no live runtime has spent 0 now. */
export function liveSpendSnapshot(running: Pick<RunningOrg, 'def' | 'agents' | 'roleSlots'>): SpendSnapshot {
  const out: SpendSnapshot = {};
  for (const r of running.def.roles)
    out[r.id] = {
      usd: running.agents.get(r.id)?.metrics.costUsd ?? 0,
      retiredUsd: running.roleSlots.get(r.id)?.retiredUsage.costUsd ?? 0,
    };
  return out;
}

/** The status of a running org, or undefined when section budgets do not apply to it. */
export function liveSectionBudgetStatus(running: RunningOrg): AllocationStatus | undefined {
  const def = running.def as unknown as BudgetDef;
  return sectionBudgetReportApplies(def) ? allocationStatus(def, liveSpendSnapshot(running)) : undefined;
}

const usd2 = (n: number | undefined): string => (n === undefined ? 'none' : `$${n.toFixed(2)}`);

function row(label: string, g: GroupStatus): string {
  const pct = g.fraction === undefined ? '' : ` (${Math.round(g.fraction * 100)}%, ${g.state})`;
  const retired = g.retiredUsd > 0 ? `, of which replaced incarnations $${g.retiredUsd.toFixed(4)}` : '';
  return `    ${label}: spent $${g.spentUsd.toFixed(4)} of ${usd2(g.allocationUsd)}${pct}; role caps ${usd2(g.roleCapSumUsd)}${retired}`;
}

/** The table `org report` prints: one line per allocated section, the root reserve and the org. Every limit is an
 *  individual soft stop (spec 6.9): nothing here stops a role by itself. */
export function sectionBudgetLines(status: AllocationStatus): string[] {
  const lines = ['  Section budgets (USD; individual soft stops):'];
  for (const s of status.sections) if (s.allocationUsd !== undefined) lines.push(row(`section ${s.name}`, s));
  if (status.reserve.allocationUsd !== undefined) lines.push(row('root reserve', status.reserve));
  lines.push(row('org', status.org));
  return lines;
}

/** The lines for a run summary: from the definition and each role's summed USD cost (null: unknown, counted 0). */
export function sectionBudgetReportLines(
  def: BudgetDef,
  roles: Record<string, { costUsd: number | null }>,
): string[] {
  if (!sectionBudgetReportApplies(def)) return [];
  const snapshot: SpendSnapshot = {};
  for (const [id, r] of Object.entries(roles)) snapshot[id] = { usd: r.costUsd ?? 0, retiredUsd: 0 };
  return sectionBudgetLines(allocationStatus(def, snapshot));
}
