// P4.12 scenario E: lead rights and duties end to end in the real daemon (no model). The org is the dev and QA org with an
// observer and a `scout` of development who reports to the root (not to its section lead dev-lead). What is proved: the
// capacity preflight refuses a roster above max_concurrent_agents at start; an org_task or org_plan_graph that crosses
// sections is refused as the tool result the role gets, with the text; the corrected org_send refusal no longer promises a
// lead-to-lead path; lead-watch and the budget, rework and unread notices go to the section lead (or the root), not to
// reports_to; the same roster without sections keeps the reports_to recipient.
import { describe, expect, it } from 'vitest';
import { crossSectionRefusalText } from '../../../../src/orgrt/documents/routing.js';
import { OrgDefSchema } from '../../../../src/orgrt/types.js';
import { dagCreateTask } from '../../../../src/orgrt/decisions.js';
import { checklistFindings } from '../../../../src/orgrt/validate-checklist.js';
import { KEY_SETS, phase4Org } from '../../support/phase4-guidance-defs.js';
import { role } from '../../support/doc-defs.js';
import { CostScripted, call, publish, review, settle, useWorld, waitFor } from './world.js';

const world = useWorld('p4-lead');
type Raw = Record<string, any>;
const ALL = ['boss', 'dev-lead', 'coder', 'qa-lead', 'observer', 'scout'];

/** The no-key dev and QA org plus `scout`: a member of development whose reports_to is the root. */
const org = (edit: (r: Raw) => void = () => {}): Raw => {
  const raw = phase4Org(KEY_SETS.none);
  raw.name = 'lead-e2e';
  raw.roles.push(role('scout', 'boss'));
  raw.sections.development.members.push('scout');
  raw.run_config.max_concurrent_agents = 20;
  edit(raw);
  return raw;
};
const plain = (raw: Raw): void => {
  for (const k of ['sections', 'documents', 'requires']) delete raw[k];
  delete raw.run_config.experimental;
  delete raw.run_config.completion;
};
const told = (e: { msg?: string }) => /told "([^"]+)"/.exec(e.msg ?? '')?.[1];
const watchEvents = (running: any): any[] => running.busEvents().filter((e: any) => e.reason === 'lead-watch');

async function setup(raw: Raw, roles = ALL, evalGate?: boolean) {
  const runner = new CostScripted();
  const s = await world.start(raw, { runner, evalGate });
  const tools: Record<string, any> = {};
  for (const r of roles) tools[r] = await runner.toolsOf(s.d, s.name, r);
  return { ...s, runner, tools };
}

describe('the capacity preflight', () => {
  it('a sections org whose max_concurrent_agents is below its roster is refused at start, naming the remedy; the right cap starts it', async () => {
    await expect(world.start(org((r) => delete r.run_config.max_concurrent_agents))).rejects.toThrow(
      /run_config\.max_concurrent_agents: 4 is below the 6 agent roles.*raise it to at least 6/,
    );
    const ok = await world.start(org((r) => (r.run_config.max_concurrent_agents = 6)));
    expect(ok.running.documents).toBeDefined();
  });

  it('a member that does not report to its section lead is a validate warning, not an error', () => {
    const f = checklistFindings(OrgDefSchema.parse(org()));
    expect(f.errors).toEqual([]);
    expect(f.warnings.join('\n')).toContain('roles.scout.reports_to: "scout" is in section "development" but reports to "boss", not its section lead "dev-lead"');
  });
});

describe('the assignment and message bounds, as the tool results a role gets', () => {
  it('org_task and org_plan_graph across sections are refused with the text; inside a section, to the root and from the root they go through', async () => {
    const { running, tools } = await setup(org());
    const made = () => running.taskDag?.all().map((x: any) => `${x.createdBy}>${x.assignee}`) ?? [];
    const cross = await call(tools.coder, 'org_task', { title: 'review it', assignee: 'qa-lead' });
    expect(cross.error).toBe(
      'REFUSED: coder (section development) cannot assign a task to qa-lead (section qa). Sections hand work over through documents: publish it with org_doc_publish, or raise it with the root, who can assign to any section.',
    );
    expect((await call(tools['dev-lead'], 'org_task', { title: 'review it', assignee: 'qa-lead' })).error).toMatch(/^REFUSED: dev-lead \(section development\) cannot assign a task to qa-lead/);
    expect(made()).toEqual([]);

    const bad = await call(tools['dev-lead'], 'org_plan_graph', {
      tasks: [
        { name: 'a', title: 'own work', assignee: 'coder' },
        { name: 'b', title: 'theirs', assignee: 'qa-lead', after: ['a'] },
      ],
    });
    expect(bad.error).toMatch(/^REFUSED: dev-lead \(section development\) cannot assign a task to qa-lead \(section qa\)/);
    expect(made()).toEqual([]); // the whole graph is refused: nothing of it exists

    expect((await call(tools['dev-lead'], 'org_task', { title: 'build', assignee: 'coder' })).error).toBeUndefined(); // lead to member
    expect((await call(tools.coder, 'org_task', { title: 'help', assignee: 'scout' })).error).toBeUndefined(); // member to member
    expect((await call(tools.boss, 'org_task', { title: 'check', assignee: 'qa-lead' })).error).toBeUndefined(); // the root reaches any section
    expect((await call(tools.coder, 'org_task', { title: 'report', assignee: 'boss' })).error).toBeUndefined(); // anyone reaches the root
    expect(made()).toEqual(['dev-lead>coder', 'coder>scout', 'boss>qa-lead', 'coder>boss']);
  });

  it('the cross-section org_send refusal no longer promises a lead-to-lead path: it points at documents and the root', async () => {
    const { d, name } = await setup(org());
    const text = crossSectionRefusalText('coder', 'development', 'qa-lead', 'qa');
    expect(text).toBe(
      'REFUSED: coder (section development) cannot message qa-lead (section qa). Sections hand work over through documents: publish it with org_doc_publish, or raise it with the root, who can reach any section.',
    );
    expect(text).not.toContain('other lead');
    expect(await d.deliver(name, 'coder', 'qa-lead', 's', 'hello across')).toBe(text);
    expect(await d.deliver(name, 'dev-lead', 'qa-lead', 's', 'lead to lead')).toMatch(/^REFUSED: dev-lead \(section development\) cannot message qa-lead/);
    expect(await d.deliver(name, 'coder', 'boss', 's', 'to the root')).toBe('delivered to boss');
    expect(await d.deliver(name, 'boss', 'qa-lead', 's', 'the root reaches any section')).toBe('delivered to qa-lead');
  });
});

describe('who is told: the section lead or the root, not reports_to', () => {
  const lw = (r: Raw) => (r.run_config.lead_watch = { not_started_s: 60, silent_s: 0.4, unread_s: 0.4 });

  it('lead-watch: a silent member with an open task, and a message assignment from its lead, tell the SECTION lead', async () => {
    const { d, name, running, runner } = await setup(org(lw), ['dev-lead', 'scout', 'coder']);
    dagCreateTask(d, name, 'boss', 'long job', 'scout', []); // scout reports to boss; its section lead is dev-lead
    expect(await waitFor(() => watchEvents(running).some((e) => e.data?.role === 'scout'))).toBe(true);
    const n = watchEvents(running).find((e) => e.data?.role === 'scout');
    expect(n.data).toMatchObject({ role: 'scout', kind: 'silent' });
    expect(told(n)).toBe('dev-lead');
    expect(await waitFor(() => runner.texts('dev-lead').some((t) => t.includes('[watch]') && /Role "scout"/.test(t)))).toBe(true);
    expect(runner.texts('boss').filter((t) => t.includes('[watch]'))).toEqual([]);

    await d.deliver(name, 'dev-lead', 'coder', 'Assignment: modules m1-m4', 'Answer modules m1 to m4 and publish when done.');
    expect(await waitFor(() => watchEvents(running).some((e) => e.data?.role === 'coder'))).toBe(true);
    expect(told(watchEvents(running).find((e) => e.data?.role === 'coder'))).toBe('dev-lead');
  });

  it('the same roster without sections keeps the reports_to recipient: the root is told, the lead is not', async () => {
    const { d, name, running, runner } = await setup(org((r) => (plain(r), (r.run_config.lead_watch = { not_started_s: 60, silent_s: 0.4 }))), ['dev-lead', 'scout'], false);
    dagCreateTask(d, name, 'boss', 'long job', 'scout', []);
    expect(await waitFor(() => watchEvents(running).length >= 1)).toBe(true);
    expect(told(watchEvents(running)[0])).toBe('boss');
    await settle();
    expect(runner.texts('dev-lead').filter((t) => t.includes('[watch]'))).toEqual([]);
  });

  it('a document nobody reads: the unread watch tells a lead, and the notices of a spent rework cap reach the root and both leads', async () => {
    const raw = org((r) => {
      lw(r);
      r.sections.qa.max_rework_rounds = 2;
    });
    const { running, runner, tools, docs } = await setup(raw, ['boss', 'dev-lead', 'coder', 'qa-lead']);
    await publish(tools.coder, 'build', 'a build nobody reads');
    expect(await waitFor(() => running.busEvents().some((e: any) => e.reason === 'doc-unread'))).toBe(true);
    const unread = running.busEvents().find((e: any) => e.reason === 'doc-unread');
    expect(unread.data).toMatchObject({ key: expect.stringContaining('build-1@v1'), cause: 'not-read' });
    expect(unread.msg).toMatch(/^told "boss": document build-1 v1 unread by qa-lead/); // the consuming lead is the one not reading: the root hears
    // the consumer then rejects twice: the cap of 2 is spent, the root and BOTH leads (not the producer) hear of it
    await review(tools['qa-lead'], 'build-1', 1, 'reject');
    await publish(tools.coder, 'build', 'again', { supersedes: 'build-1@v1' });
    await review(tools['qa-lead'], 'build-1', 2, 'reject');
    expect(await waitFor(() => ['boss', 'dev-lead', 'qa-lead'].every((r) => runner.count(r, 'rework exhausted') === 1))).toBe(true);
    expect(runner.count('coder', 'rework exhausted')).toBe(0);
    await docs.notices!.idle();
  });
});
