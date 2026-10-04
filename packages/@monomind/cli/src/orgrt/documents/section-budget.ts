// packages/@monomind/cli/src/orgrt/documents/section-budget.ts
/**
 * Org sections spec 6.9 and 13.2 (piece P4.1): the section budget rules as pure functions. Nothing here is
 * wired: no module outside documents/ imports it, it reads no clock, environment, file or daemon state, and it
 * returns the same answer for the same definition. P4.5 wires the checks into the checklist and the resolver
 * into startup, resume and reload; P4.6 builds the closure on `allocationStatus`
 * (section-budget-status.ts).
 *
 *  - `effectiveRoleUsdCap`: the ONE resolver of a role's USD cap (A25): `budget_usd`, with `policy.maxUsd`
 *    allowed only when equal.
 *  - `partitionOf`: who is charged to which allocation: each section's roster (the lead once), the root and
 *    every unsectioned role in the root reserve.
 *  - `resolveBudgetCaps`: the cap that applies to every role and section once the org ceiling and the
 *    partition limits are applied (never above the org ceiling).
 *  - `budgetFindings`: the definition-level checks, each with a code, a path and a remedy.
 */

export type RoleCapCode = 'ROLE_CAP_INVALID' | 'ROLE_CAP_CONFLICT';

export type RoleCapResult =
  | { ok: true; usd: number | undefined }
  | { ok: false; code: RoleCapCode; message: string; remedy: string };

/** The part of a role the budget rules read. An `OrgDef` role is assignable to it. */
export interface BudgetRole {
  id: string;
  type?: string;
  kind?: string;
  reports_to?: string | null;
  runtime?: string;
  budget_usd?: number;
  policy?: { maxUsd?: number } | undefined;
}

/** The part of a definition the budget rules read. An `OrgDef` is assignable to it. */
export interface BudgetDef {
  roles: BudgetRole[];
  sections?: unknown;
  runtime?: string;
  run_config?: Record<string, unknown>;
}

/** Dollar amounts are compared at micro-dollar precision so 0.1 + 0.2 fits a 0.3 allocation. */
const EPS = 1e-9;
/** True when `a` is above `b` by more than rounding noise. */
export const exceedsUsd = (a: number, b: number): boolean => a - b > EPS;
export const roundUsd = (n: number): number => Math.round(n * 1e6) / 1e6;
export const isPositiveUsd = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The resolver for one role (A25, spec 6.9 "effective cap parity"). `budget_usd` is canonical;
 *  `policy.maxUsd` may be absent or equal to it. A `maxUsd` with no `budget_usd`, or a different one, is a
 *  conflict: it is never silently preferred or dropped. */
export function effectiveRoleUsdCap(role: BudgetRole): RoleCapResult {
  const cap = role.budget_usd;
  const max = role.policy?.maxUsd;
  for (const [v, name] of [
    [cap, 'budget_usd'],
    [max, 'policy.maxUsd'],
  ] as const)
    if (v !== undefined && !isPositiveUsd(v))
      return {
        ok: false,
        code: 'ROLE_CAP_INVALID',
        message: `role "${role.id}" ${name} must be a positive number of dollars — got ${JSON.stringify(v)}`,
        remedy: `set ${name} to a positive number, or remove it`,
      };
  if (max !== undefined && max !== cap)
    return {
      ok: false,
      code: 'ROLE_CAP_CONFLICT',
      message:
        cap === undefined
          ? `role "${role.id}" sets policy.maxUsd ($${max}) but no budget_usd; in a section org budget_usd is the canonical cap`
          : `role "${role.id}" has budget_usd $${cap} but policy.maxUsd $${max}; two caps for one role would bypass the partition`,
      remedy: `set budget_usd to the cap and remove policy.maxUsd (or make them equal)`,
    };
  return { ok: true, usd: cap };
}

export interface PartitionRole {
  id: string;
  /** The role's own cap when it has one that resolves (undefined: none, invalid or conflicting). */
  capUsd: number | undefined;
  cap: RoleCapResult;
}

export interface PartitionGroup {
  roles: PartitionRole[];
  /** Sum of the resolved caps of `roles`. */
  capSumUsd: number;
}

export interface SectionPartition extends PartitionGroup {
  name: string;
  lead: string | undefined;
  /** True when the section has a `budget` key, well formed or not. */
  budgetDeclared: boolean;
  /** `budget.usd` when it is well formed. */
  allocationUsd: number | undefined;
  /** Roster ids with no role in the definition (the definition check reports them). */
  unknownRoles: string[];
}

export interface Partition {
  /** `run_config.budget_usd` when it is a positive number. */
  orgUsd: number | undefined;
  sections: SectionPartition[];
  /** The root and every role in no section. `usd` is the org budget minus the allocations (negative when
   *  they over-allocate; undefined without an org budget). */
  reserve: PartitionGroup & { usd: number | undefined };
  /** Sum of the well-formed section allocations. */
  allocatedUsd: number;
}

/** The root the way definition.ts picks it: the boss, else the first role that reports to no one. */
export function rootOf(def: BudgetDef): BudgetRole | undefined {
  return def.roles.find((r) => r.type === 'boss') ?? def.roles.find((r) => r.reports_to == null);
}

/** True for a role that runs a model session (an endpoint role is an HTTP automation and holds no cap). */
export const isAgentRole = (r: BudgetRole): boolean => r.kind !== 'endpoint';

const sum = (xs: Array<number | undefined>): number =>
  roundUsd(xs.reduce<number>((a, b) => a + (b ?? 0), 0));

/** Who is charged to which allocation (spec 6.9). A section's roster is its members plus its lead, each role
 *  once. A role in two sections belongs to the first (the definition check reports the rest). The root is
 *  never in a section, even as a section's lead: it stays in the reserve. */
export function partitionOf(def: BudgetDef): Partition {
  const byId = new Map(def.roles.map((r) => [r.id, r]));
  const root = rootOf(def);
  const homed = new Set<string>();
  const group = (roles: BudgetRole[]): PartitionGroup => {
    const rs = roles.map((r): PartitionRole => {
      const cap = effectiveRoleUsdCap(r);
      return { id: r.id, cap, capUsd: cap.ok ? cap.usd : undefined };
    });
    return { roles: rs, capSumUsd: sum(rs.map((r) => r.capUsd)) };
  };

  const sections: SectionPartition[] = [];
  const raw = isObject(def.sections) ? def.sections : {};
  for (const [name, sec] of Object.entries(raw)) {
    if (!isObject(sec)) continue;
    const lead = typeof sec.lead === 'string' ? sec.lead : undefined;
    const ids = [
      ...(Array.isArray(sec.members) ? sec.members.filter((m): m is string => typeof m === 'string') : []),
      ...(lead !== undefined ? [lead] : []),
    ];
    const members: BudgetRole[] = [];
    const unknownRoles: string[] = [];
    for (const id of new Set(ids)) {
      const role = byId.get(id);
      if (!role) unknownRoles.push(id);
      else if (role === root || homed.has(id) || !isAgentRole(role)) continue;
      else {
        homed.add(id);
        members.push(role);
      }
    }
    const budget = sec.budget;
    sections.push({
      name,
      lead,
      budgetDeclared: budget !== undefined,
      allocationUsd:
        isObject(budget) && isPositiveUsd(budget.usd) && Object.keys(budget).length === 1
          ? budget.usd
          : undefined,
      unknownRoles,
      ...group(members),
    });
  }

  const orgBudget = def.run_config?.budget_usd;
  const orgUsd = isPositiveUsd(orgBudget) ? orgBudget : undefined;
  const allocatedUsd = sum(sections.map((s) => s.allocationUsd));
  const others = def.roles.filter((r) => isAgentRole(r) && !homed.has(r.id));
  return {
    orgUsd,
    sections,
    allocatedUsd,
    reserve: {
      ...group(others),
      usd: orgUsd === undefined ? undefined : roundUsd(orgUsd - allocatedUsd),
    },
  };
}

export interface ResolvedRoleCap {
  /** The section the role is charged to; undefined: the root reserve. */
  section: string | undefined;
  /** The role's own cap, when it resolves. */
  declaredUsd: number | undefined;
  /** The cap that applies: the declared cap held under its partition limit and the org ceiling. */
  effectiveUsd: number | undefined;
  /** True when `effectiveUsd` is below `declaredUsd`. A validated definition never is: budgetFindings reports
   *  every case as an error, so a cap is rejected, never silently reduced. */
  clamped: boolean;
}

export interface ResolvedCaps {
  orgUsd: number | undefined;
  /** Each section's allocation held under the org ceiling. */
  sections: Record<string, { allocationUsd: number | undefined; effectiveUsd: number | undefined }>;
  /** The root reserve, never below zero. */
  reserveUsd: number | undefined;
  roles: Record<string, ResolvedRoleCap>;
}

/** The cap that applies to each role and section. The precedence: a role's cap is `budget_usd` (see
 *  `effectiveRoleUsdCap`); it is held under its partition's limit (the section's allocation, or the reserve
 *  for the root and unsectioned roles) and under `run_config.budget_usd`. No entry is ever above the org
 *  ceiling, and with no ceiling and no allocation nothing is held. */
export function resolveBudgetCaps(def: BudgetDef): ResolvedCaps {
  const p = partitionOf(def);
  const under = (...xs: Array<number | undefined>): number | undefined => {
    const defined = xs.filter((x): x is number => x !== undefined);
    return defined.length === 0 ? undefined : Math.min(...defined);
  };
  const reserveUsd = p.reserve.usd === undefined ? undefined : Math.max(0, p.reserve.usd);
  const out: ResolvedCaps = { orgUsd: p.orgUsd, sections: {}, reserveUsd, roles: {} };
  const place = (g: PartitionGroup, section: string | undefined, limit: number | undefined): void => {
    for (const r of g.roles) {
      const effectiveUsd = r.capUsd === undefined ? undefined : under(r.capUsd, limit, p.orgUsd);
      out.roles[r.id] = {
        section,
        declaredUsd: r.capUsd,
        effectiveUsd,
        clamped: effectiveUsd !== undefined && effectiveUsd < (r.capUsd as number),
      };
    }
  };
  for (const s of p.sections) {
    const effectiveUsd = under(s.allocationUsd, p.orgUsd);
    out.sections[s.name] = { allocationUsd: s.allocationUsd, effectiveUsd };
    place(s, s.name, effectiveUsd);
  }
  place(p.reserve, undefined, reserveUsd);
  return out;
}

