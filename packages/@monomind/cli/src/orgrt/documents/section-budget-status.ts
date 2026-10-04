// packages/@monomind/cli/src/orgrt/documents/section-budget-status.ts
/**
 * Org sections spec 6.9 and 13.2 (piece P4.1): spend aggregation by section, the 80 percent threshold and the
 * closure state, as one pure function over a snapshot of the per-role spend the runtime already keeps (a live
 * role's `usageUsd` and its slot's `retiredUsage.costUsd`). Nothing is persisted: the status is derived at
 * any moment, so a respawn or a resume neither resets nor double counts spend. Inert like the rest of P4.1.
 */
import { type BudgetDef, partitionOf, resolveBudgetCaps, roundUsd } from './section-budget.js';

/** Share of an allocation or cap at which the lead and the root are warned. The same value as
 *  `BUDGET_WARN_FRACTION` in budget-closure.ts (a test pins the two equal; that file is not imported so this
 *  one stays free of the daemon). */
export const SECTION_BUDGET_WARN_FRACTION = 0.8;

/** What one role has spent: the live incarnation and what replaced incarnations retired into its slot. One
 *  entry per role (per slot), so a replaced incarnation is never a second entry and cannot count twice. */
export interface RoleSpend {
  usd: number;
  retiredUsd: number;
}

export type SpendSnapshot = Record<string, RoleSpend>;

/** `unallocated`: nothing to measure against. `ok` below 80 percent, `warn` from 80 percent, `closed` at or
 *  above the allocation (the comparison `PolicyEngine.overBudgetUsd` makes for a role). */
export type ClosureState = 'unallocated' | 'ok' | 'warn' | 'closed';

export const SNAPSHOT_PROBLEM_CODES = ['SPEND_NOT_A_NUMBER', 'SPEND_NEGATIVE'] as const;
export type SnapshotProblemCode = (typeof SNAPSHOT_PROBLEM_CODES)[number];

export interface SnapshotProblem {
  code: SnapshotProblemCode;
  roleId: string;
  /** `usd` or `retiredUsd`. */
  field: keyof RoleSpend;
  message: string;
}

export interface RoleStatus {
  roleId: string;
  spentUsd: number;
  retiredUsd: number;
  /** The role's own cap (`budget_usd`), when it has one that resolves. */
  capUsd: number | undefined;
  fraction: number | undefined;
  state: ClosureState;
}

export interface GroupStatus {
  /** The allocation: the section's `budget.usd`, the root reserve, or the org budget. */
  allocationUsd: number | undefined;
  /** Sum of the role caps charged to this allocation (the org: every role's). */
  roleCapSumUsd: number;
  spentUsd: number;
  /** Of `spentUsd`, what replaced incarnations retired. */
  retiredUsd: number;
  fraction: number | undefined;
  state: ClosureState;
}

export interface AllocationStatus {
  org: GroupStatus;
  sections: Array<GroupStatus & { name: string; lead: string | undefined; roles: RoleStatus[] }>;
  reserve: GroupStatus & { roles: RoleStatus[] };
  /** Spend of snapshot roles the definition no longer has (a role removed by a reload keeps its spend). It
   *  counts in the org total and in no section. */
  unattributedUsd: number;
  /** Roles of the definition with no entry in the snapshot: spend unknown, not read as zero. */
  unrecorded: string[];
  problems: SnapshotProblem[];
}

const stateOf = (spent: number, allocation: number | undefined): ClosureState =>
  allocation === undefined
    ? 'unallocated'
    : spent >= allocation
      ? 'closed'
      : spent >= allocation * SECTION_BUDGET_WARN_FRACTION
        ? 'warn'
        : 'ok';

const group = (
  allocationUsd: number | undefined,
  roleCapSumUsd: number,
  spentUsd: number,
  retiredUsd: number,
): GroupStatus => ({
  allocationUsd,
  roleCapSumUsd,
  spentUsd: roundUsd(spentUsd),
  retiredUsd: roundUsd(retiredUsd),
  fraction: allocationUsd === undefined ? undefined : spentUsd / allocationUsd,
  state: stateOf(spentUsd, allocationUsd),
});

/** Per-section, root-reserve and org spend from a snapshot. Invariants (pinned by property tests): the spend
 *  of every section plus the reserve plus `unattributedUsd` equals the org spend, which equals the sum over
 *  the snapshot's roles of `usd + retiredUsd`; every role is counted once, a lead once, the root in the
 *  reserve. A malformed amount (not finite, or negative) is reported in `problems` and counted as zero. */
export function allocationStatus(def: BudgetDef, snapshot: SpendSnapshot): AllocationStatus {
  const p = partitionOf(def);
  const caps = resolveBudgetCaps(def);
  const problems: SnapshotProblem[] = [];
  const spend = new Map<string, RoleSpend>();
  for (const [roleId, raw] of Object.entries(snapshot)) {
    const one: RoleSpend = { usd: 0, retiredUsd: 0 };
    for (const field of ['usd', 'retiredUsd'] as const) {
      const v = raw?.[field];
      if (typeof v !== 'number' || !Number.isFinite(v))
        problems.push({
          code: 'SPEND_NOT_A_NUMBER',
          roleId,
          field,
          message: `${roleId}.${field} is ${JSON.stringify(v) ?? 'missing'}, not a number; counted as 0`,
        });
      else if (v < 0)
        problems.push({
          code: 'SPEND_NEGATIVE',
          roleId,
          field,
          message: `${roleId}.${field} is ${v}, below 0; counted as 0`,
        });
      else one[field] = v;
    }
    spend.set(roleId, one);
  }

  const known = new Set<string>();
  const roleStatuses = (ids: string[]): { roles: RoleStatus[]; spent: number; retired: number } => {
    let spent = 0;
    let retired = 0;
    const roles = ids.map((roleId): RoleStatus => {
      known.add(roleId);
      const s = spend.get(roleId) ?? { usd: 0, retiredUsd: 0 };
      const total = s.usd + s.retiredUsd;
      const capUsd = caps.roles[roleId]?.declaredUsd;
      spent += total;
      retired += s.retiredUsd;
      return {
        roleId,
        spentUsd: roundUsd(total),
        retiredUsd: roundUsd(s.retiredUsd),
        capUsd,
        fraction: capUsd === undefined ? undefined : total / capUsd,
        state: stateOf(total, capUsd),
      };
    });
    return { roles, spent, retired };
  };

  const sections = p.sections.map((s) => {
    const r = roleStatuses(s.roles.map((x) => x.id));
    return {
      name: s.name,
      lead: s.lead,
      roles: r.roles,
      ...group(s.allocationUsd, s.capSumUsd, r.spent, r.retired),
    };
  });
  const rr = roleStatuses(p.reserve.roles.map((x) => x.id));
  const reserve = {
    roles: rr.roles,
    ...group(
      p.reserve.usd === undefined ? undefined : Math.max(0, p.reserve.usd),
      p.reserve.capSumUsd,
      rr.spent,
      rr.retired,
    ),
  };

  let unattributed = 0;
  let _unattributedRetired = 0;
  for (const [roleId, s] of spend)
    if (!known.has(roleId)) {
      unattributed += s.usd + s.retiredUsd;
      _unattributedRetired += s.retiredUsd;
    }
  let spent = 0;
  let retired = 0;
  for (const s of spend.values()) {
    spent += s.usd + s.retiredUsd;
    retired += s.retiredUsd;
  }
  const capSum = p.sections.reduce((a, s) => a + s.capSumUsd, 0) + p.reserve.capSumUsd;
  return {
    org: group(p.orgUsd, roundUsd(capSum), spent, retired),
    sections,
    reserve,
    unattributedUsd: roundUsd(unattributed),
    unrecorded: def.roles.filter((r) => known.has(r.id) && !spend.has(r.id)).map((r) => r.id),
    problems,
  };
}
