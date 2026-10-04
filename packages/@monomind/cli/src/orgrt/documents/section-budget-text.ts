// orgrt/documents/section-budget-text.ts
//
// The words of the section budget notices and refusals (org sections plan P4.6), as pure functions so a golden
// can pin them. Three kinds of scope share one set of sentences: a section's own allocation, the root reserve
// (`run_config.budget_usd` minus the allocations) and the org (`run_config.budget_usd`).

export type BudgetScopeKind = 'section' | 'reserve' | 'org';

/** What a notice or a refusal needs to say about one scope. */
export interface ScopeText {
  kind: BudgetScopeKind;
  /** The section name (kind `section` only). */
  name?: string;
  spentUsd: number;
  allocationUsd: number;
}

export const usd = (n: number): string => `$${n.toFixed(2)}`;
const percent = (s: ScopeText): number => Math.round((s.spentUsd / s.allocationUsd) * 100);

/** `section "dev"`, `the root reserve`, `the org`. */
export function scopeLabel(s: Pick<ScopeText, 'kind' | 'name'>): string {
  return s.kind === 'section'
    ? `section "${s.name}"`
    : s.kind === 'reserve'
      ? 'the root reserve'
      : 'the org';
}

/** What the allocation is, in the definition. */
function scopeBudget(s: Pick<ScopeText, 'kind' | 'name'>): string {
  return s.kind === 'section'
    ? `its USD allocation (sections.${s.name}.budget.usd)`
    : s.kind === 'reserve'
      ? 'its USD reserve (run_config.budget_usd minus the section allocations)'
      : 'its run_config.budget_usd';
}

/** The key to raise to give the scope more room. */
function raiseKey(s: Pick<ScopeText, 'kind' | 'name'>): string {
  return s.kind === 'section'
    ? `sections.${s.name}.budget.usd`
    : s.kind === 'reserve'
      ? 'run_config.budget_usd (or lower a section allocation)'
      : 'run_config.budget_usd';
}

/** The sentence that says what the closure does, for the warning ("will") and the closure notice ("does"). */
const EFFECT =
  'its roles take no new work, no new task can be assigned into it, and its open tasks are held; sessions already running finish their turn';

const OPTIONS = (s: Pick<ScopeText, 'kind' | 'name'>): string =>
  `Options: raise ${raiseKey(s)} and hot-reload it (monomind org reload), which also reopens a closed scope with its spend kept; reassign the remaining work to a section with room; or stop the work.`;

export interface Notice {
  subject: string;
  body: string;
}

/** The 80 percent notice. */
export function warningNotice(s: ScopeText): Notice {
  const label = scopeLabel(s);
  const cap = label[0].toUpperCase() + label.slice(1);
  return {
    subject: `budget: ${label} at ${percent(s)} percent of its USD allocation`,
    body: `${cap} has spent ${usd(s.spentUsd)} of ${scopeBudget(s)}, ${usd(s.allocationUsd)} (${percent(s)} percent). At 100 percent it is soft-closed: ${EFFECT}. ${OPTIONS(s)} Each role's own budget_usd stays an individual soft stop.`,
  };
}

/** The closure notice. `roles` are the roles of the scope, `held` the ids of the tasks that were held. */
export function closureNotice(
  s: ScopeText,
  roles: readonly string[],
  held: readonly string[],
): Notice {
  const label = scopeLabel(s);
  const cap = label[0].toUpperCase() + label.slice(1);
  const heldText = held.length ? ` Held tasks: ${held.join(', ')}.` : '';
  return {
    subject: `budget: ${label} is closed at its USD allocation`,
    body: `${cap} has spent ${usd(s.spentUsd)} of ${scopeBudget(s)}, ${usd(s.allocationUsd)} (${percent(s)} percent), and is now soft-closed: its roles (${roles.join(', ') || 'none'}) take no new work, no new task can be assigned into it, and its open tasks are held; sessions already running finish their turn.${heldText} It reopens when the allocation is raised and hot-reloaded. ${OPTIONS(s)}`,
  };
}

/** Why an org_task, org_plan_graph or split into a closed scope is refused. */
export function assignmentRefusal(s: ScopeText, assignee: string): string {
  return `REFUSED: ${scopeLabel(s)} has spent ${usd(s.spentUsd)} of ${scopeBudget(s)}, ${usd(s.allocationUsd)}, and is closed: no new task can be assigned to "${assignee}" until it reopens. Raise ${raiseKey(s)} and hot-reload it (monomind org reload), or assign the work to a role in another section.`;
}

/** The close reason a held task and the role's budget detail carry. */
export function closureDetail(s: ScopeText): string {
  return `${scopeLabel(s)} USD allocation exhausted (${usd(s.spentUsd)} / $${s.allocationUsd})`;
}

/** What a budget-closed role's tasks are told to do about it (budget-closure.ts `remedy`). */
export function closureRemedy(s: Pick<ScopeText, 'kind' | 'name'>): string {
  return `Raise ${raiseKey(s)} in the org definition and hot-reload it (\`monomind org reload\`) — the closed roles reopen with their spend so far kept — or reassign the work to a role in another section.`;
}

/** The copy of a role's own 80 percent warning that goes to its section lead. */
export function roleWarningCopy(message: string): string {
  return `[budget] ${message}. At the cap its session closes and tasks assigned to it are blocked; its role cap sits inside the section allocation, so raise budget_usd and the allocation together (hot-reload with monomind org reload), or reassign the work.`;
}
