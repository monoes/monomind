// packages/@monomind/cli/__tests__/orgrt/documents/section-budget-findings.test.ts
// P4.1: every budget finding, failing and passing. Pure; nothing is wired to the checklist yet.
import { describe, expect, it } from 'vitest';
import {
  BUDGET_FINDING_CODES,
  type BudgetFindingCode,
  budgetFindings,
  findingText,
} from '../../../src/orgrt/documents/section-budget-findings.js';
import type { BudgetDef } from '../../../src/orgrt/documents/section-budget.js';
import { budgetDef, goodDef } from './section-budget-support.js';

const codes = (d: BudgetDef, kind: 'errors' | 'warnings' = 'errors'): string[] =>
  budgetFindings(d)[kind].map((f) => f.code);

describe('a valid partition has no findings', () => {
  it('the example is clean', () => {
    expect(budgetFindings(goodDef())).toEqual({ errors: [], warnings: [] });
  });
  it('an org with no section budget and no budget keys is clean (the checks do not apply)', () => {
    const d = budgetDef({ caps: { root: undefined, a: undefined }, secs: { s: { members: ['a'] } } });
    expect(budgetFindings(d)).toEqual({ errors: [], warnings: [] });
  });
  it('caps that exactly fill an allocation are clean (rounding noise is not over-allocation)', () => {
    const d = budgetDef({ org: 1, caps: { root: 0.5, a: 0.1, b: 0.2 }, secs: { s: { usd: 0.3, members: ['a', 'b'] } } });
    expect(budgetFindings(d)).toEqual({ errors: [], warnings: [] });
  });
});

describe('errors', () => {
  const cases: Array<[BudgetFindingCode, string, () => BudgetDef, string]> = [
    [
      'ORG_BUDGET_MISSING',
      'a section has a budget but there is no run_config.budget_usd',
      () => budgetDef({ caps: { root: 10, a: 5 }, secs: { s: { usd: 10, members: ['a'] } } }),
      'run_config.budget_usd',
    ],
    [
      'ORG_BUDGET_INVALID',
      'run_config.budget_usd is zero',
      () => budgetDef({ caps: { root: 10, a: 5 }, runConfig: { budget_usd: 0 }, secs: { s: { usd: 10, members: ['a'] } } }),
      'run_config.budget_usd',
    ],
    [
      'SECTION_BUDGET_SHAPE',
      'a section budget is not {usd}',
      () => budgetDef({ org: 50, caps: { root: 10, a: 5 }, secs: { s: { members: ['a'], budget: { usd: -3 } } } }),
      'sections.s.budget',
    ],
    [
      'SECTION_BUDGET_SHAPE',
      'a section budget names a key other than usd',
      () => budgetDef({ org: 50, caps: { root: 10, a: 5 }, secs: { s: { members: ['a'], budget: { usd: 10, spend: 5 } } } }),
      'sections.s.budget',
    ],
    [
      'SECTION_BUDGET_MISSING',
      'one section has a budget and another has none',
      () =>
        budgetDef({
          org: 100,
          caps: { root: 10, a: 5, b: 5 },
          secs: { one: { usd: 20, members: ['a'] }, two: { members: ['b'] } },
        }),
      'sections.two.budget',
    ],
    [
      'ROLE_CAP_MISSING',
      'a section role has no explicit cap',
      () => budgetDef({ org: 100, caps: { root: 10, a: undefined }, secs: { s: { usd: 20, members: ['a'] } } }),
      'roles.a.budget_usd',
    ],
    [
      'ROLE_CAP_MISSING',
      'the root has no explicit cap',
      () => budgetDef({ org: 100, caps: { root: undefined, a: 5 }, secs: { s: { usd: 20, members: ['a'] } } }),
      'roles.root.budget_usd',
    ],
    [
      'ROLE_CAP_INVALID',
      'a role cap is zero',
      () => budgetDef({ org: 100, caps: { root: 10, a: 5 }, roles: { a: { budget_usd: 0 } }, secs: { s: { usd: 20, members: ['a'] } } }),
      'roles.a.budget_usd',
    ],
    [
      'ROLE_CAP_CONFLICT',
      'policy.maxUsd differs from budget_usd',
      () => budgetDef({ org: 100, caps: { root: 10, a: 5 }, roles: { a: { policy: { maxUsd: 7 } } }, secs: { s: { usd: 20, members: ['a'] } } }),
      'roles.a.policy.maxUsd',
    ],
    [
      'SECTION_CAPS_OVER_ALLOCATION',
      'the role caps of a section sum above its allocation',
      () => budgetDef({ org: 100, caps: { root: 10, a: 15, b: 10 }, secs: { s: { usd: 20, members: ['a', 'b'] } } }),
      'sections.s.budget.usd',
    ],
    [
      'SECTION_CAPS_OVER_ALLOCATION',
      'a lead plus members exceed the allocation (the lead counts once)',
      () => budgetDef({ org: 100, caps: { root: 10, l: 10, a: 5, b: 6 }, secs: { s: { usd: 20, lead: 'l', members: ['a', 'b'] } } }),
      'sections.s.budget.usd',
    ],
    [
      'ALLOCATIONS_OVER_ORG_BUDGET',
      'the allocations sum above the org budget',
      () => budgetDef({ org: 30, caps: { root: 5, a: 5, b: 5 }, secs: { one: { usd: 20, members: ['a'] }, two: { usd: 20, members: ['b'] } } }),
      'run_config.budget_usd',
    ],
    [
      'RESERVE_EMPTY',
      'the allocations use the whole org budget',
      () => budgetDef({ org: 40, caps: { root: 5, a: 5, b: 5 }, secs: { one: { usd: 20, members: ['a'] }, two: { usd: 20, members: ['b'] } } }),
      'run_config.budget_usd',
    ],
    [
      'RESERVE_CAPS_OVER',
      'the root and unsectioned role caps exceed the reserve',
      () => budgetDef({ org: 50, caps: { root: 20, ops: 15, a: 5 }, secs: { s: { usd: 20, members: ['a'] } } }),
      'run_config.budget_usd',
    ],
    [
      'RESERVE_CAPS_OVER',
      'a root that leads a section still counts against the reserve',
      () => budgetDef({ org: 50, caps: { root: 35, w: 5 }, secs: { s: { usd: 20, lead: 'root', members: ['w'] } } }),
      'run_config.budget_usd',
    ],
    [
      'UNPRICED_RUNNER',
      'a codex role in an org with USD allocations',
      () => budgetDef({ org: 100, caps: { root: 10, a: 5 }, roles: { a: { runtime: 'codex' } }, secs: { s: { usd: 20, members: ['a'] } } }),
      'roles.a.runtime',
    ],
    [
      'UNPRICED_RUNNER',
      'an antigravity org runtime reaches every role without its own runtime',
      () => ({ ...budgetDef({ org: 100, caps: { root: 10, a: 5 }, secs: { s: { usd: 20, members: ['a'] } } }), runtime: 'antigravity' }),
      'roles.a.runtime',
    ],
    [
      'BUDGET_MODE_UNSUPPORTED',
      'budget_mode is not soft',
      () => budgetDef({ org: 100, caps: { root: 10, a: 5 }, runConfig: { budget_mode: 'strict' }, secs: { s: { usd: 20, members: ['a'] } } }),
      'run_config.budget_mode',
    ],
    [
      'BUDGET_KEY_NOT_YET_SUPPORTED',
      'a role sets max_turn_usd',
      () => budgetDef({ org: 100, caps: { root: 10, a: 5 }, roles: { a: { max_turn_usd: 1 } as never }, secs: { s: { usd: 20, members: ['a'] } } }),
      'roles.a.max_turn_usd',
    ],
    [
      'BUDGET_KEY_NOT_YET_SUPPORTED',
      'a role sets allow_unbounded_turn (even to false)',
      () => budgetDef({ org: 100, caps: { root: 10, a: 5 }, roles: { a: { allow_unbounded_turn: false } as never }, secs: { s: { usd: 20, members: ['a'] } } }),
      'roles.a.allow_unbounded_turn',
    ],
    [
      'BUDGET_KEY_NOT_YET_SUPPORTED',
      'run_config sets slice_cap',
      () => budgetDef({ org: 100, caps: { root: 10, a: 5 }, runConfig: { slice_cap: 2 }, secs: { s: { usd: 20, members: ['a'] } } }),
      'run_config.slice_cap',
    ],
  ];
  for (const [code, name, build, path] of cases)
    it(`${code}: ${name}`, () => {
      const f = budgetFindings(build()).errors.filter((e) => e.code === code && e.path === path);
      expect(f.length, JSON.stringify(budgetFindings(build()).errors.map((e) => [e.code, e.path]))).toBeGreaterThanOrEqual(1);
      expect(f[0].severity).toBe('error');
      expect(f[0].message.length).toBeGreaterThan(10);
      expect(f[0].remedy.length).toBeGreaterThan(5);
    });

  it('every finding carries a code from the closed list, a path, a message and a remedy', () => {
    for (const [, , build] of cases)
      for (const f of [...budgetFindings(build()).errors, ...budgetFindings(build()).warnings]) {
        expect(BUDGET_FINDING_CODES).toContain(f.code);
        expect(f.path).toMatch(/^(sections|roles|run_config)\./);
        expect(findingText(f)).toBe(`${f.path}: ${f.message} — ${f.remedy}`);
      }
  });

  it('the unpriced-runner message names the role and the runner and says not yet supported', () => {
    const d = budgetDef({ org: 100, caps: { root: 10, a: 5 }, roles: { a: { runtime: 'codex' } }, secs: { s: { usd: 20, members: ['a'] } } });
    const f = budgetFindings(d).errors.find((e) => e.code === 'UNPRICED_RUNNER');
    expect(f?.message).toMatch(/"a".*codex.*not yet supported/);
  });

  it('the unpriced check follows the injected runner resolver, and an endpoint role is exempt', () => {
    const d = budgetDef({ org: 100, caps: { root: 10, a: 5, hook: undefined }, secs: { s: { usd: 20, members: ['a'] } }, roles: { hook: { kind: 'endpoint', runtime: 'codex' } } });
    expect(budgetFindings(d).errors.map((e) => e.code)).not.toContain('UNPRICED_RUNNER');
    const viaEnv = budgetFindings(d, { runtimeOf: (r) => (r.id === 'a' ? 'antigravity' : 'claude') });
    expect(viaEnv.errors.map((e) => e.path)).toEqual(['roles.a.runtime']);
  });

  it('priced runners pass; budget_mode "soft" passes', () => {
    const d = budgetDef({ org: 100, caps: { root: 10, a: 5 }, roles: { a: { runtime: 'claude' } }, runConfig: { budget_mode: 'soft' }, secs: { s: { usd: 20, members: ['a'] } } });
    expect(budgetFindings(d).errors).toEqual([]);
  });

  it('a conflicting policy.maxUsd is not also reported as a missing cap', () => {
    const d = budgetDef({ org: 100, caps: { root: 10, a: undefined }, roles: { a: { policy: { maxUsd: 7 } } }, secs: { s: { usd: 20, members: ['a'] } } });
    expect(codes(d)).toEqual(['ROLE_CAP_CONFLICT']);
  });

  it('the deferred keys and a bad mode fail with no allocation too', () => {
    const d = budgetDef({ caps: { root: 10 }, runConfig: { budget_mode: 'bounded-overshoot', slice_floor: 1 } });
    expect(codes(d)).toEqual(['BUDGET_MODE_UNSUPPORTED', 'BUDGET_KEY_NOT_YET_SUPPORTED']);
  });

  it('a section whose roster names an unknown role reports it as a warning, not a second error', () => {
    const d = budgetDef({ org: 100, caps: { root: 10, a: 20 }, secs: { s: { usd: 20, members: ['a', 'ghost'] } } });
    expect(codes(d)).toEqual([]);
    expect(codes(d, 'warnings')).toEqual(['ROSTER_ROLE_UNKNOWN']);
  });
});

describe('warnings', () => {
  it('ALLOCATION_UNASSIGNED: part of a section allocation no role cap uses', () => {
    const d = budgetDef({ org: 100, caps: { root: 10, a: 5 }, secs: { s: { usd: 20, members: ['a'] } } });
    const w = budgetFindings(d).warnings;
    expect(w.map((x) => x.code)).toEqual(['ALLOCATION_UNASSIGNED']);
    expect(w[0]).toMatchObject({ severity: 'warning', path: 'sections.s.budget.usd' });
    expect(w[0].message).toMatch(/\$15.*validated reload/);
    expect(budgetFindings(d).errors).toEqual([]);
  });

  it('no unassigned warning while a role cap is missing (the error covers it)', () => {
    const d = budgetDef({ org: 100, caps: { root: 10, a: undefined }, secs: { s: { usd: 20, members: ['a'] } } });
    expect(codes(d, 'warnings')).toEqual([]);
  });

  it('no unassigned warning for unused root reserve', () => {
    const d = budgetDef({ org: 100, caps: { root: 10, a: 20 }, secs: { s: { usd: 20, members: ['a'] } } });
    expect(budgetFindings(d)).toEqual({ errors: [], warnings: [] });
  });
});

describe('purity', () => {
  it('does not change its input and is deterministic', () => {
    const d = goodDef();
    const before = JSON.stringify(d);
    const a = budgetFindings(d);
    const b = budgetFindings(d);
    expect(JSON.stringify(d)).toBe(before);
    expect(a).toEqual(b);
  });
});
