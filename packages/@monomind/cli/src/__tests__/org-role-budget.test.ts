/**
 * Per-role token budgets (#orgrt): a role may carry `budget_tokens` to override
 * the even run_config.budget_tokens ÷ role-count split, so one role on a
 * token-hungry model (e.g. GLM via opencode) doesn't force an inflated org-wide
 * budget. When unset, behavior is byte-for-byte the old even split.
 */
import { describe, expect, it } from 'vitest';
import { roleTokenBudget } from '../orgrt/daemon.js';
import { OrgDefSchema, RoleSchema } from '../orgrt/types.js';

const parseOrg = (roles: object[], budget_tokens = 900) =>
  OrgDefSchema.parse({
    name: 'budget-demo',
    run_config: { budget_tokens },
    roles,
  });

describe('RoleSchema budget_tokens field', () => {
  it('accepts a per-role budget_tokens override', () => {
    const role = RoleSchema.parse({ id: 'dev', budget_tokens: 500_000 });
    expect(role.budget_tokens).toBe(500_000);
  });

  it('leaves budget_tokens undefined when absent', () => {
    const role = RoleSchema.parse({ id: 'dev' });
    expect(role.budget_tokens).toBeUndefined();
  });

  it('rejects non-positive or fractional budget_tokens', () => {
    expect(() => RoleSchema.parse({ id: 'dev', budget_tokens: 0 })).toThrow();
    expect(() => RoleSchema.parse({ id: 'dev', budget_tokens: -100 })).toThrow();
    expect(() => RoleSchema.parse({ id: 'dev', budget_tokens: 1.5 })).toThrow();
  });
});

describe('roleTokenBudget', () => {
  it('splits run_config.budget_tokens evenly when no role override is set', () => {
    const def = parseOrg([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 900);
    for (const role of def.roles) expect(roleTokenBudget(role, def)).toBe(300);
  });

  it('floors the even split for indivisible budgets', () => {
    const def = parseOrg([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 1000);
    expect(roleTokenBudget(def.roles[0], def)).toBe(333);
  });

  it('honors a role-level budget_tokens override without affecting other roles', () => {
    const def = parseOrg([{ id: 'a', budget_tokens: 700 }, { id: 'b' }, { id: 'c' }], 900);
    expect(roleTokenBudget(def.roles[0], def)).toBe(700);
    expect(roleTokenBudget(def.roles[1], def)).toBe(300);
    expect(roleTokenBudget(def.roles[2], def)).toBe(300);
  });

  it('falls back to the 1M default budget when run_config omits budget_tokens', () => {
    const def = OrgDefSchema.parse({ name: 'demo', roles: [{ id: 'a' }, { id: 'b' }] });
    expect(roleTokenBudget(def.roles[0], def)).toBe(500_000);
  });
});
