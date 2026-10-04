// packages/@monomind/cli/__tests__/orgrt/documents/section-budget.test.ts
// P4.1: the effective-cap resolver (A25), the partition and the resolved caps. Pure, nothing wired.
import { describe, expect, it } from 'vitest';
import {
  effectiveRoleUsdCap,
  partitionOf,
  resolveBudgetCaps,
} from '../../../src/orgrt/documents/section-budget.js';
import { budgetDef, goodDef, rng } from './section-budget-support.js';

describe('effectiveRoleUsdCap: budget_usd is canonical, policy.maxUsd may only equal it', () => {
  const r = (extra: Record<string, unknown>) => ({ id: 'x', ...extra });
  const table: Array<[string, Record<string, unknown>, unknown]> = [
    ['no cap at all', {}, { ok: true, usd: undefined }],
    ['budget_usd alone', { budget_usd: 5 }, { ok: true, usd: 5 }],
    ['equal policy.maxUsd', { budget_usd: 5, policy: { maxUsd: 5 } }, { ok: true, usd: 5 }],
    ['policy present without maxUsd', { budget_usd: 5, policy: {} }, { ok: true, usd: 5 }],
    ['conflicting policy.maxUsd (lower)', { budget_usd: 5, policy: { maxUsd: 3 } }, { ok: false, code: 'ROLE_CAP_CONFLICT' }],
    ['conflicting policy.maxUsd (higher)', { budget_usd: 5, policy: { maxUsd: 9 } }, { ok: false, code: 'ROLE_CAP_CONFLICT' }],
    ['policy.maxUsd without budget_usd', { policy: { maxUsd: 5 } }, { ok: false, code: 'ROLE_CAP_CONFLICT' }],
    ['zero budget_usd', { budget_usd: 0 }, { ok: false, code: 'ROLE_CAP_INVALID' }],
    ['negative budget_usd', { budget_usd: -1 }, { ok: false, code: 'ROLE_CAP_INVALID' }],
    ['NaN budget_usd', { budget_usd: Number.NaN }, { ok: false, code: 'ROLE_CAP_INVALID' }],
    ['string budget_usd', { budget_usd: '5' }, { ok: false, code: 'ROLE_CAP_INVALID' }],
    ['zero policy.maxUsd', { budget_usd: 5, policy: { maxUsd: 0 } }, { ok: false, code: 'ROLE_CAP_INVALID' }],
  ];
  for (const [name, role, want] of table)
    it(name, () => expect(effectiveRoleUsdCap(r(role) as never)).toMatchObject(want as object));

  it('a conflict names the role, both values and a remedy', () => {
    const res = effectiveRoleUsdCap(r({ budget_usd: 5, policy: { maxUsd: 3 } }) as never);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toMatch(/"x".*\$5.*\$3/);
      expect(res.remedy).toMatch(/remove policy\.maxUsd/);
    }
  });
});

describe('partitionOf: who is charged to which allocation', () => {
  it('splits roles into sections and the reserve; the lead is counted once', () => {
    const p = partitionOf(goodDef());
    expect(p.orgUsd).toBe(100);
    expect(p.allocatedUsd).toBe(70);
    expect(p.reserve.usd).toBe(30);
    const dev = p.sections.find((s) => s.name === 'dev');
    expect(dev?.roles.map((r) => r.id).sort()).toEqual(['coder', 'dl', 'tester']);
    expect(dev?.capSumUsd).toBe(40);
    expect(p.reserve.roles.map((r) => r.id).sort()).toEqual(['ops', 'root']);
    expect(p.reserve.capSumUsd).toBe(30);
  });

  it('a lead that is also listed as a member is counted once', () => {
    const d = budgetDef({ org: 50, caps: { root: 10, a: 10, b: 10 }, secs: { s: { usd: 20, lead: 'a', members: ['a', 'b'] } } });
    const s = partitionOf(d).sections[0];
    expect(s.roles.map((r) => r.id)).toEqual(['a', 'b']);
    expect(s.capSumUsd).toBe(20);
  });

  it('a root that is a section lead stays in the reserve, not in the section', () => {
    const d = budgetDef({ org: 100, caps: { root: 30, w: 10 }, secs: { s: { usd: 20, lead: 'root', members: ['w'] } } });
    const p = partitionOf(d);
    expect(p.sections[0].roles.map((r) => r.id)).toEqual(['w']);
    expect(p.reserve.roles.map((r) => r.id)).toEqual(['root']);
    expect(p.reserve.capSumUsd).toBe(30);
  });

  it('a role listed in two sections belongs to the first only', () => {
    const d = budgetDef({
      org: 100,
      caps: { root: 10, a: 5, b: 5 },
      secs: { one: { usd: 20, members: ['a'] }, two: { usd: 20, lead: 'b', members: ['a', 'b'] } },
    });
    const p = partitionOf(d);
    expect(p.sections.map((s) => s.roles.map((r) => r.id))).toEqual([['a'], ['b']]);
  });

  it('an endpoint role holds no cap and is in no partition; unknown roster ids are listed, not counted', () => {
    const d = budgetDef({
      org: 100,
      caps: { root: 10, hook: undefined, a: 5 },
      secs: { s: { usd: 20, members: ['a', 'ghost'] } },
      roles: { hook: { kind: 'endpoint' } },
    });
    const p = partitionOf(d);
    expect(p.sections[0].unknownRoles).toEqual(['ghost']);
    expect(p.reserve.roles.map((r) => r.id)).toEqual(['root']);
  });

  it('a malformed budget gives no allocation; no org budget gives no reserve', () => {
    const d = budgetDef({ caps: { root: 10, a: 5 }, secs: { s: { members: ['a'], budget: { usd: 5, spend: 9 } } } });
    const p = partitionOf(d);
    expect(p.sections[0]).toMatchObject({ budgetDeclared: true, allocationUsd: undefined });
    expect(p.orgUsd).toBeUndefined();
    expect(p.reserve.usd).toBeUndefined();
  });

  it('sums at micro-dollar precision (0.1 + 0.2 is 0.3)', () => {
    const d = budgetDef({ org: 1, caps: { root: 0.5, a: 0.1, b: 0.2 }, secs: { s: { usd: 0.3, members: ['a', 'b'] } } });
    expect(partitionOf(d).sections[0].capSumUsd).toBe(0.3);
  });
});

describe('resolveBudgetCaps: the cap that applies', () => {
  it('a valid definition resolves every role to its declared cap, unclamped', () => {
    const c = resolveBudgetCaps(goodDef());
    expect(c.roles.coder).toEqual({ section: 'dev', declaredUsd: 20, effectiveUsd: 20, clamped: false });
    expect(c.roles.root).toEqual({ section: undefined, declaredUsd: 20, effectiveUsd: 20, clamped: false });
    expect(c.sections.dev).toEqual({ allocationUsd: 40, effectiveUsd: 40 });
    expect(c.reserveUsd).toBe(30);
  });

  it('a role cap above its section allocation is held at the allocation and flagged, never passed through', () => {
    const d = budgetDef({ org: 100, caps: { root: 10, a: 50 }, secs: { s: { usd: 20, members: ['a'] } } });
    expect(resolveBudgetCaps(d).roles.a).toMatchObject({ declaredUsd: 50, effectiveUsd: 20, clamped: true });
  });

  it('an allocation above the org ceiling is held at the ceiling; a negative reserve is zero', () => {
    const d = budgetDef({ org: 30, caps: { root: 5, a: 5 }, secs: { s: { usd: 80, members: ['a'] } } });
    const c = resolveBudgetCaps(d);
    expect(c.sections.s.effectiveUsd).toBe(30);
    expect(c.reserveUsd).toBe(0);
    expect(c.roles.root).toMatchObject({ declaredUsd: 5, effectiveUsd: 0, clamped: true });
  });

  it('a conflicting or invalid role cap resolves to no cap (the finding reports it)', () => {
    const d = budgetDef({ org: 100, caps: { root: 10, a: 5 }, roles: { a: { policy: { maxUsd: 9 } } }, secs: { s: { usd: 20, members: ['a'] } } });
    expect(resolveBudgetCaps(d).roles.a).toMatchObject({ declaredUsd: undefined, effectiveUsd: undefined });
  });

  it('without an org budget nothing is held', () => {
    const d = budgetDef({ caps: { root: 10, a: 5 }, secs: { s: { members: ['a'] } } });
    expect(resolveBudgetCaps(d).roles.a).toMatchObject({ effectiveUsd: 5, clamped: false });
  });

  it('property: no effective cap, section cap or the reserve is ever above the org ceiling', () => {
    const rand = rng(41);
    for (let i = 0; i < 300; i++) {
      const nSec = 1 + Math.floor(rand() * 3);
      const caps: Record<string, number | undefined> = { root: Math.round(rand() * 50) / 2 + 0.5 };
      const secs: Record<string, { usd?: number; lead?: string; members: string[] }> = {};
      for (let s = 0; s < nSec; s++) {
        const members: string[] = [];
        for (let m = 0; m < 1 + Math.floor(rand() * 3); m++) {
          const id = `r${s}_${m}`;
          members.push(id);
          caps[id] = rand() < 0.1 ? undefined : Math.round(rand() * 80) / 2 + 0.5;
        }
        secs[`s${s}`] = { usd: rand() < 0.9 ? Math.round(rand() * 100) / 2 + 0.5 : undefined, members };
      }
      const org = Math.round(rand() * 120) + 1;
      const c = resolveBudgetCaps(budgetDef({ org, caps, secs }));
      expect(c.reserveUsd as number).toBeLessThanOrEqual(org);
      for (const s of Object.values(c.sections)) expect(s.effectiveUsd ?? 0).toBeLessThanOrEqual(org);
      for (const r of Object.values(c.roles)) {
        expect(r.effectiveUsd ?? 0).toBeLessThanOrEqual(org);
        if (r.effectiveUsd !== undefined) expect(r.effectiveUsd).toBeLessThanOrEqual(r.declaredUsd as number);
      }
    }
  });
});
