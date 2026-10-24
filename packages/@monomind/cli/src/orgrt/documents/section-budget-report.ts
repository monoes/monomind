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
import type { BudgetDef } from './section-budget.js';
import {
  type AllocationStatus,
  allocationStatus,
  type ClosureState,
  type GroupStatus,
  type SpendSnapshot,
} from './section-budget-status.js';
import { sectionBudgetsDeclared } from './section-budget-wire.js';
import { sectionsSurface } from './surface.js';

/** True when the report has something to say: the surface is on and a section budget or an org budget is set. */
export function sectionBudgetReportApplies(def: BudgetDef): boolean {
  const org = def.run_config?.budget_usd;
  return sectionsSurface(def).enabled && (sectionBudgetsDeclared(def) || org !== undefined);
}

/** The live spend snapshot: one entry per role of the definition. A role with no live runtime has spent 0 now. */
export function liveSpendSnapshot(
  running: Pick<RunningOrg, 'def' | 'agents' | 'roleSlots'>,
): SpendSnapshot {
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
  return sectionBudgetReportApplies(def)
    ? allocationStatus(def, liveSpendSnapshot(running))
    : undefined;
}

const usd2 = (n: number | undefined): string => (n === undefined ? 'none' : `$${n.toFixed(2)}`);

/** One row of the section budget table, as `org report` prints it and as the `sections` array of the JSON of
 *  `org status`, `org costs` and `org report --format json` carries it (`kind` section, root reserve or org). A
 *  key is omitted when the text table omits it: `budget` and `percent_used` without an allocation,
 *  `retired_usd` at zero. Units are the table's: USD, `percent_used` a whole percent. */
export interface SectionBudgetRow {
  name: string;
  kind: 'section' | 'reserve' | 'org';
  spend_usd: number;
  budget?: number;
  percent_used?: number;
  state: ClosureState;
  role_caps_usd: number;
  retired_usd?: number;
}

const rowOf = (name: string, kind: SectionBudgetRow['kind'], g: GroupStatus): SectionBudgetRow => ({
  name,
  kind,
  spend_usd: Number(g.spentUsd.toFixed(4)),
  ...(g.allocationUsd === undefined ? {} : { budget: g.allocationUsd }),
  ...(g.fraction === undefined ? {} : { percent_used: Math.round(g.fraction * 100) }),
  state: g.state,
  role_caps_usd: g.roleCapSumUsd,
  ...(g.retiredUsd > 0 ? { retired_usd: Number(g.retiredUsd.toFixed(4)) } : {}),
});

/** The rows of the table: one per allocated section, the root reserve when allocated, and the org. */
export function sectionBudgetRows(status: AllocationStatus): SectionBudgetRow[] {
  const rows: SectionBudgetRow[] = [];
  for (const s of status.sections)
    if (s.allocationUsd !== undefined) rows.push(rowOf(s.name, 'section', s));
  if (status.reserve.allocationUsd !== undefined)
    rows.push(rowOf('root reserve', 'reserve', status.reserve));
  rows.push(rowOf('org', 'org', status.org));
  return rows;
}

function line(r: SectionBudgetRow): string {
  const label = r.kind === 'section' ? `section ${r.name}` : r.name;
  const pct = r.percent_used === undefined ? '' : ` (${r.percent_used}%, ${r.state})`;
  const retired =
    r.retired_usd === undefined
      ? ''
      : `, of which replaced incarnations $${r.retired_usd.toFixed(4)}`;
  return `    ${label}: spent $${r.spend_usd.toFixed(4)} of ${usd2(r.budget)}${pct}; role caps ${usd2(r.role_caps_usd)}${retired}`;
}

/** The table `org report` prints: one line per row of `sectionBudgetRows`. Every limit is an individual soft
 *  stop (spec 6.9): nothing here stops a role by itself. */
export function sectionBudgetLines(status: AllocationStatus): string[] {
  return [
    '  Section budgets (USD; individual soft stops):',
    ...sectionBudgetRows(status).map(line),
  ];
}

/** The offline status of a run: each role's summed USD cost (null: unknown, counted 0), or undefined when section
 *  budgets do not apply to the definition. */
function offlineStatus(
  def: BudgetDef,
  roles: Record<string, { costUsd: number | null }>,
): AllocationStatus | undefined {
  if (!sectionBudgetReportApplies(def)) return undefined;
  const snapshot: SpendSnapshot = {};
  for (const [id, r] of Object.entries(roles))
    snapshot[id] = { usd: r.costUsd ?? 0, retiredUsd: 0 };
  return allocationStatus(def, snapshot);
}

/** The lines for a run summary. */
export function sectionBudgetReportLines(
  def: BudgetDef,
  roles: Record<string, { costUsd: number | null }>,
): string[] {
  const status = offlineStatus(def, roles);
  return status ? sectionBudgetLines(status) : [];
}

/** The `sections` rows of a run's JSON: the same status as the lines, [] when section budgets do not apply. */
export function sectionBudgetReportRows(
  def: BudgetDef,
  roles: Record<string, { costUsd: number | null }>,
): SectionBudgetRow[] {
  const status = offlineStatus(def, roles);
  return status ? sectionBudgetRows(status) : [];
}
