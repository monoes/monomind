// packages/@monomind/cli/src/orgrt/documents/section-budget-wire.ts
/**
 * Org sections spec 6.9 and 13.2 (piece P4.5): the wiring of the section budget core (P4.1) into the
 * definition check, the role start path and the reload path. Three small pieces, each a no-op unless
 * `sectionsSurface(def).enabled` AND a section declares a `budget`:
 *  - `sectionBudgetChecklist`: the P4.1 findings as checklist strings (errors fail validate, start and reload).
 *  - `sectionRoleCap`: the ONE resolver of the USD cap a role runs with, used by role start (start, resume,
 *    respawn) and by reload. A role outside this case keeps today's expression.
 *  - `syncSectionBudgets`: a reload carries the changed `sections.<s>.budget` into the running definition, so
 *    the cap resolved at reload and at a later start read the same allocation.
 * Nothing closes or notifies here (P4.6): the caps only resolve, validate and report.
 */
import { effectiveRoleRuntime } from '../runner-specs.js';
import type { OrgDef, OrgRole } from '../types.js';
import { budgetFindings, DEFERRED_KEYS, findingText } from './section-budget-findings.js';
import { type BudgetDef, isPositiveUsd, resolveBudgetCaps } from './section-budget.js';
import { sectionsSurface } from './surface.js';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The `run_config` keys of the deferred budget machinery: on the surface they are refused with the core's
 *  message, so the checklist must not also call them unknown. */
export const BUDGET_REFUSED_RUN_CONFIG_KEYS: readonly string[] = DEFERRED_KEYS;

/** True when at least one section declares a `budget` (well formed or not). */
export function sectionBudgetsDeclared(def: { sections?: unknown }): boolean {
  return isObject(def.sections) && Object.values(def.sections).some((s) => isObject(s) && s.budget !== undefined);
}

/** True when section budgets apply: the sections surface is on and a section declares a budget. */
export const sectionBudgetsApply = (def: { sections?: unknown }): boolean =>
  sectionsSurface(def).enabled && sectionBudgetsDeclared(def);

/** The budget findings of a definition on the sections surface, as checklist strings. */
export function sectionBudgetChecklist(def: OrgDef): { errors: string[]; warnings: string[] } {
  const raw = def as unknown as BudgetDef & { runtime?: string };
  const found = budgetFindings(raw, {
    runtimeOf: (r) => effectiveRoleRuntime(r.runtime, raw.runtime, (r as unknown as OrgRole).provider?.kind),
  });
  const errors = found.errors.map(findingText);
  // `run_config.budget_usd` alone (no section budget) is the org ceiling: it must still be a positive number.
  const org = raw.run_config?.budget_usd;
  if (org !== undefined && !isPositiveUsd(org) && !sectionBudgetsDeclared(raw))
    errors.push(
      `run_config.budget_usd: must be a positive number of dollars — got ${JSON.stringify(org) ?? 'nothing'} — set run_config.budget_usd to a positive number`,
    );
  return { errors, warnings: found.warnings.map(findingText) };
}

/** The USD cap `roleId` runs with when section budgets apply (the resolver of P4.1, `resolveBudgetCaps`);
 *  undefined when they do not or the role has no cap, and the caller keeps today's expression. */
export function sectionRoleCap(def: BudgetDef, roleId: string): number | undefined {
  return sectionBudgetsApply(def) ? resolveBudgetCaps(def).roles[roleId]?.effectiveUsd : undefined;
}

/** Copy each existing section's `budget` from the proposed definition into the running one; returns the
 *  `changed` entries. Only the budget moves: the rest of `sections` is not reloadable here. */
export function syncSectionBudgets(live: { sections?: unknown }, next: { sections?: unknown }): string[] {
  if (!sectionsSurface(live).enabled || !sectionsSurface(next).enabled) return [];
  const changed: string[] = [];
  const liveSections = live.sections as Record<string, unknown>;
  for (const [name, sec] of Object.entries(next.sections as Record<string, unknown>)) {
    const target = liveSections[name];
    if (!isObject(target) || !isObject(sec)) continue;
    if (JSON.stringify(target.budget) === JSON.stringify(sec.budget)) continue;
    if (sec.budget === undefined) delete target.budget;
    else target.budget = sec.budget;
    changed.push(`sections.${name}.budget`);
  }
  return changed;
}
