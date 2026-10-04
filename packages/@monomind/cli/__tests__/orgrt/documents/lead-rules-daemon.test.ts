// P4.9 (plan 13.2) through a real OrgDaemon and a scripted runner (no model): (1) the org_task / org_plan_graph
// assignee bound as the tool result a role gets, (2) lead-watch telling the SECTION lead of the affected role
// (not reports_to), for an open task and for a message assignment, (3) the capacity preflight at org start, and
// (4) the same roster with no sections keeps the reports_to recipient (the sections-off bytes are also held by the
// P3.0 goldens in sections-off-golden.test.ts). Real timers with fractional-second intervals, like lead-watch.test.ts.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentMessage, AgentRunArgs, AgentRunner, OrgToolDef } from '../../../src/orgrt/agent-runner.js';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import { dagCreateTask } from '../../../src/orgrt/decisions.js';
import { callTool } from '../support/doc-runner.js';
import { sectionsRaw } from '../support/sections-defs.js';

const saved = { ...process.env };
let root: string;
const daemons: OrgDaemon[] = [];

beforeEach(() => {
  process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
  process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
  root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'lead-rules-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
});
afterEach(async () => {
  await Promise.all(daemons.splice(0).map((d) => d.stopAll().catch(() => {})));
  rmSync(root, { recursive: true, force: true });
  for (const k of ['MONOMIND_SPAWN_STAGGER_MS', 'MONOMIND_MIN_FREE_MEM_MB'])
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});

/** Records the tools and every message of each role; every turn ends at once (a role never "reports done"). */
class Recorder implements AgentRunner {
  readonly tools = new Map<string, OrgToolDef[]>();
  readonly turns = new Map<string, string[]>();
  private readonly waiters = new Map<string, () => void>();
  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const role = args.env.MONOMIND_ORG_ROLE;
    this.tools.set(role, args.tools);
    this.waiters.get(role)?.();
    for await (const m of args.prompt as AsyncIterable<{ message: { content: string } }>) {
      this.turns.set(role, [...(this.turns.get(role) ?? []), m.message.content]);
      yield { type: 'assistant', text: 'ok', session_id: 's' } as AgentMessage;
      yield { type: 'result', subtype: 'success', input_tokens: 1, output_tokens: 1, session_id: 's' } as AgentMessage;
    }
  }
  watchTurns(role: string): string[] {
    return (this.turns.get(role) ?? []).filter((t) => t.includes('[watch]'));
  }
  async toolsOf(d: OrgDaemon, org: string, role: string): Promise<OrgToolDef[]> {
    if (!this.tools.has(role)) {
      const seen = new Promise<void>((r) => this.waiters.set(role, r));
      await d.deliver(org, 'human', role, 'hello', 'hello');
      await Promise.race([seen, new Promise((_, rej) => setTimeout(() => rej(new Error(`${role} never started`)), 5000))]);
    }
    return this.tools.get(role) as OrgToolDef[];
  }
}

/** boss; research (lead research-lead; members researcher, scout: scout reports to the boss, not its lead);
 *  development (lead dev-lead; member coder). */
function org(patch: (raw: Record<string, any>) => void = () => {}, lw?: Record<string, number>): Record<string, any> {
  return sectionsRaw((raw) => {
    raw.run_config.max_concurrent_agents = 20;
    if (lw) raw.run_config.lead_watch = lw;
    raw.sections.research.members.push('scout');
    raw.roles.push({ id: 'scout', title: 'scout', type: 'specialist', reports_to: 'boss', responsibilities: ['look around'], policy: { sandbox: { mode: 'off' } } });
    patch(raw);
  });
}

async function start(raw: Record<string, any>) {
  writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
  const runner = new Recorder();
  const d = new OrgDaemon(root, { runner, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
  daemons.push(d);
  const running = await d.startOrg(raw.name, undefined, { evalGate: true });
  const notices = () => running.busEvents().filter((e) => e.reason === 'lead-watch');
  return { d, running, runner, notices, name: raw.name as string };
}

const waitFor = async (cond: () => boolean, ms = 6000): Promise<boolean> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return cond();
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('the org_task assignee bound, as a tool result in a live org', () => {
  it('a member cannot assign across sections, can inside its own, and the root can reach any section', async () => {
    const t = await start(org());
    const researcher = await t.runner.toolsOf(t.d, t.name, 'researcher');
    const lead = await t.runner.toolsOf(t.d, t.name, 'research-lead');
    const boss = await t.runner.toolsOf(t.d, t.name, 'boss');
    const tasks = () => t.running.taskDag?.all().map((x) => `${x.createdBy}>${x.assignee}`) ?? [];

    const cross = await callTool(researcher, 'org_task', { title: 'build it', assignee: 'coder' });
    expect(cross.error).toBe(
      'REFUSED: researcher (section research) cannot assign a task to coder (section development). Sections hand work over through documents: publish it with org_doc_publish, or raise it with the root, who can assign to any section.',
    );
    expect(tasks()).toEqual([]);
    expect((await callTool(lead, 'org_task', { title: 'build it', assignee: 'dev-lead' })).error).toMatch(/^REFUSED: research-lead \(section research\) cannot assign a task to dev-lead/);

    expect((await callTool(lead, 'org_task', { title: 'look', assignee: 'researcher' })).error).toBeUndefined(); // lead to member
    expect((await callTool(researcher, 'org_task', { title: 'help', assignee: 'scout' })).error).toBeUndefined(); // member to member
    expect((await callTool(boss, 'org_task', { title: 'build', assignee: 'coder' })).error).toBeUndefined(); // the root
    expect((await callTool(researcher, 'org_task', { title: 'report', assignee: 'boss' })).error).toBeUndefined(); // to the root
    expect(tasks()).toEqual(['research-lead>researcher', 'researcher>scout', 'boss>coder', 'researcher>boss']);
  }, 30_000);

  it('org_plan_graph: one cross-section assignee refuses the whole graph and creates nothing', async () => {
    const t = await start(org());
    const lead = await t.runner.toolsOf(t.d, t.name, 'research-lead');
    const bad = await callTool(lead, 'org_plan_graph', {
      tasks: [
        { name: 'a', title: 'own work', assignee: 'researcher' },
        { name: 'b', title: 'theirs', assignee: 'coder', after: ['a'] },
      ],
    });
    expect(bad.error).toMatch(/^REFUSED: research-lead \(section research\) cannot assign a task to coder \(section development\)/);
    expect(t.running.taskDag?.all() ?? []).toHaveLength(0);
    const good = await callTool(lead, 'org_plan_graph', {
      tasks: [
        { name: 'a', title: 'own work', assignee: 'researcher' },
        { name: 'b', title: 'more', assignee: 'scout', after: ['a'] },
      ],
    });
    expect(good.error).toBeUndefined();
    expect(t.running.taskDag?.all()).toHaveLength(2);
  }, 30_000);

  it('a sections-off org has no bound: the same roster assigns across the former sections', async () => {
    const plain = org((raw) => {
      delete raw.sections;
      delete raw.documents;
      delete raw.requires;
      raw.run_config = { idle_minutes: 0, max_concurrent_agents: 20 };
    });
    const t = await start(plain);
    const researcher = await t.runner.toolsOf(t.d, t.name, 'researcher');
    expect((await callTool(researcher, 'org_task', { title: 'build it', assignee: 'coder' })).error).toBeUndefined();
    expect(t.running.taskDag?.all().map((x) => x.assignee)).toEqual(['coder']);
  }, 30_000);
});

describe('lead-watch tells the section lead of the affected role', () => {
  const told = (n: { msg?: string }) => /told "([^"]+)"/.exec(n.msg ?? '')?.[1];

  it('a silent member with an open task: the section lead is told, not its reports_to (the boss)', async () => {
    const t = await start(org(() => {}, { not_started_s: 60, silent_s: 0.4 }));
    await t.runner.toolsOf(t.d, t.name, 'research-lead');
    await t.runner.toolsOf(t.d, t.name, 'scout'); // reports_to: boss, section lead: research-lead
    dagCreateTask(t.d, t.name, 'boss', 'long job', 'scout', []);
    expect(await waitFor(() => t.notices().length >= 1)).toBe(true);
    expect(t.notices()[0].data).toMatchObject({ role: 'scout', kind: 'silent' });
    expect(told(t.notices()[0])).toBe('research-lead');
    expect(await waitFor(() => t.runner.watchTurns('research-lead').length >= 1)).toBe(true);
    expect(t.runner.watchTurns('research-lead')[0]).toMatch(/Role "scout"/);
    expect(t.runner.watchTurns('boss')).toEqual([]);
  }, 30_000);

  it('a message assignment from the section lead is tracked as work, and the silence reaches the section lead', async () => {
    const t = await start(org(() => {}, { not_started_s: 60, silent_s: 0.4 }));
    await t.runner.toolsOf(t.d, t.name, 'research-lead');
    await t.d.deliver(t.name, 'research-lead', 'scout', 'Assignment: m5-m8', 'Answer modules m5 to m8 from the code in corpus/ and publish when done.');
    expect(await waitFor(() => t.notices().length >= 1)).toBe(true);
    expect(t.notices()[0].data).toMatchObject({ role: 'scout', kind: 'silent' });
    expect(told(t.notices()[0])).toBe('research-lead');
  }, 30_000);

  it('the same roster without sections keeps the reports_to recipient: the boss is told', async () => {
    const plain = org((raw) => {
      delete raw.sections;
      delete raw.documents;
      delete raw.requires;
      raw.run_config = { idle_minutes: 0, max_concurrent_agents: 20, lead_watch: { not_started_s: 60, silent_s: 0.4 } };
    });
    const t = await start(plain);
    await t.runner.toolsOf(t.d, t.name, 'research-lead');
    await t.runner.toolsOf(t.d, t.name, 'scout');
    dagCreateTask(t.d, t.name, 'boss', 'long job', 'scout', []);
    expect(await waitFor(() => t.notices().length >= 1)).toBe(true);
    expect(told(t.notices()[0])).toBe('boss');
    await sleep(100);
    expect(t.runner.watchTurns('research-lead')).toEqual([]);
  }, 30_000);
});

describe('the capacity preflight at org start', () => {
  it('a sections org with the default cap of 4 and five roles is refused, naming the remedy; a cap of 6 starts it', async () => {
    const raw = org((r) => delete r.run_config.max_concurrent_agents);
    writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
    const d = new OrgDaemon(root, { runner: new Recorder(), forward: false, stopWaitMs: 100 });
    daemons.push(d);
    await expect(d.startOrg(raw.name, undefined, { evalGate: true })).rejects.toThrow(
      /run_config\.max_concurrent_agents: 4 is below the 6 agent roles.*raise it to at least 6/,
    );
    const ok = await start(org((r) => (r.run_config.max_concurrent_agents = 6)));
    expect(ok.running.documents).toBeDefined();
  }, 30_000);
});
