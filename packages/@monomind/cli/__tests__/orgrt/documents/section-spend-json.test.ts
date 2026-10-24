// packages/@monomind/cli/__tests__/orgrt/documents/section-spend-json.test.ts
// #708: `org status`, `org costs` and `org report --format json` carry the rows of the `org report` section table
// as `sections`, row for row; an org without section budgets has no `sections` key.
import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { costsAction, reportAction } from '../../../src/commands/org-observe-report.js';
import { statusAction } from '../../../src/commands/org-lifecycle.js';
import { budgetedOrg, newOrgRoot, type Started, startAll, waitUntil } from '../support/section-budget-org.js';

const started: Started[] = [];
const saved = { ...process.env };
afterEach(async () => {
  await Promise.all(
    started.splice(0).map(async (s) => {
      await s.daemon.stopAll().catch(() => {});
      rmSync(s.root, { recursive: true, force: true });
    }),
  );
  for (const k of ['MONOMIND_SPAWN_STAGGER_MS', 'MONOMIND_MIN_FREE_MEM_MB'])
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});

async function stoppedRun(patch: (r: Record<string, any>) => void = () => {}) {
  process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
  process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
  const s = newOrgRoot(budgetedOrg(patch));
  started.push(s);
  const running = await startAll(s);
  for (const [role, usd] of [['coder', 3], ['researcher', 4]] as const) {
    await s.daemon.deliver(s.name, 'human', role, `work cost=${usd}`, 'work');
    expect(await waitUntil(() => (running.agents.get(role)?.metrics.costUsd ?? 0) >= usd)).toBe(true);
  }
  await s.daemon.stopOrg(s.name);
  return s;
}

type Cmd = (ctx: never, name: string) => Promise<unknown>;
async function json(s: Started, fn: Cmd, name: string, args: string[] = []) {
  let out = '';
  const w = vi.spyOn(process.stdout, 'write').mockImplementation(((c: unknown) => ((out += String(c)), true)) as never);
  const l = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await fn({ args: args.length ? args : [name], flags: { _: [], format: 'json' }, cwd: s.root, interactive: false } as never, name);
  } finally {
    w.mockRestore();
    l.mockRestore();
  }
  return JSON.parse(out.trim());
}
async function text(s: Started, name: string): Promise<string[]> {
  const out: string[] = [];
  const l = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void out.push(a.join(' ')));
  try {
    await reportAction({ args: [], flags: { _: [] }, cwd: s.root, interactive: false } as never, name);
  } finally {
    l.mockRestore();
  }
  return out.join('\n').split('\n');
}
/** The JSON row rendered the way the text table renders it. */
const asLine = (r: any): string => {
  const usd2 = (n?: number) => (n === undefined ? 'none' : `$${n.toFixed(2)}`);
  const label = r.kind === 'section' ? `section ${r.name}` : r.name;
  const pct = r.percent_used === undefined ? '' : ` (${r.percent_used}%, ${r.state})`;
  const ret = r.retired_usd === undefined ? '' : `, of which replaced incarnations $${r.retired_usd.toFixed(4)}`;
  return `    ${label}: spent $${r.spend_usd.toFixed(4)} of ${usd2(r.budget)}${pct}; role caps ${usd2(r.role_caps_usd)}${ret}`;
};

describe('per-section spend in the JSON of status, costs and report', () => {
  it('yields rows equal, row for row, to the text table', async () => {
    const s = await stoppedRun();
    const table = (await text(s, s.name)).filter((l) => /^ {4}(section |root reserve|org:)/.test(l));
    expect(table.length).toBeGreaterThan(2);
    const report = await json(s, reportAction as Cmd, s.name);
    expect(report.sections.map(asLine)).toEqual(table);
    expect(report.sections.find((r: any) => r.name === 'development')).toMatchObject({
      kind: 'section', spend_usd: 3, budget: 30, percent_used: 10, state: 'ok', role_caps_usd: 30,
    });
    const costs = await json(s, costsAction as Cmd, s.name);
    expect(costs.sections).toEqual(report.sections);
    const status = await json(s, statusAction as Cmd, s.name);
    expect(status.sections).toEqual(report.sections);
  });

  it('a non-sections org has no sections key in any of the three', async () => {
    const s = await stoppedRun((r) => {
      for (const sec of Object.values<any>(r.sections ?? {})) delete sec.budget;
      delete r.run_config.budget_usd;
    });
    for (const fn of [reportAction, costsAction, statusAction])
      expect(await json(s, fn as Cmd, s.name)).not.toHaveProperty('sections');
  });
});
