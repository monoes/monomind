// packages/@monomind/cli/__tests__/orgrt/documents/section-budget-status.test.ts
// P4.1: spend aggregation by section, the 80 percent threshold and the closure state. Pure over a snapshot.
import { describe, expect, it } from 'vitest';
import { BUDGET_WARN_FRACTION } from '../../../src/orgrt/budget-closure.js';
import {
  allocationStatus,
  SECTION_BUDGET_WARN_FRACTION,
  type SpendSnapshot,
} from '../../../src/orgrt/documents/section-budget-status.js';
import { budgetDef, goodDef, rng } from './section-budget-support.js';

const snap = (o: Record<string, number | [number, number]>): SpendSnapshot =>
  Object.fromEntries(
    Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? { usd: v[0], retiredUsd: v[1] } : { usd: v, retiredUsd: 0 }]),
  );

describe('the threshold is the one the role closures use', () => {
  it('80 percent, equal to budget-closure.ts BUDGET_WARN_FRACTION', () => {
    expect(SECTION_BUDGET_WARN_FRACTION).toBe(BUDGET_WARN_FRACTION);
  });
});

describe('allocationStatus: arithmetic', () => {
  it('sums a section once per role, the lead once, the root in the reserve', () => {
    const s = allocationStatus(goodDef(), snap({ dl: 5, coder: 10, tester: 1, root: 4, ops: 1, qa1: 2 }));
    const dev = s.sections.find((x) => x.name === 'dev');
    expect(dev).toMatchObject({ allocationUsd: 40, roleCapSumUsd: 40, spentUsd: 16, lead: 'dl' });
    expect(dev?.fraction).toBeCloseTo(0.4);
    expect(s.sections.find((x) => x.name === 'qa')?.spentUsd).toBe(2);
    expect(s.reserve).toMatchObject({ allocationUsd: 30, roleCapSumUsd: 30, spentUsd: 5 });
    expect(s.org).toMatchObject({ allocationUsd: 100, roleCapSumUsd: 100, spentUsd: 23 });
    expect(s.unattributedUsd).toBe(0);
  });

  it('retired spend of a replaced incarnation counts once with the live spend', () => {
    const s = allocationStatus(goodDef(), snap({ coder: [3, 7], tester: [0, 2] }));
    const dev = s.sections.find((x) => x.name === 'dev');
    expect(dev).toMatchObject({ spentUsd: 12, retiredUsd: 9 });
    expect(dev?.roles.find((r) => r.roleId === 'coder')).toMatchObject({ spentUsd: 10, retiredUsd: 7, capUsd: 20 });
    expect(s.org).toMatchObject({ spentUsd: 12, retiredUsd: 9 });
  });

  it('a snapshot is a map, so a role cannot appear twice: spend of one role is its entry, not two', () => {
    const once = allocationStatus(goodDef(), snap({ coder: [3, 7] }));
    const split = allocationStatus(goodDef(), snap({ coder: [10, 0] }));
    expect(once.org.spentUsd).toBe(split.org.spentUsd);
  });

  it('spend of a role the definition no longer has is unattributed but still in the org total', () => {
    const s = allocationStatus(goodDef(), snap({ coder: 4, gone: [1, 2] }));
    expect(s.unattributedUsd).toBe(3);
    expect(s.org).toMatchObject({ spentUsd: 7, retiredUsd: 2 });
    expect(s.sections.find((x) => x.name === 'dev')?.spentUsd).toBe(4);
  });

  it('a role with no record is listed as unrecorded, not read as proof of zero', () => {
    const s = allocationStatus(goodDef(), snap({ coder: 4 }));
    expect(s.unrecorded).toContain('tester');
    expect(s.unrecorded).not.toContain('coder');
  });

  it('a malformed amount is reported and counted as zero', () => {
    const s = allocationStatus(goodDef(), {
      coder: { usd: Number.NaN, retiredUsd: 1 },
      tester: { usd: -2, retiredUsd: 0 },
    } as SpendSnapshot);
    expect(s.problems.map((p) => [p.code, p.roleId, p.field])).toEqual([
      ['SPEND_NOT_A_NUMBER', 'coder', 'usd'],
      ['SPEND_NEGATIVE', 'tester', 'usd'],
    ]);
    expect(s.org.spentUsd).toBe(1);
  });
});

describe('allocationStatus: thresholds and closure state', () => {
  const state = (spent: number) =>
    allocationStatus(goodDef(), snap({ coder: spent })).sections.find((x) => x.name === 'dev')?.state;
  const table: Array<[number, string]> = [
    [0, 'ok'],
    [31.99, 'ok'],
    [32, 'warn'], // 80 percent of 40
    [39.99, 'warn'],
    [40, 'closed'],
    [55, 'closed'],
  ];
  for (const [spent, want] of table) it(`a section allocation 40 with ${spent} spent is ${want}`, () => expect(state(spent)).toBe(want));

  it('a role is measured against its own cap, the org against run_config.budget_usd', () => {
    const s = allocationStatus(goodDef(), snap({ coder: 16, tester: 10, root: 20 }));
    const dev = s.sections.find((x) => x.name === 'dev');
    expect(dev?.roles.find((r) => r.roleId === 'coder')?.state).toBe('warn'); // 16 of 20
    expect(dev?.roles.find((r) => r.roleId === 'tester')?.state).toBe('closed'); // 10 of 10
    expect(s.reserve.roles.find((r) => r.roleId === 'root')?.state).toBe('closed');
    expect(s.org.state).toBe('ok'); // 46 of 100
  });

  it('the org closes at its budget and warns at 80 percent', () => {
    expect(allocationStatus(goodDef(), snap({ coder: 80 })).org.state).toBe('warn');
    expect(allocationStatus(goodDef(), snap({ coder: 100 })).org.state).toBe('closed');
  });

  it('without an allocation the state is unallocated and no fraction is given', () => {
    const d = budgetDef({ caps: { root: 10, a: 5 }, secs: { s: { members: ['a'] } } });
    const s = allocationStatus(d, snap({ a: 4 }));
    expect(s.org).toMatchObject({ state: 'unallocated', fraction: undefined });
    expect(s.sections[0]).toMatchObject({ state: 'unallocated', spentUsd: 4 });
    expect(s.sections[0].roles[0]).toMatchObject({ capUsd: 5, state: 'warn' });
  });

  it('a section reaches its allocation only through a role overshoot when caps are below it: the role closes first', () => {
    const s = allocationStatus(goodDef(), snap({ dl: 10, coder: 20, tester: 10 }));
    expect(s.sections.find((x) => x.name === 'dev')?.state).toBe('closed');
    expect(s.sections.find((x) => x.name === 'dev')?.roles.map((r) => r.state)).toEqual(['closed', 'closed', 'closed']);
  });
});

describe('allocationStatus: properties', () => {
  it('aggregation equals the sum of the roles: sections + reserve + unattributed = org = sum of the snapshot', () => {
    const rand = rng(7);
    for (let i = 0; i < 300; i++) {
      const caps: Record<string, number | undefined> = { root: 10 };
      const secs: Record<string, { usd: number; lead?: string; members: string[] }> = {};
      for (let s = 0; s < 1 + Math.floor(rand() * 3); s++) {
        const members = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, m) => `r${s}_${m}`);
        for (const m of members) caps[m] = 5;
        secs[`s${s}`] = { usd: 30, lead: rand() < 0.5 ? members[0] : undefined, members };
      }
      const spend: SpendSnapshot = {};
      for (const id of [...Object.keys(caps), 'gone'])
        if (rand() < 0.8) spend[id] = { usd: Math.round(rand() * 900) / 100, retiredUsd: Math.round(rand() * 400) / 100 };
      const d = budgetDef({ org: 200, caps, secs });
      const s = allocationStatus(d, spend);
      const total = Object.values(spend).reduce((a, r) => a + r.usd + r.retiredUsd, 0);
      const parts = s.sections.reduce((a, x) => a + x.spentUsd, 0) + s.reserve.spentUsd + s.unattributedUsd;
      expect(parts).toBeCloseTo(total, 4);
      expect(s.org.spentUsd).toBeCloseTo(total, 4);
      for (const g of [...s.sections, s.reserve])
        expect(g.spentUsd).toBeCloseTo(g.roles.reduce((a, r) => a + r.spentUsd, 0), 4);
    }
  });

  it('is deterministic and does not change its inputs', () => {
    const d = goodDef();
    const sp = snap({ coder: 3, gone: [1, 1] });
    const before = JSON.stringify([d, sp]);
    const a = allocationStatus(d, sp);
    expect(allocationStatus(d, sp)).toEqual(a);
    expect(JSON.stringify([d, sp])).toBe(before);
  });
});
