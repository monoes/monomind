// P4.12 scenario B: section budgets end to end in the real daemon. A scripted runner reports a USD cost per message
// (`cost=<usd>`), so usage events drive everything with no model. development 30 (dev-lead 10, coder 20), qa 20
// (qa-lead 20), watch 20 (observer 20), root reserve 30 (boss 30), org 110 after the raise. What is proved: the allocations are
// resolved at start; a role's own 80 percent warning also reaches its section lead; a section's 80 percent notice goes
// to its lead and the root once; the role cap closes first and unchanged; a scripted overshoot closes the section (no
// new assignment into it, its tasks held, its roles not woken); a reload that raises the allocation reopens it with the
// spend kept; a replaced incarnation is counted once; the org allocation closes every role; documents keep flowing.
import { describe, expect, it } from 'vitest';
import { dagCreateTask } from '../../../../src/orgrt/decisions.js';
import { closureNotice, warningNotice } from '../../../../src/orgrt/documents/section-budget-text.js';
import { liveSectionBudgetStatus, sectionBudgetLines } from '../../../../src/orgrt/documents/section-budget-report.js';
import { KEY_SETS, phase4Org } from '../../support/phase4-guidance-defs.js';
import { CostScripted, publish, settle, spend, useWorld, waitFor } from './world.js';

const world = useWorld('p4-budget');
const ALL = ['boss', 'dev-lead', 'coder', 'qa-lead', 'observer'];
const CAPS: Record<string, number> = { boss: 30, 'dev-lead': 10, coder: 20, 'qa-lead': 20, observer: 20 };
type Raw = Record<string, any>;

/** The budget org (sections dev 30, qa 20 and watch 20, reserve 30, org 100); `edit` and a respawn setup are applied. */
const org = (edit: (r: Raw) => void = () => {}): Raw => {
  const raw = phase4Org(KEY_SETS.budget);
  raw.name = 'budget-e2e';
  Object.assign(raw.run_config, { max_role_respawns: 2, respawn_start_timeout_ms: 100 });
  edit(raw);
  return raw;
};
/** development raised to 40: the root reserve must still hold boss, so the org budget goes up too. */
const raised = (r: Raw) => {
  r.sections.development.budget = { usd: 40 };
  r.run_config.budget_usd = 110;
};
const events = (running: any, reason: string): any[] => running.busEvents().filter((e: any) => e.reason === reason);
const create = (s: any, who: string, assignee: string, title = 'work') => JSON.parse(dagCreateTask(s.d, s.name, who, title, assignee, []));

async function setup(edit: (r: Raw) => void = () => {}) {
  const runner = new CostScripted();
  const s = await world.start(org(edit), { runner });
  const tools: Record<string, any> = {};
  for (const r of ALL) tools[r] = await runner.toolsOf(s.d, s.name, r);
  const go = (role: string, usd: number, total: number) => spend(s.d, s.name, s.running, role, usd, total);
  return { ...s, s, runner, tools, go };
}

describe('allocations resolved at start', () => {
  it('every role runs with its own cap, the table shows the partition, nobody is closed', async () => {
    const { running } = await setup();
    for (const id of ALL) expect(running.agents.get(id)!.policy.policy.maxUsd, id).toBe(CAPS[id]);
    const status = liveSectionBudgetStatus(running)!;
    expect(status.sections.map((x: any) => [x.name, x.allocationUsd, x.roleCapSumUsd])).toEqual([
      ['development', 30, 30],
      ['qa', 20, 20],
      ['watch', 20, 20],
    ]);
    expect([status.reserve.allocationUsd, status.reserve.roleCapSumUsd, status.org.allocationUsd]).toEqual([30, 30, 100]);
    const table = sectionBudgetLines(status).join('\n');
    expect(table).toContain('Section budgets (USD; individual soft stops):');
    expect(table).toContain('section development: spent $0.0000 of $30.00');
    expect(running.sectionBudget!.closed.size).toBe(0);
    for (const id of ALL) expect(running.agents.get(id)!.mailbox.isClosed, id).toBe(false);
  });
});

describe('notices, the role cap, a section overshoot and a reload that reopens it', () => {
  it('the section lead and the root are told once at 80 percent; the role cap closes first; the allocation closes the section; a raise reopens it', async () => {
    const { s, running, runner, go } = await setup();

    // coder spends 17 of its own 20: its own warning goes to the coordinator and, new in Phase 4, to its section lead
    await go('coder', 17, 17);
    expect(await waitFor(() => runner.texts('dev-lead').some((t) => t.includes('"coder" has spent $17.00 of its $20 budget_usd (85%)')))).toBe(true);
    expect(runner.texts('boss').some((t) => t.includes('"coder" has spent $17.00'))).toBe(true);
    expect(runner.texts('qa-lead').join('\n')).not.toContain('has spent');

    // the lead's 7 brings the section to 24 of 30, 80 percent: ONE notice to the lead and the root, nobody else
    const heldTask = create(s, 'boss', 'dev-lead', 'draft the build notes');
    expect(heldTask.assignee).toBe('dev-lead');
    await go('dev-lead', 7, 7);
    const warn = warningNotice({ kind: 'section', name: 'development', spentUsd: 24, allocationUsd: 30 });
    expect(await waitFor(() => runner.count('dev-lead', 'budget: section "development" at') === 1 && runner.count('boss', 'budget: section "development" at') === 1)).toBe(true);
    expect(runner.count('dev-lead', 'budget: section "development" at')).toBe(1);
    expect(runner.textsOf('boss', 'budget: section')[0]).toBe(`[message from org-docs] subject: ${warn.subject}\n\n${warn.body}`);
    for (const id of ['coder', 'qa-lead', 'observer']) expect(runner.count(id, 'budget: section'), id).toBe(0);
    expect(events(running, 'section-budget-warning')).toHaveLength(1);

    // the role cap closes first and unchanged: coder passes its own 20 (22) while the section is at 29 of 30
    await go('coder', 5, 22);
    expect(await waitFor(() => running.agents.get('coder')!.mailbox.isClosed)).toBe(true);
    expect(running.agents.get('coder')!.mailbox.closeReason).toBe('usd-budget');
    expect(running.sectionBudget!.closed.size).toBe(0);
    expect(running.agents.get('dev-lead')!.mailbox.isClosed).toBe(false);
    expect(runner.count('boss', 'budget: section "development" at')).toBe(1); // more spend in the band is not another crossing

    // one more dollar from the lead takes the section to its allocation: it closes
    await go('dev-lead', 1, 8);
    expect(await waitFor(() => running.sectionBudget!.closed.has('section:development'))).toBe(true);
    const lead = running.agents.get('dev-lead')!;
    expect(lead.mailbox.isClosed).toBe(true);
    expect(lead.mailbox.closeReason).toBe('usd-budget');
    for (const id of ['boss', 'qa-lead', 'observer']) expect(running.agents.get(id)!.mailbox.isClosed, id).toBe(false);
    const closed = events(running, 'section-budget-closed');
    expect(closed).toHaveLength(1);
    expect(closed[0].data).toMatchObject({ scope: 'section:development', spentUsd: 30, allocationUsd: 30, held: [heldTask.id] });
    expect(running.taskDag!.get(heldTask.id)!.status).toBe('blocked');
    const text = closureNotice({ kind: 'section', name: 'development', spentUsd: 30, allocationUsd: 30 }, closed[0].data.closed, [heldTask.id]);
    expect(await waitFor(() => runner.count('boss', text.subject) === 1)).toBe(true);

    // no new assignment into the closed section, none for the roles of another; its roles are not woken
    for (const assignee of ['dev-lead', 'coder']) expect(create(s, 'boss', assignee).error, assignee).toContain('REFUSED: section "development" has spent $30.00');
    expect(create(s, 'boss', 'qa-lead').error).toBeUndefined();
    const woken = runner.texts('dev-lead').length;
    expect(await s.d.deliver(s.name, 'boss', 'dev-lead', 'more', 'please do more')).toContain('queued to inbox');
    await settle();
    expect(runner.texts('dev-lead')).toHaveLength(woken);

    // a reload that raises the allocation reopens the lead with its spend kept; the coder is over its own cap and stays closed
    world.write(org(raised));
    expect(s.d.reloadOrgDef(s.name).changed).toEqual(expect.arrayContaining(['sections.development.budget', 'run_config.budget_usd']));
    expect(running.sectionBudget!.closed.size).toBe(0);
    expect(running.agents.get('dev-lead')!.mailbox.isClosed).toBe(false);
    expect(running.agents.get('dev-lead')!.metrics.costUsd).toBe(8);
    expect(running.agents.get('coder')!.mailbox.isClosed).toBe(true);
    expect(events(running, 'section-budget-reopened')).toHaveLength(1);
    expect(await waitFor(() => running.taskDag!.get(heldTask.id)!.status !== 'blocked')).toBe(true);
    expect(create(s, 'boss', 'dev-lead', 'again').error).toBeUndefined();
    expect(runner.errors).toEqual([]);
  });

  it('a replaced incarnation is counted once: the section closes at its allocation, not later', async () => {
    const { s, running, go } = await setup();
    await go('coder', 18, 18);
    const receipt = await s.d.respawnRole(s.name, 'boss', { roleId: 'coder', reason: 'test', briefing: 'test' });
    expect(receipt.success, receipt.error).toBe(true);
    expect(running.roleSlots.get('coder')!.retiredUsage.costUsd).toBe(18);
    await go('coder', 2, 2); // this incarnation alone shows 2, the section's number is 20
    expect(running.sectionBudget!.closed.size).toBe(0);
    await go('dev-lead', 9, 9); // 29 of 30
    expect(running.sectionBudget!.closed.size).toBe(0);
    const table = sectionBudgetLines(liveSectionBudgetStatus(running)!).join('\n');
    expect(table).toContain('section development: spent $29.0000 of $30.00');
    expect(table).toContain('of which replaced incarnations $18.0000');
    await go('dev-lead', 1, 10);
    expect(await waitFor(() => running.sectionBudget!.closed.has('section:development'))).toBe(true);
    expect(events(running, 'section-budget-closed')[0].data).toMatchObject({ scope: 'section:development', spentUsd: 30 });
    expect(running.agents.get('qa-lead')!.mailbox.isClosed).toBe(false);
  });
});

describe('a closed section and the documents addressed to it', () => {
  it('qa closed at its allocation is not woken by a document for it; the notice waits in its inbox and a restart delivers it once', async () => {
    const { s, running, runner, tools, go, docs } = await setup();
    await go('qa-lead', 21, 21); // over its own cap of 20 and over qa's allocation of 20
    expect(await waitFor(() => running.sectionBudget!.closed.has('section:qa'))).toBe(true);
    expect(running.agents.get('qa-lead')!.mailbox.isClosed).toBe(true);
    const seen = runner.texts('qa-lead').length;
    // development is open: it publishes a build for qa; the runtime tries to tell the consumer
    expect(await publish(tools.coder, 'build', 'a build for qa')).toMatchObject({ ok: true, ref: 'build-1@v1' });
    await docs.notices!.idle();
    await settle();
    expect(runner.texts('qa-lead')).toHaveLength(seen); // the closed role is not woken
    expect(running.busEvents().some((e: any) => e.type === 'audit' && /queued to inbox: document ready: build-1 v1/.test(e.msg ?? ''))).toBe(true);
    await s.d.stopOrg(s.name);

    // a restart drains the inbox: the notice reaches the lead exactly once (the journal had it delivered, so the engine does not send it again)
    const again = new CostScripted();
    const second = await world.start(org(raised), { runner: again, resume: true });
    for (const r of ALL) await again.toolsOf(second.d, second.name, r);
    expect(await waitFor(() => again.count('qa-lead', 'document ready: build-1 v1') === 1)).toBe(true);
    await second.docs.notices!.idle();
    await settle();
    expect(again.count('qa-lead', 'document ready: build-1 v1')).toBe(1);
  });
});

describe('the org allocation', () => {
  /** No section allocations: run_config.budget_usd 40 is the org ceiling, every role capped at 10. */
  const orgOnly = (r: Raw) => {
    delete r.sections.development.budget;
    delete r.sections.qa.budget;
    delete r.sections.watch.budget;
    r.run_config.budget_usd = 40;
    for (const role of r.roles) role.budget_usd = 10;
  };

  it('80 percent tells the root and every section lead once; at the ceiling every role is closed softly, new tasks are refused anywhere, a raise reopens', async () => {
    const { s, running, runner, go } = await setup(orgOnly);
    await go('coder', 11, 11); // over its 10: closes on its own
    await go('qa-lead', 9, 9);
    await go('boss', 9, 9);
    await go('observer', 3, 3); // 32 of 40 (observer leads section `watch`: told like the other leads)
    const warn = warningNotice({ kind: 'org', spentUsd: 32, allocationUsd: 40 });
    expect(await waitFor(() => ['boss', 'dev-lead', 'qa-lead', 'observer'].every((r) => runner.count(r, warn.subject) === 1))).toBe(true);
    expect(runner.count('coder', 'budget: the org at')).toBe(0);

    await go('dev-lead', 8, 8); // 40: the ceiling
    expect(await waitFor(() => running.sectionBudget!.closed.has('org'))).toBe(true);
    for (const id of ALL) expect(running.agents.get(id)!.mailbox.isClosed, id).toBe(true);
    expect(running.agents.get('observer')!.mailbox.closeReason).toBe('usd-budget');
    const status = running.busEvents().filter((e: any) => e.type === 'status' && e.reason === 'org-budget-exhausted');
    expect(status).toHaveLength(1);
    expect(status[0].msg).toContain('the org USD allocation exhausted ($40.00/$40.00) — the root is closed');
    for (const who of ['coder', 'qa-lead', 'boss']) expect(create(s, who, 'observer').error, who).toContain('REFUSED: the org has spent $40.00 of its run_config.budget_usd');

    world.write(org((r) => (orgOnly(r), (r.run_config.budget_usd = 60))));
    s.d.reloadOrgDef(s.name);
    expect(running.sectionBudget!.closed.size).toBe(0);
    for (const id of ['boss', 'dev-lead', 'qa-lead', 'observer']) expect(running.agents.get(id)!.mailbox.isClosed, id).toBe(false); // under their own caps: reopened, spend kept
    expect(running.agents.get('dev-lead')!.metrics.costUsd).toBe(8);
    expect(running.agents.get('coder')!.mailbox.isClosed).toBe(true); // over its own cap: an individual soft stop
    expect(create(s, 'qa-lead', 'observer').error).toBeUndefined();
    expect(events(running, 'section-budget-reopened')).toHaveLength(1);
  });
});
