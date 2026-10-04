// packages/@monomind/cli/src/orgrt/documents/section-budget-findings.ts
/**
 * Org sections spec 6.9 and 13.2 (piece P4.1): the definition-level budget checks. Pure: reads the definition
 * and returns findings, each with a stable code, the path it is about and a remedy. Codes are never renamed
 * or reused, only added. Errors fail validate, warnings are reported. Inert like the rest of P4.1: P4.5 maps
 * these into the checklist, and only while `sectionsSurface(def).enabled`.
 */
import {
  type BudgetDef,
  type BudgetRole,
  exceedsUsd,
  isAgentRole,
  isPositiveUsd,
  partitionOf,
  roundUsd,
} from './section-budget.js';

export const BUDGET_FINDING_CODES = [
  'ORG_BUDGET_MISSING',
  'ORG_BUDGET_INVALID',
  'SECTION_BUDGET_SHAPE',
  'SECTION_BUDGET_MISSING',
  'ROLE_CAP_MISSING',
  'ROLE_CAP_INVALID',
  'ROLE_CAP_CONFLICT',
  'SECTION_CAPS_OVER_ALLOCATION',
  'ALLOCATIONS_OVER_ORG_BUDGET',
  'RESERVE_EMPTY',
  'RESERVE_CAPS_OVER',
  'UNPRICED_RUNNER',
  'BUDGET_MODE_UNSUPPORTED',
  'BUDGET_KEY_NOT_YET_SUPPORTED',
  'ALLOCATION_UNASSIGNED',
  'ROSTER_ROLE_UNKNOWN',
] as const;
export type BudgetFindingCode = (typeof BUDGET_FINDING_CODES)[number];

export interface BudgetFinding {
  severity: 'error' | 'warning';
  code: BudgetFindingCode;
  /** Where it was found: `sections.dev.budget.usd`, `roles.coder.budget_usd`, `run_config.budget_usd`. */
  path: string;
  message: string;
  remedy: string;
}

export interface BudgetFindings {
  errors: BudgetFinding[];
  warnings: BudgetFinding[];
}

/** One line for a checklist: `path: message — remedy`. */
export const findingText = (f: BudgetFinding): string => `${f.path}: ${f.message} — ${f.remedy}`;

/** Runners whose reports carry no USD cost (spec 6.9, A27), so a USD cap can never close them. */
export const UNPRICED_RUNNERS: readonly string[] = ['codex', 'antigravity'];

/** Settings of the budget machinery that stays deferred (Appendix D); configured, they fail validate. */
export const DEFERRED_KEYS = ['max_turn_usd', 'allow_unbounded_turn', 'slice_cap', 'slice_floor'] as const;

const usd = (n: number): string => `$${roundUsd(n)}`;
const describe = (v: unknown): string => JSON.stringify(v) ?? 'nothing';
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export interface BudgetFindingsOptions {
  /** The runner a role really runs on. Default: the role's own `runtime`, else the org's. Wiring (P4.5)
   *  passes `effectiveRoleRuntime`, which also reads MONOMIND_RUNTIME and the provider kind. */
  runtimeOf?: (role: BudgetRole) => string | undefined;
}

export function budgetFindings(def: BudgetDef, opts: BudgetFindingsOptions = {}): BudgetFindings {
  const out: BudgetFindings = { errors: [], warnings: [] };
  const add = (
    severity: BudgetFinding['severity'],
    code: BudgetFindingCode,
    path: string,
    message: string,
    remedy: string,
  ): void => {
    out[severity === 'error' ? 'errors' : 'warnings'].push({ severity, code, path, message, remedy });
  };
  const p = partitionOf(def);
  const rc = (def.run_config ?? {}) as Record<string, unknown>;
  const rawSections = isObject(def.sections) ? def.sections : {};
  const allocating = p.sections.some((s) => s.budgetDeclared);

  // The deferred settings and the budget mode: refused whatever else the org sets.
  if (rc.budget_mode !== undefined && rc.budget_mode !== 'soft')
    add(
      'error',
      'BUDGET_MODE_UNSUPPORTED',
      'run_config.budget_mode',
      `${describe(rc.budget_mode)} is not yet supported: only "soft" (individual role closures) is built`,
      'set "soft" or remove run_config.budget_mode',
    );
  for (const k of DEFERRED_KEYS)
    if (rc[k] !== undefined)
      add(
        'error',
        'BUDGET_KEY_NOT_YET_SUPPORTED',
        `run_config.${k}`,
        `${k} is not yet supported (reservations and slices ship only after a measured run shows material overspend)`,
        `remove run_config.${k}`,
      );
  for (const r of def.roles)
    for (const k of DEFERRED_KEYS)
      if ((r as unknown as Record<string, unknown>)[k] !== undefined)
        add(
          'error',
          'BUDGET_KEY_NOT_YET_SUPPORTED',
          `roles.${r.id}.${k}`,
          `${k} is not yet supported (reservations and slices ship only after a measured run shows material overspend)`,
          `remove roles.${r.id}.${k}`,
        );

  if (!allocating) return out;

  // The org budget the allocations are drawn from.
  const org = rc.budget_usd;
  if (org === undefined)
    add(
      'error',
      'ORG_BUDGET_MISSING',
      'run_config.budget_usd',
      'sections allocate USD but run_config.budget_usd is not set; there is no implicit zero-budget root',
      'set run_config.budget_usd to the org budget (allocations plus a funded root reserve)',
    );
  else if (!isPositiveUsd(org))
    add(
      'error',
      'ORG_BUDGET_INVALID',
      'run_config.budget_usd',
      `must be a positive number of dollars — got ${describe(org)}`,
      'set run_config.budget_usd to a positive number',
    );

  // Each section: its allocation and its roster.
  for (const s of p.sections) {
    const at = `sections.${s.name}.budget`;
    const raw = (rawSections[s.name] as Record<string, unknown>).budget;
    if (!s.budgetDeclared)
      add(
        'error',
        'SECTION_BUDGET_MISSING',
        at,
        `section "${s.name}" has no budget while other sections do, so its roles have no partition to be charged to`,
        `add "budget": {"usd": N} to sections.${s.name}, or remove the budget of every section`,
      );
    else if (s.allocationUsd === undefined) {
      const extra = isObject(raw) ? Object.keys(raw).filter((k) => k !== 'usd') : [];
      add(
        'error',
        'SECTION_BUDGET_SHAPE',
        at,
        extra.length > 0
          ? `${extra.map((k) => `"${k}"`).join(', ')} is not yet supported: a section budget is {"usd": N} only (only USD is partitioned)`
          : `must be {"usd": a positive number} — got ${describe(raw)}`,
        `write sections.${s.name}.budget as {"usd": N}`,
      );
    }
    for (const id of s.unknownRoles)
      add(
        'warning',
        'ROSTER_ROLE_UNKNOWN',
        `sections.${s.name}`,
        `role "${id}" is named in the roster but is not a role of this org, so its cap cannot count toward the allocation`,
        `add role "${id}" or remove it from the section`,
      );
    if (s.allocationUsd !== undefined) {
      if (exceedsUsd(s.capSumUsd, s.allocationUsd))
        add(
          'error',
          'SECTION_CAPS_OVER_ALLOCATION',
          `${at}.usd`,
          `the role caps of section "${s.name}" (${s.roles.map((r) => `${r.id} ${usd(r.capUsd ?? 0)}`).join(', ')}) sum to ${usd(s.capSumUsd)}, above its allocation ${usd(s.allocationUsd)}`,
          'lower a role budget_usd or raise the allocation (explicit caps are never reduced for you)',
        );
      else if (exceedsUsd(s.allocationUsd, s.capSumUsd) && s.roles.every((r) => r.capUsd !== undefined))
        add(
          'warning',
          'ALLOCATION_UNASSIGNED',
          `${at}.usd`,
          `${usd(s.allocationUsd - s.capSumUsd)} of section "${s.name}" is not assigned to any role cap; it cannot be spent without a validated reload`,
          'raise a role budget_usd to use it, or lower the allocation',
        );
    }
  }

  // Role caps: explicit, positive, one source. Endpoint roles hold no model session and need none.
  for (const g of [...p.sections, p.reserve])
    for (const r of g.roles) {
      if (r.cap.ok && r.cap.usd === undefined)
        add(
          'error',
          'ROLE_CAP_MISSING',
          `roles.${r.id}.budget_usd`,
          `role "${r.id}" has no explicit budget_usd; with section allocations every role needs a positive cap (a whole allocation is never copied into each role)`,
          `set roles.${r.id}.budget_usd`,
        );
      else if (!r.cap.ok)
        add('error', r.cap.code, `roles.${r.id}.${r.cap.code === 'ROLE_CAP_CONFLICT' ? 'policy.maxUsd' : 'budget_usd'}`, r.cap.message, r.cap.remedy);
    }

  // The org budget, the allocations and the root reserve.
  const orgUsd = p.orgUsd;
  if (orgUsd !== undefined) {
    if (exceedsUsd(p.allocatedUsd, orgUsd))
      add(
        'error',
        'ALLOCATIONS_OVER_ORG_BUDGET',
        'run_config.budget_usd',
        `the section allocations sum to ${usd(p.allocatedUsd)}, above run_config.budget_usd ${usd(orgUsd)}`,
        'lower a section allocation or raise run_config.budget_usd (raising it needs the human)',
      );
    else {
      const reserve = p.reserve.usd as number;
      if (!exceedsUsd(reserve, 0))
        add(
          'error',
          'RESERVE_EMPTY',
          'run_config.budget_usd',
          `the allocations (${usd(p.allocatedUsd)}) use the whole org budget, so the root and the roles in no section have nothing to spend`,
          'leave part of run_config.budget_usd unallocated as the root reserve',
        );
      else if (exceedsUsd(p.reserve.capSumUsd, reserve))
        add(
          'error',
          'RESERVE_CAPS_OVER',
          'run_config.budget_usd',
          `the caps of the root and the roles in no section (${p.reserve.roles.map((r) => `${r.id} ${usd(r.capUsd ?? 0)}`).join(', ')}) sum to ${usd(p.reserve.capSumUsd)}, above the root reserve ${usd(reserve)}`,
          'lower those role caps, lower a section allocation or raise run_config.budget_usd',
        );
    }
  }

  // Runners that report no USD cost cannot be closed by a USD cap (A27).
  const runtimeOf = opts.runtimeOf ?? ((r: BudgetRole) => r.runtime ?? def.runtime);
  for (const r of def.roles) {
    const runner = isAgentRole(r) ? runtimeOf(r) : undefined;
    if (runner !== undefined && UNPRICED_RUNNERS.includes(runner))
      add(
        'error',
        'UNPRICED_RUNNER',
        `roles.${r.id}.runtime`,
        `role "${r.id}" runs on ${runner}, which reports no USD cost, so a USD allocation cannot close it: not yet supported in an org with USD allocations`,
        `run role "${r.id}" on a priced runner (claude), or keep it out of the USD-allocated org`,
      );
  }
  return out;
}
