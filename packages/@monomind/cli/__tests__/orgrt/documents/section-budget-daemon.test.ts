// P4.6: section budget notices and soft closure through a real OrgDaemon and a scripted runner that reports a USD
// cost per message (no model). The role cap closes first and unchanged; a section reaches its allocation only
// through a role's overshoot, so the scripts overshoot a cap in one turn the way a real turn can.
// Part 1 (this file): the 80 percent notice (once per crossing, recipients, text), the soft closure of a section
// (mailboxes, held tasks, refused assignments, notices) and its reopening on a reload. Part 2
// (section-budget-daemon-scopes.test.ts): the root reserve, the org ceiling, resume and durability, sections-off.
import { describe, expect, it } from 'vitest';
import { dagCreateTask, dagPlanGraph, dagSplitTask } from '../../../src/orgrt/decisions.js';
import {
  closureNotice,
  warningNotice,
} from '../../../src/orgrt/documents/section-budget-text.js';
import { budgetedOrg } from '../support/section-budget-org.js';
import { waitUntil } from '../support/section-budget-org.js';
import { budgetNotices, eventsOf, harness, settle } from '../support/section-budget-run-org.js';

const { run, spend } = harness();
const reloaded = (edit: (r: Record<string, any>) => void) =>
  budgetedOrg((r) => {
    Object.assign(r.run_config, { max_role_respawns: 2, respawn_start_timeout_ms: 100 });
    edit(r);
  });
const create = (s: any, who: string, assignee: string, title = 'work') =>
  JSON.parse(dagCreateTask(s.daemon, s.name, who, title, assignee, []));

describe('the 80 percent notice', () => {
  it('goes to the section lead and the root once, with the exact text, and the audit event says so', async () => {
    const { s, running, runner } = await run();
    await spend(s, running, 'researcher', 20, 20); // 67 percent of research's 30
    await spend(s, running, 'research-lead', 4, 4); // 24 of 30: 80 percent
    const lead = await budgetNotices(runner, 'research-lead', 1);
    const boss = await budgetNotices(runner, 'boss', 1);
    const w = warningNotice({ kind: 'section', name: 'research', spentUsd: 24, allocationUsd: 30 });
    expect(lead).toEqual([w.subject]);
    expect(boss).toEqual([w.subject]);
    expect(runner.budgetTexts('boss')[0]).toBe(`[message from org-docs] subject: ${w.subject}\n\n${w.body}`);
    expect(runner.budgetTexts('research-lead')[0]).toBe(runner.budgetTexts('boss')[0]);
    // nobody else hears of it
    for (const other of ['researcher', 'dev-lead', 'coder', 'observer']) expect(runner.budget(other), other).toEqual([]);
    const audit = eventsOf(running, 'section-budget-warning');
    expect(audit).toHaveLength(1);
    expect(audit[0].data).toMatchObject({ scope: 'section:research', spentUsd: 24, allocationUsd: 30 });
    // more spend inside the warn band is not another crossing
    await spend(s, running, 'research-lead', 1, 5);
    await settle();
    expect(runner.budget('boss')).toHaveLength(1);
    expect(eventsOf(running, 'section-budget-warning')).toHaveLength(1);
  });

  it("a role's own 80 percent warning also goes to its section lead, except when the lead is the spender", async () => {
    const { s, running, runner } = await run();
    await spend(s, running, 'coder', 17, 17); // 85 percent of its own 20; development is at 57 percent
    await waitUntil(() => (runner.turns.get('dev-lead') ?? []).some((t) => t.includes('"coder" has spent $17.00')));
    expect((runner.turns.get('dev-lead') ?? []).join('\n')).toContain(
      '[budget] "coder" has spent $17.00 of its $20 budget_usd (85%). At the cap its session closes and tasks assigned to it are blocked; its role cap sits inside the section allocation',
    );
    expect((runner.turns.get('boss') ?? []).join('\n')).toContain('[budget] "coder" has spent $17.00 of its $20 budget_usd (85%). At the cap its session closes');
    // the lead spends 85 percent of its own cap: the coordinator hears, the lead is not told of itself
    await spend(s, running, 'dev-lead', 8.5, 8.5);
    await waitUntil(() => (runner.turns.get('boss') ?? []).join('\n').includes('"dev-lead" has spent $8.50'));
    await settle();
    expect((runner.turns.get('dev-lead') ?? []).join('\n')).not.toContain('"dev-lead" has spent');
    // an unsectioned role's warning has no section lead to copy: nobody besides the coordinator
    expect((runner.turns.get('research-lead') ?? []).join('\n')).not.toContain('has spent');
  });

  it('is owed once per crossing: a reload that raises the allocation re-arms it, and a lowered one closes at once', async () => {
    const { s, running, runner } = await run();
    await spend(s, running, 'researcher', 20, 20);
    await spend(s, running, 'research-lead', 4, 4); // 24 of 30
    await budgetNotices(runner, 'boss', 1);
    s.write(reloaded((r) => (r.sections.research.budget = { usd: 40 })));
    s.daemon.reloadOrgDef(s.name);
    await settle();
    expect(eventsOf(running, 'section-budget-warning')).toHaveLength(1); // 24 of 40 is 60 percent: no crossing
    await spend(s, running, 'research-lead', 2, 6); // 26 of 40: 65 percent
    await spend(s, running, 'research-lead', 6, 12); // overshoot its cap of 10 by a turn: 32 of 40 = 80 percent
    const second = await budgetNotices(runner, 'boss', 2);
    expect(second[1]).toBe(warningNotice({ kind: 'section', name: 'research', spentUsd: 32, allocationUsd: 40 }).subject);
    expect(eventsOf(running, 'section-budget-warning')).toHaveLength(2);
    // the allocation is lowered under the spend (the role caps still fit): the section closes at once
    s.write(reloaded((r) => (r.sections.research.budget = { usd: 30 })));
    s.daemon.reloadOrgDef(s.name);
    expect(running.sectionBudget!.closed.has('section:research')).toBe(true);
    expect(running.agents.get('research-lead')!.mailbox.isClosed).toBe(true);
    expect(eventsOf(running, 'section-budget-closed')).toHaveLength(1);
  });
});

describe('the soft closure of a section', () => {
  /** research at its allocation: the researcher overshoots its cap (22 of 20) and the lead spends 8. */
  async function closed() {
    const r = await run();
    const { s, running } = r;
    await spend(s, running, 'researcher', 22, 22);
    // a task the lead is on when the section closes
    const t1 = create(s, 'boss', 'research-lead', 'draft the findings');
    expect(t1.assignee).toBe('research-lead');
    await spend(s, running, 'research-lead', 8, 8);
    expect(await waitUntil(() => running.sectionBudget!.closed.has('section:research'))).toBe(true);
    return { ...r, t1 };
  }

  it('closes the section roles with usd-budget, holds their tasks, says so once, and kills nothing', async () => {
    const { running, runner, t1 } = await closed();
    const lead = running.agents.get('research-lead')!;
    expect(lead.mailbox.isClosed).toBe(true);
    expect(lead.mailbox.closeReason).toBe('usd-budget');
    expect(lead.status).not.toBe('crashed'); // the session finishes its turn: it is not aborted
    // the rest of the org is open
    for (const id of ['boss', 'observer', 'dev-lead', 'coder']) expect(running.agents.get(id)!.mailbox.isClosed, id).toBe(false);
    expect(running.orgBudgetClosed).toBeUndefined();
    // the lead's open task is held with the reason
    const held = running.taskDag!.get(t1.id)!;
    expect(held.status).toBe('blocked');
    expect(held.blockedReason ?? '').toContain('section "research" USD allocation exhausted ($30.00 / $30)');
    // the audit event
    const audit = eventsOf(running, 'section-budget-closed');
    expect(audit).toHaveLength(1);
    expect(audit[0].data).toMatchObject({ scope: 'section:research', spentUsd: 30, allocationUsd: 30, closed: ['research-lead'], held: [t1.id] });
    // the root and the lead are told once, with the text of the pure builder (the lead's is queued to its inbox)
    const text = closureNotice({ kind: 'section', name: 'research', spentUsd: 30, allocationUsd: 30 }, ['research-lead', 'researcher'], [t1.id]);
    const subjects = await budgetNotices(runner, 'boss', 2);
    expect(subjects.at(-1)).toBe(text.subject);
    expect(runner.budgetTexts('boss').at(-1)).toBe(`[message from org-docs] subject: ${text.subject}\n\n${text.body}`);
    const recs = running.sectionBudget!.notices.records().filter((x) => x.kind === 'section-budget-closed');
    expect(recs.map((x) => [x.to, x.state]).sort()).toEqual([['boss', 'delivered'], ['research-lead', 'delivered']]);
    await settle();
    expect(runner.budget('boss').filter((x) => x === text.subject)).toHaveLength(1);
    expect(eventsOf(running, 'section-budget-closed')).toHaveLength(1);
  });

  it('refuses a new task into the closed section (create, plan and split) and still takes one for another section', async () => {
    const { s, running } = await closed();
    const before = running.taskDag!.all().length;
    for (const assignee of ['research-lead', 'researcher']) {
      const err = create(s, 'boss', assignee).error as string;
      expect(err).toContain('REFUSED: section "research" has spent $30.00 of its USD allocation (sections.research.budget.usd), $30.00, and is closed');
      expect(err).toContain(`no new task can be assigned to "${assignee}"`);
    }
    const plan = JSON.parse(dagPlanGraph(s.daemon, s.name, 'boss', [
      { name: 'a', title: 'a', assignee: 'coder' },
      { name: 'b', title: 'b', assignee: 'researcher', after: ['a'] },
    ]));
    expect(plan.error).toContain('spec "b": REFUSED: section "research"');
    expect(running.taskDag!.all()).toHaveLength(before); // nothing of the plan was created
    const ok = create(s, 'boss', 'coder', 'build it');
    expect(ok.error).toBeUndefined();
    const split = JSON.parse(dagSplitTask(s.daemon, s.name, 'boss', ok.id, [{ title: 'x', assignee: 'researcher' }]));
    expect(split.error).toContain('REFUSED: section "research"');
  });

  it('a message to a closed role is queued to its inbox, not delivered live: the role is not woken', async () => {
    const { s, running, runner } = await closed();
    const seen = (runner.turns.get('research-lead') ?? []).length;
    const receipt = await s.daemon.deliver(s.name, 'boss', 'research-lead', 'more', 'please do more');
    expect(receipt).toContain('queued to inbox');
    await settle();
    expect((runner.turns.get('research-lead') ?? []).length).toBe(seen);
    expect(running.agents.get('research-lead')!.mailbox.isClosed).toBe(true);
  });

  it('a reload that raises the allocation reopens it with the spend kept, releases the held task, and takes new tasks again', async () => {
    const { s, running, t1 } = await closed();
    s.write(reloaded((r) => (r.sections.research.budget = { usd: 40 })));
    const res = s.daemon.reloadOrgDef(s.name);
    expect(res.changed).toContain('sections.research.budget');
    expect(running.sectionBudget!.closed.size).toBe(0);
    const lead = running.agents.get('research-lead')!;
    expect(lead.mailbox.isClosed).toBe(false);
    expect(lead.metrics.costUsd).toBe(8); // spend kept
    expect(running.agents.get('researcher')!.mailbox.isClosed).toBe(true); // its own cap still stands: an individual soft stop
    expect(eventsOf(running, 'section-budget-reopened')).toHaveLength(1);
    expect(await waitUntil(() => running.taskDag!.get(t1.id)!.status !== 'blocked')).toBe(true);
    expect(create(s, 'boss', 'research-lead', 'again').error).toBeUndefined();
    // and it closes again, once, if the spend gets there: 8 + 22 = 30 of 40 now, so another 10 does it
    await s.daemon.deliver(s.name, 'human', 'research-lead', 'work cost=10', 'work');
    expect(await waitUntil(() => running.sectionBudget!.closed.has('section:research'))).toBe(true);
    expect(eventsOf(running, 'section-budget-closed')).toHaveLength(2);
  });

  it('a reload that leaves the allocation where it is keeps it closed and re-words the hold', async () => {
    const { s, running, t1 } = await closed();
    s.write(reloaded((r) => (r.goal = 'a new goal')));
    s.daemon.reloadOrgDef(s.name);
    expect(running.sectionBudget!.closed.has('section:research')).toBe(true);
    expect(running.agents.get('research-lead')!.mailbox.isClosed).toBe(true);
    expect(running.taskDag!.get(t1.id)!.status).toBe('blocked');
    expect(eventsOf(running, 'section-budget-reopened')).toEqual([]);
  });

  it('a role replaced while its section is closed is closed again at the next usage event', async () => {
    const { s, running } = await closed();
    const receipt = await s.daemon.respawnRole(s.name, 'boss', { roleId: 'research-lead', reason: 'test', briefing: 'test' });
    expect(receipt.success, receipt.error).toBe(true);
    expect(await waitUntil(() => running.agents.get('research-lead')!.mailbox.isClosed)).toBe(true);
  });
});

describe('the accounting under a replaced incarnation (the swap window counts the old one twice, so a scope is not judged then)', () => {
  it('counts what the replaced incarnation spent: the section closes at the allocation, not later', async () => {
    const { s, running } = await run();
    await spend(s, running, 'coder', 18, 18);
    const receipt = await s.daemon.respawnRole(s.name, 'boss', { roleId: 'coder', reason: 'test', briefing: 'test' });
    expect(receipt.success, receipt.error).toBe(true);
    expect(running.roleSlots.get('coder')!.retiredUsage.costUsd).toBe(18);
    // the replacement has spent 2 itself: the live number alone is 2, the section's is 20
    await spend(s, running, 'coder', 2, 2);
    expect(running.sectionBudget!.closed.size).toBe(0);
    await spend(s, running, 'dev-lead', 9, 9); // 18 + 2 + 9 = 29 of 30
    expect(running.sectionBudget!.closed.size).toBe(0);
    await s.daemon.deliver(s.name, 'human', 'dev-lead', 'work cost=1', 'work');
    expect(await waitUntil(() => running.sectionBudget!.closed.has('section:development'))).toBe(true);
    expect(eventsOf(running, 'section-budget-closed')[0].data).toMatchObject({ scope: 'section:development', spentUsd: 30 });
    // research is untouched
    expect(running.agents.get('research-lead')!.mailbox.isClosed).toBe(false);
  });
});
