// P4.12: the combined scenario, the Phase 4 keys on one miniature org in the real daemon (no model): a writer
// (development), section budgets (development 30, qa 20, reserve 50, org 100) and rework caps (qa 2, development 3).
// One run: a build is rejected twice (the rework cap is spent, the producer is refused, the root accepts), a report
// travels back the other way and is accepted, then spend crosses development's 80 percent, closes the section at its allocation, and a
// reload that raises it reopens the lead. The full trail is pinned as fixtures/phase4/e2e-combined-trail.json (re-capture:
// see trail4.ts). Every wait is a counted condition.
import { describe, expect, it } from 'vitest';
import { KEY_SETS, phase4Org } from '../../support/phase4-guidance-defs.js';
import { expectGolden4, trail4Of } from './trail4.js';
import { CostScripted, publish, review, spend, useWorld, waitFor } from './world.js';

const world = useWorld('p4-combined');
const ROLES = ['boss', 'dev-lead', 'coder', 'qa-lead', 'observer'];
const org = (edit: (r: Record<string, any>) => void = () => {}) => {
  const raw = phase4Org(KEY_SETS.all);
  raw.name = 'p4-combined';
  edit(raw);
  return raw;
};
const raised = (r: Record<string, any>) => {
  r.sections.development.budget = { usd: 40 };
  r.run_config.budget_usd = 110;
};

async function run() {
  const runner = new CostScripted();
  const started = await world.start(org(), { runner });
  const { d, name, running, docs } = started;
  const t: Record<string, any> = {};
  for (const r of ROLES) t[r] = await runner.toolsOf(d, name, r);
  const refusals: Array<{ step: string; code?: string; guard_code?: string }> = [];
  const refused = (step: string, res: any) => refusals.push({ step, code: res.code, guard_code: res.guard_code });
  const got = (role: string, prefix: string, n: number) => waitFor(() => runner.count(role, prefix) >= n);

  // ---- rework: a build rejected twice by qa (cap 2) ----
  expect(await publish(t.coder, 'build', 'the first build')).toMatchObject({ ok: true, ref: 'build-1@v1' });
  expect(await got('qa-lead', 'document ready: build-1 v1', 1)).toBe(true);
  await review(t['qa-lead'], 'build-1', 1, 'reject', 'no tests');
  expect(await got('coder', 'document rejected: build-1 v1', 1) && (await got('dev-lead', 'document rejected: build-1 v1 (copy)', 1))).toBe(true);
  await publish(t.coder, 'build', 'the second build', { supersedes: 'build-1@v1' });
  expect(await got('qa-lead', 'document ready: build-1 v2', 1)).toBe(true);
  await review(t['qa-lead'], 'build-1', 2, 'reject', 'still no tests');
  for (const r of ['boss', 'dev-lead', 'qa-lead']) expect(await got(r, 'rework exhausted', 1), r).toBe(true);
  expect(await got('coder', 'document rejected: build-1 v2', 1)).toBe(true);
  refused('republish a spent thread', await publish(t.coder, 'build', 'the third build', { supersedes: 'build-1@v2' }));
  await review(t.boss, 'build-1', 2, 'accept'); // the root decides the frozen head
  await docs.notices!.idle();

  // ---- the other direction: qa publishes a report on the accepted build, development accepts it ----
  await publish(t['qa-lead'], 'report', 'two defects found');
  expect(await got('dev-lead', 'document ready: report-1 v1', 1)).toBe(true);
  await review(t['dev-lead'], 'report-1', 1, 'accept');
  await docs.notices!.idle();

  // ---- budget: the 80 percent notice, the role cap, the allocation, a reload that reopens ----
  const go = (role: string, usd: number, total: number) => spend(d, name, running, role, usd, total);
  await go('coder', 17, 17);
  await go('dev-lead', 7, 7);
  for (const r of ['boss', 'dev-lead']) expect(await got(r, 'budget: section "development" at', 1), r).toBe(true);
  await go('coder', 5, 22); // past its own cap of 20: it closes on its own, the section is at 29 of 30
  expect(await waitFor(() => running.agents.get('coder')!.mailbox.isClosed)).toBe(true);
  await go('dev-lead', 1, 8); // 30 of 30: the section closes
  expect(await waitFor(() => running.sectionBudget!.closed.has('section:development'))).toBe(true);
  expect(await got('boss', 'budget: section "development" is closed', 1)).toBe(true);
  world.write(org(raised));
  d.reloadOrgDef(name);
  expect(running.sectionBudget!.closed.size).toBe(0);
  expect(running.agents.get('dev-lead')!.mailbox.isClosed).toBe(false);
  await docs.notices!.idle();
  await running.sectionBudget!.notices.idle();
  expect(runner.errors).toEqual([]);
  return { ...started, runner, t, refusals };
}

describe('writer, budgets and rework on one org', () => {
  it('the scenario ends in the state its own assertions describe', async () => {
    const { runner, docs, running, refusals } = await run();
    expect(refusals).toEqual([
      { step: 'republish a spent thread', code: 'REWORK_EXHAUSTED', guard_code: 'REWORK_EXHAUSTED' },
    ]);
    expect(docs.store.list().map((x) => `${x.id}:${x.versions.map((v) => `v${v.version}:${v.status}`).join(',')}`).sort()).toEqual([
      'build-1:v1:rejected,v2:accepted',
      'report-1:v1:accepted',
    ]);
    // the writer: the developer's engine holds the section's scope, every other role is read-only
    expect(running.agents.get('coder')!.policy.policy.fileWrite).toEqual(['src/**', 'docs/**']);
    for (const r of ['boss', 'qa-lead', 'observer']) expect(running.agents.get(r)!.policy.policy.fileWrite, r).toEqual([]);
    // each notice went out once: 3 rework, 2 budget (warning to the lead and the root) + the closure notices
    for (const r of ['boss', 'dev-lead', 'qa-lead']) {
      expect(runner.count(r, 'rework exhausted'), r).toBe(1);
    }
    expect(runner.count('coder', 'rework exhausted')).toBe(0);
    expect(runner.count('boss', 'budget: section "development" at')).toBe(1);
    expect(runner.count('dev-lead', 'budget: section "development" at')).toBe(1);
    expect(runner.count('qa-lead', 'budget:')).toBe(0);
    const closed = running.busEvents().filter((e) => e.reason === 'section-budget-closed');
    expect(closed).toHaveLength(1);
    expect(running.busEvents().filter((e) => e.reason === 'section-budget-reopened')).toHaveLength(1);
    expect(running.agents.get('coder')!.mailbox.isClosed).toBe(true); // over its own cap: an individual soft stop that a raise of the section does not lift
  }, 60_000);

  it('the full trail equals the pinned golden', async () => {
    const { root, running, docs, runner, refusals } = { ...(await run()), root: world.root };
    expectGolden4('e2e-combined-trail', trail4Of({ root, running, docs, runner, roles: ROLES, refusals }));
  }, 60_000);
});
