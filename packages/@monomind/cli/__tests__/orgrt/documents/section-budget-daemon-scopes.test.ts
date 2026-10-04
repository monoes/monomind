// P4.6, part 2: the root reserve, the org USD ceiling, resume and durability of the notices through a real
// daemon, and the inert cases (a sections-on org with no USD budget, a sections-off org). Part 1 is
// section-budget-daemon.test.ts. Same scripted runner: a role reports `cost=<usd>` per message, no model.
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dagCreateTask } from '../../../src/orgrt/decisions.js';
import { warningNotice } from '../../../src/orgrt/documents/section-budget-text.js';
import { findingsOrg } from '../support/doc-defs.js';
import { budgetedOrg, newOrgRoot, ROLES, startAll, waitUntil } from '../support/section-budget-org.js';
import { budgetNotices, eventsOf, harness, RecordingCostRunner, settle } from '../support/section-budget-run-org.js';

const { started, run, spend } = harness();
const reloaded = (edit: (r: Record<string, any>) => void) =>
  budgetedOrg((r) => {
    Object.assign(r.run_config, { max_role_respawns: 2, respawn_start_timeout_ms: 100 });
    edit(r);
  });
const create = (s: any, assignee: string) => JSON.parse(dagCreateTask(s.daemon, s.name, 'boss', 'work', assignee, []));

describe('the root reserve', () => {
  it('warns the root alone at 80 percent, and at its allocation closes the root with the existing org-budget event', async () => {
    const { s, running, runner } = await run();
    await spend(s, running, 'observer', 15, 15); // over its cap of 10: closed on its own
    await spend(s, running, 'boss', 19, 19); // 34 of the reserve's 40: 85 percent
    const w = warningNotice({ kind: 'reserve', spentUsd: 34, allocationUsd: 40 });
    expect(await budgetNotices(runner, 'boss', 1)).toEqual([w.subject]);
    await settle();
    for (const id of ['research-lead', 'dev-lead', 'coder']) expect(runner.budget(id), id).toEqual([]);
    expect(eventsOf(running, 'section-budget-warning')[0].data).toMatchObject({ scope: 'reserve' });
    await spend(s, running, 'boss', 6, 25); // 40 of 40, the root over its own cap too
    expect(await waitUntil(() => running.sectionBudget!.closed.has('reserve'))).toBe(true);
    // the root is among the closed: the human sees the event the CLI end line and the dashboard already show
    const status = running.busEvents().filter((e) => e.type === 'status' && e.reason === 'org-budget-exhausted');
    expect(status).toHaveLength(1);
    expect(status[0].msg).toContain('the root reserve USD allocation exhausted ($40.00/$40.00) — the root is closed');
    // the sections are untouched
    for (const id of ['research-lead', 'researcher', 'dev-lead', 'coder']) expect(running.agents.get(id)!.mailbox.isClosed, id).toBe(false);
    expect(create(s, 'coder').error).toBeUndefined();
    expect(create(s, 'observer').error).toContain('REFUSED: the root reserve has spent $40.00');
  });
});

describe('the org USD ceiling (run_config.budget_usd with no section budgets)', () => {
  const orgOnly = (r: Record<string, any>) => {
    delete r.sections.research.budget;
    delete r.sections.development.budget;
    r.run_config.budget_usd = 40;
    for (const role of r.roles) role.budget_usd = 5;
  };

  async function atCeiling() {
    const r = await run(orgOnly);
    const { s, running, runner } = r;
    await spend(s, running, 'researcher', 10, 10);
    await spend(s, running, 'coder', 12, 12);
    await spend(s, running, 'boss', 10, 10); // 32 of 40: 80 percent
    await budgetNotices(runner, 'research-lead', 1);
    await spend(s, running, 'dev-lead', 8, 8); // 40: the ceiling
    expect(await waitUntil(() => running.sectionBudget!.closed.has('org'))).toBe(true);
    return r;
  }

  it('warns the root and every section lead once at 80 percent', async () => {
    const { running, runner } = await atCeiling();
    const w = warningNotice({ kind: 'org', spentUsd: 32, allocationUsd: 40 });
    for (const id of ['research-lead', 'dev-lead']) expect(runner.budget(id)[0], id).toBe(w.subject);
    const recs = running.sectionBudget!.notices.records().filter((x) => x.kind === 'section-budget-warning');
    expect(recs.map((x) => x.to).sort()).toEqual(['boss', 'dev-lead', 'research-lead']);
    expect(eventsOf(running, 'section-budget-warning')).toHaveLength(1);
  });

  it('closes every open role softly at the ceiling, refuses new tasks anywhere, and a raising reload reopens it', async () => {
    const { s, running } = await atCeiling();
    for (const id of ROLES) expect(running.agents.get(id)!.mailbox.isClosed, id).toBe(true);
    expect(running.agents.get('research-lead')!.mailbox.closeReason).toBe('usd-budget');
    expect(running.agents.get('observer')!.mailbox.closeReason).toBe('usd-budget');
    expect(running.orgBudgetClosed).toBeUndefined(); // the token ceiling's state is not touched
    const status = running.busEvents().filter((e) => e.type === 'status' && e.reason === 'org-budget-exhausted');
    expect(status).toHaveLength(1);
    expect(status[0].msg).toContain('the org USD allocation exhausted ($40.00/$40.00) — the root is closed');
    for (const id of ['coder', 'research-lead', 'boss']) expect(create(s, id).error, id).toContain('REFUSED: the org has spent $40.00 of its run_config.budget_usd');
    s.write(reloaded((r) => {
      orgOnly(r);
      r.run_config.budget_usd = 60;
    }));
    s.daemon.reloadOrgDef(s.name);
    expect(running.sectionBudget!.closed.size).toBe(0);
    // reopened: the roles the ceiling closed; the ones over their own cap stay closed (an individual soft stop)
    for (const id of ['research-lead', 'observer']) expect(running.agents.get(id)!.mailbox.isClosed, id).toBe(false);
    for (const id of ['boss', 'researcher', 'coder', 'dev-lead']) expect(running.agents.get(id)!.mailbox.isClosed, id).toBe(true);
    expect(create(s, 'research-lead').error).toBeUndefined();
    expect(eventsOf(running, 'section-budget-reopened')).toHaveLength(1);
  });
});

describe('resume and durability', () => {
  const docsDir = (running: any): string => running.documents.dir;

  it('a crossing already notified is not notified again after a resume, and the spend is kept', async () => {
    const { s, running, runner } = await run();
    await spend(s, running, 'researcher', 20, 20);
    await spend(s, running, 'research-lead', 4, 4);
    await budgetNotices(runner, 'boss', 1);
    await waitUntil(() => running.sectionBudget!.notices.pending().length === 0);
    const dir = docsDir(running);
    await s.daemon.stopOrg(s.name);
    const again = await startAll(s, { resume: true });
    expect(await waitUntil(() => ROLES.every((id) => again.agents.has(id)))).toBe(true);
    expect(again.run).toBe(running.run);
    expect(docsDir(again)).toBe(dir);
    expect(again.agents.get('research-lead')!.metrics.costUsd).toBe(4);
    await spend(s, again, 'research-lead', 1, 5); // a usage event after the resume: the evaluator sees 80+ percent again
    await settle();
    expect(eventsOf(again, 'section-budget-warning')).toEqual([]);
    expect(runner.budget('boss')).toHaveLength(1);
    expect(runner.budget('research-lead')).toHaveLength(1);
    expect(again.sectionBudget!.notices.records().map((x) => x.state)).toEqual(['delivered', 'delivered']);
  });

  it('a crash between the crossing and the delivery: the journalled obligation is sent once at the resume, never twice', async () => {
    const { s, running, runner } = await run();
    const dir = docsDir(running);
    await s.daemon.stopOrg(s.name);
    // the process died after journalling the crossing and before delivering it
    const w = warningNotice({ kind: 'section', name: 'research', spentUsd: 24, allocationUsd: 30 });
    for (const to of ['research-lead', 'boss'])
      appendFileSync(
        join(dir, 'budget-notices.jsonl'),
        `${JSON.stringify({ t: 'owed', key: `warn:section:research:30>${to}`, at: '2026-10-04T00:00:00.000Z', seq: 0, kind: 'section-budget-warning', audience: 'lead', to, subject: w.subject, body: w.body, doc: 'warn:section:research:30', version: 0 })}\n`,
      );
    const again = await startAll(s, { resume: true });
    expect(await budgetNotices(runner, 'research-lead', 1)).toEqual([w.subject]);
    expect(await budgetNotices(runner, 'boss', 1)).toEqual([w.subject]);
    await waitUntil(() => again.sectionBudget!.notices.pending().length === 0);
    await again.sectionBudget!.notices.idle();
    await s.daemon.stopOrg(s.name);
    const third = await startAll(s, { resume: true });
    await third.sectionBudget!.notices.idle();
    await settle();
    expect(runner.budget('research-lead')).toHaveLength(1);
    expect(runner.budget('boss')).toHaveLength(1);
  });

  it('a section closed before the stop is closed again at the resume, with no second notice', async () => {
    const { s, running, runner } = await run();
    await spend(s, running, 'researcher', 22, 22);
    await spend(s, running, 'research-lead', 8, 8);
    await waitUntil(() => running.sectionBudget!.closed.has('section:research'));
    await budgetNotices(runner, 'boss', 1); // 22 is 73 percent, then 30: straight to the closure notice
    await waitUntil(() => running.sectionBudget!.notices.pending().length === 0);
    const before = running.sectionBudget!.notices.records().length;
    await s.daemon.stopOrg(s.name);
    const again = await startAll(s, { resume: true });
    expect(await waitUntil(() => again.sectionBudget!.closed.has('section:research'))).toBe(true);
    await again.sectionBudget!.notices.idle();
    expect(again.sectionBudget!.notices.records()).toHaveLength(before);
    expect(await waitUntil(() => again.agents.get('research-lead')?.mailbox.isClosed === true)).toBe(true);
    expect(create(s, 'researcher').error).toContain('REFUSED: section "research"');
  });
});

describe('inert when there is nothing to enforce', () => {
  it('a sections-on org with no USD budget: no events, no journal, no hold, nothing closed', async () => {
    const { s, running, runner } = await run(() => {}, (p) => {
      const raw = findingsOrg();
      p(raw);
      return raw;
    });
    await spend(s, running, 'researcher', 500, 500);
    await spend(s, running, 'research-lead', 500, 500);
    await settle();
    expect(running.busEvents().filter((e) => /section-budget/.test(e.reason ?? ''))).toEqual([]);
    expect(existsSync(join(running.documents!.dir, 'budget-notices.jsonl'))).toBe(false);
    expect(running.sectionBudget!.closed.size).toBe(0);
    expect(runner.budget('boss')).toEqual([]);
    expect(create(s, 'researcher').error).toBeUndefined();
  });

  it('a sections-off org has no section budget state at all', async () => {
    process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
    process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
    const role = (id: string, extra: object) => ({
      id,
      title: id,
      type: id === 'boss' ? 'boss' : 'specialist',
      reports_to: id === 'boss' ? null : 'boss',
      responsibilities: ['x'],
      ...extra,
    });
    const runner = new RecordingCostRunner();
    const s = newOrgRoot({ name: 'plain', goal: 'g', run_config: { idle_minutes: 0 }, roles: [role('boss', { budget_usd: 5 }), role('a', { budget_usd: 3 })] }, runner);
    started.push(s);
    const running = await s.daemon.startOrg('plain');
    await s.daemon.deliver('plain', 'human', 'a', 'work cost=2', 'work');
    await waitUntil(() => (running.agents.get('a')?.metrics.costUsd ?? 0) >= 2);
    await settle();
    expect(running.sectionBudget).toBeUndefined();
    expect(running.documents).toBeUndefined();
    expect(running.busEvents().filter((e) => /section-budget/.test(e.reason ?? ''))).toEqual([]);
    // the role cap works as it always did
    await s.daemon.deliver('plain', 'human', 'a', 'work cost=2', 'work');
    expect(await waitUntil(() => running.agents.get('a')!.mailbox.isClosed)).toBe(true);
  });
});
