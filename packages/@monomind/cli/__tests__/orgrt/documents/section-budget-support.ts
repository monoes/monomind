// Shared builders for the P4.1 section budget tests.
import type { BudgetDef, BudgetRole } from '../../../src/orgrt/documents/section-budget.js';

export const role = (id: string, over: Partial<BudgetRole> = {}): BudgetRole => ({ id, reports_to: 'root', ...over });

/** A definition: root `root` (boss), each section as `{usd, lead, members}`, the roles with their caps given as
 *  `caps` (role id to budget_usd). Roles in no section are the reserve's. */
export function budgetDef(o: {
  org?: number;
  caps: Record<string, number | undefined>;
  secs?: Record<string, { usd?: number; lead?: string; members: string[]; budget?: unknown }>;
  roles?: Record<string, Partial<BudgetRole>>;
  runConfig?: Record<string, unknown>;
}): BudgetDef {
  const ids = Object.keys(o.caps);
  const sections: Record<string, unknown> = {};
  for (const [name, s] of Object.entries(o.secs ?? {}))
    sections[name] = {
      ...(s.lead ? { lead: s.lead } : {}),
      members: s.members,
      ...(s.budget !== undefined ? { budget: s.budget } : s.usd !== undefined ? { budget: { usd: s.usd } } : {}),
    };
  return {
    roles: ids.map((id) =>
      role(id, {
        ...(id === 'root' ? { type: 'boss', reports_to: null } : {}),
        ...(o.caps[id] !== undefined ? { budget_usd: o.caps[id] } : {}),
        ...(o.roles?.[id] ?? {}),
      }),
    ),
    sections,
    run_config: { ...(o.org !== undefined ? { budget_usd: o.org } : {}), ...(o.runConfig ?? {}) },
  };
}

/** A valid example: org 100, dev 40 (lead dl 10, coder 20, tester 10), qa 30 (ql 10, qa1 10, qa2 10), reserve 30
 *  (root 20, ops 10). */
export const goodDef = (): BudgetDef =>
  budgetDef({
    org: 100,
    caps: { root: 20, ops: 10, dl: 10, coder: 20, tester: 10, ql: 10, qa1: 10, qa2: 10 },
    secs: {
      dev: { usd: 40, lead: 'dl', members: ['coder', 'tester'] },
      qa: { usd: 30, lead: 'ql', members: ['qa1', 'qa2'] },
    },
  });

/** Small deterministic PRNG (mulberry32) for the property tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
