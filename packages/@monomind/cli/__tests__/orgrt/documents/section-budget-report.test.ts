// packages/@monomind/cli/__tests__/orgrt/documents/section-budget-report.test.ts
// P4.5: the per-section budget report. A real OrgDaemon with a scripted runner that reports a USD cost per
// message (no model): spend by section and root reserve, allocation, fraction and state from `allocationStatus`;
// a replaced incarnation counts once (live + retired); `org report` prints the same table from the run's bus; a
// section over its allocation is `closed` in the report and nothing is closed. Sections-off orgs print nothing new.
import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportAction } from '../../../src/commands/org-observe-report.js';
import { liveSectionBudgetStatus, sectionBudgetLines, sectionBudgetReportLines } from '../../../src/orgrt/documents/section-budget-report.js';
import { readRunEvents, summarizeRun } from '../../../src/orgrt/reporting.js';
import { OrgDefSchema } from '../../../src/orgrt/types.js';
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
async function run(patch: (r: Record<string, any>) => void = () => {}) {
  process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
  process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
  const s = newOrgRoot(budgetedOrg((r) => { Object.assign(r.run_config, { max_role_respawns: 2, respawn_start_timeout_ms: 100 }); patch(r); }));
  started.push(s);
  return { s, running: await startAll(s) };
}
/** Send `cost=<usd>` to a role and wait until its live metrics show `total`. */
async function spend(s: Started, running: any, roleId: string, usd: number, total: number) {
  await s.daemon.deliver(s.name, 'human', roleId, `work cost=${usd}`, 'work');
  expect(await waitUntil(() => Math.abs((running.agents.get(roleId)?.metrics.costUsd ?? 0) - total) < 1e-9), `${roleId} spend`).toBe(true);
}
const section = (st: any, name: string) => st.sections.find((x: any) => x.name === name);

describe('the live report of a running org', () => {
  it('spend by section and root reserve, with allocation, fraction and state', async () => {
    const { s, running } = await run();
    await spend(s, running, 'coder', 3, 3);
    await spend(s, running, 'dev-lead', 1, 1);
    await spend(s, running, 'researcher', 21, 21); // 70% of research's 30
    await spend(s, running, 'boss', 5, 5);
    const st = liveSectionBudgetStatus(running)!;
    expect(section(st, 'development')).toMatchObject({ allocationUsd: 30, spentUsd: 4, retiredUsd: 0, roleCapSumUsd: 30, state: 'ok' });
    expect(section(st, 'research')).toMatchObject({ allocationUsd: 30, spentUsd: 21, state: 'ok' });
    expect(st.reserve).toMatchObject({ allocationUsd: 40, spentUsd: 5, roleCapSumUsd: 30, state: 'ok' });
    expect(st.org).toMatchObject({ allocationUsd: 100, spentUsd: 30, roleCapSumUsd: 90 });
    expect(st.problems).toEqual([]);
  });

  it('a section at 80 percent warns, and one over its allocation is reported closed with nothing closed', async () => {
    // a role may overshoot its cap by a turn: the researcher cap is 20, and it reports 22 in one turn
    const { s, running } = await run();
    await spend(s, running, 'researcher', 22, 22);
    await spend(s, running, 'research-lead', 8, 8); // 30 of 30: at the allocation
    const st = liveSectionBudgetStatus(running)!;
    expect(section(st, 'research')).toMatchObject({ spentUsd: 30, state: 'closed' });
    expect(section(st, 'development')).toMatchObject({ spentUsd: 0, state: 'ok' });
    // P4.5 only reports: the section as such closes nothing (the researcher's own cap of 20 is a role stop;
    // its lead, under its own cap, stays open, and so does the rest of the org)
    expect(running.agents.get('research-lead')!.mailbox.isClosed).toBe(false);
    expect(running.agents.get('coder')!.mailbox.isClosed).toBe(false);
    expect(running.orgBudgetClosed).toBeUndefined();
  });

  it('a replaced incarnation counts once: live plus retired, one entry per role', async () => {
    const { s, running } = await run();
    await spend(s, running, 'coder', 3, 3);
    const receipt = await s.daemon.respawnRole(s.name, 'boss', { roleId: 'coder', reason: 'test', briefing: 'test' });
    expect(receipt.success, receipt.error).toBe(true);
    expect(running.roleSlots.get('coder')!.retiredUsage.costUsd).toBe(3);
    // right after the replacement: the retired 3 is the whole spend, and the live incarnation has spent nothing
    let st = liveSectionBudgetStatus(running)!;
    expect(section(st, 'development')).toMatchObject({ spentUsd: 3, retiredUsd: 3 });
    // the replacement then spends 2: the section total is 5, not 3 + 5 or 3 + 3 + 2
    await spend(s, running, 'coder', 2, 2);
    st = liveSectionBudgetStatus(running)!;
    expect(section(st, 'development')).toMatchObject({ spentUsd: 5, retiredUsd: 3 });
    expect(st.org.spentUsd).toBe(5);
    // enforcement agrees: the replacement's policy was seeded with what was retired
    expect(running.agents.get('coder')!.policy.usageUsd).toBe(5);
    expect(st.sections.flatMap((x) => x.roles).find((r) => r.roleId === 'coder')).toMatchObject({ spentUsd: 5, capUsd: 20 });
  });

  it('a surface-on org without section budgets or an org budget has no report', async () => {
    const { running } = await run((r) => {
      for (const x of r.roles) delete x.budget_usd;
      delete r.run_config.budget_usd;
      delete r.sections.research.budget;
      delete r.sections.development.budget;
    });
    expect(liveSectionBudgetStatus(running)).toBeUndefined();
  });
});

describe('the table', () => {
  it('names the limits "individual soft stops" and lists sections, root reserve and org', async () => {
    const { s, running } = await run();
    await spend(s, running, 'coder', 3, 3);
    const lines = sectionBudgetLines(liveSectionBudgetStatus(running)!);
    expect(lines[0]).toBe('  Section budgets (USD; individual soft stops):');
    expect(lines[1]).toBe('    section research: spent $0.0000 of $30.00 (0%, ok); role caps $30.00');
    expect(lines[2]).toBe('    section development: spent $3.0000 of $30.00 (10%, ok); role caps $30.00');
    expect(lines[3]).toBe('    root reserve: spent $0.0000 of $40.00 (0%, ok); role caps $30.00');
    expect(lines[4]).toBe('    org: spent $3.0000 of $100.00 (3%, ok); role caps $90.00');
  });
});

describe('`org report` from the recorded run', () => {
  const capture = async (s: Started, name: string): Promise<string> => {
    const out: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void out.push(a.join(' ')));
    try {
      await reportAction({ args: [], flags: { _: [] }, cwd: s.root, interactive: false } as never, name);
    } finally {
      spy.mockRestore();
    }
    return out.join('\n');
  };

  it('prints the same table as the live report, from the usage events of the bus', async () => {
    const { s, running } = await run();
    await spend(s, running, 'coder', 3, 3);
    await spend(s, running, 'researcher', 4, 4);
    const live = sectionBudgetLines(liveSectionBudgetStatus(running)!);
    const runId = running.run;
    await s.daemon.stopOrg(s.name);
    const summary = summarizeRun(readRunEvents(s.root, s.name, runId));
    expect(sectionBudgetReportLines(OrgDefSchema.parse(budgetedOrg()) as never, summary.roles)).toEqual(live);
    const text = await capture(s, s.name);
    for (const line of live) expect(text).toContain(line);
  });

  it('a replaced incarnation is not counted twice offline: the bus already holds every incarnation', async () => {
    const { s, running } = await run();
    await spend(s, running, 'coder', 3, 3);
    await s.daemon.respawnRole(s.name, 'boss', { roleId: 'coder', reason: 'test', briefing: 'test' });
    await spend(s, running, 'coder', 2, 2);
    const live = sectionBudgetLines(liveSectionBudgetStatus(running)!);
    const runId = running.run;
    await s.daemon.stopOrg(s.name);
    const summary = summarizeRun(readRunEvents(s.root, s.name, runId));
    expect(summary.roles.coder.costUsd).toBe(5);
    const offline = sectionBudgetReportLines(OrgDefSchema.parse(budgetedOrg()) as never, summary.roles);
    expect(offline[2]).toContain('spent $5.0000 of $30.00');
    expect(offline[2].replace(/, of which.*$/, '')).toBe(live[2].replace(/, of which.*$/, ''));
  });

  it('a sections-off report is unchanged: no budget line at all', async () => {
    const s = newOrgRoot({
      name: 'plain', goal: 'g', run_config: { idle_minutes: 0 },
      roles: [{ id: 'boss', title: 'b', type: 'boss', reports_to: null, responsibilities: ['x'], budget_usd: 5 }],
    });
    started.push(s);
    const running = await s.daemon.startOrg('plain');
    await s.daemon.deliver('plain', 'human', 'boss', 'work cost=1', 'work');
    await waitUntil(() => (running.agents.get('boss')?.metrics.costUsd ?? 0) > 0);
    await s.daemon.stopOrg('plain');
    expect(await capture(s, 'plain')).not.toMatch(/Section budgets|soft stops/);
  });

  it('the report lines are empty for a plain definition and for a surface-on one with no budget key', () => {
    const plain = OrgDefSchema.parse({ name: 'p', roles: [{ id: 'boss' }] });
    expect(sectionBudgetReportLines(plain as never, { boss: { costUsd: 1 } })).toEqual([]);
    const noBudget = OrgDefSchema.parse(budgetedOrg((r) => {
      delete r.run_config.budget_usd;
      delete r.sections.research.budget;
      delete r.sections.development.budget;
    }));
    expect(sectionBudgetReportLines(noBudget as never, { boss: { costUsd: 1 } })).toEqual([]);
  });
});
