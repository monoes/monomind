// P4.7 acceptance through a real OrgDaemon, a real store, the real deliver path and real mailboxes, with a scripted
// runner (no model): a producer, a consuming lead and the root. The consumer rejects until the cap, the root and
// both leads get exactly one notice, the producer is told to wait and cannot republish, the root decides; a reload
// that raises the cap thaws the thread; a stop and a resume re-send an undelivered notice once and a seen one never.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentMessage, AgentRunArgs, AgentRunner, OrgToolDef } from '../../../src/orgrt/agent-runner.js';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import { FINDINGS, SOURCE, findingsOrg } from '../support/doc-defs.js';
import { callTool, readAllParts } from '../support/doc-runner.js';

const saved = { ...process.env };
let root: string;
const daemons: OrgDaemon[] = [];

beforeEach(() => {
  process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
  process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
  root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'rework-daemon-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
});
afterEach(async () => {
  await Promise.all(daemons.splice(0).map((d) => d.stopAll().catch(() => {})));
  rmSync(root, { recursive: true, force: true });
  for (const k of ['MONOMIND_SPAWN_STAGGER_MS', 'MONOMIND_MIN_FREE_MEM_MB'])
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});

type Reaction = (text: string, tools: OrgToolDef[]) => Promise<void>;

/** Every role records the text of each message it is woken with and answers with an empty turn, after the reaction
 *  scripted for its role (what a model woken by that message would do). */
class ScriptRunner implements AgentRunner {
  readonly tools = new Map<string, OrgToolDef[]>();
  readonly turns = new Map<string, string[]>();
  readonly on = new Map<string, Reaction>();
  private readonly waiters = new Map<string, () => void>();
  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const role = args.env.MONOMIND_ORG_ROLE;
    this.tools.set(role, args.tools);
    this.waiters.get(role)?.();
    for await (const m of args.prompt as AsyncIterable<{ message: { content: string } }>) {
      const text = m.message.content;
      this.turns.set(role, [...(this.turns.get(role) ?? []), text]);
      await this.on.get(role)?.(text, args.tools);
      yield { type: 'assistant', text: 'ok', session_id: 's' } as AgentMessage;
      yield { type: 'result', subtype: 'success', input_tokens: 1, output_tokens: 1, session_id: 's' } as AgentMessage;
    }
  }
  subjects(role: string): string[] {
    return (this.turns.get(role) ?? []).map((t) => /subject: (.*)/.exec(t)?.[1] ?? t.slice(0, 30));
  }
  count(role: string, prefix: string): number {
    return this.subjects(role).filter((s) => s.startsWith(prefix)).length;
  }
  async toolsOf(d: OrgDaemon, org: string, role: string): Promise<OrgToolDef[]> {
    if (!this.tools.has(role)) {
      const seen = new Promise<void>((r) => this.waiters.set(role, r));
      await d.deliver(org, 'human', role, 'brief', 'brief');
      await Promise.race([seen, new Promise((_, rej) => setTimeout(() => rej(new Error(`${role} never started`)), 5000))]);
    }
    return this.tools.get(role) as OrgToolDef[];
  }
}

const write = (raw: Record<string, any>) => writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
async function start(raw: Record<string, any>, runner = new ScriptRunner(), resume = false) {
  write(raw);
  const d = new OrgDaemon(root, { runner, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
  daemons.push(d);
  const running = await d.startOrg(raw.name, undefined, { evalGate: true, ...(resume ? { resume: true } : {}) });
  return { d, running, runner, docs: running.documents!, name: raw.name as string };
}
const waitFor = async (cond: () => boolean, ms = 4000): Promise<boolean> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return cond();
};
const capped = (cap: number) => {
  const raw = findingsOrg();
  raw.sections.development.max_rework_rounds = cap;
  return raw;
};
const head = (docs: { store: { list(): { id: string; head: { version: number; status: string } }[] } }) => docs.store.list().find((x) => x.id === 'findings-1')?.head;

/** dev-lead reads and rejects every version it is told about; researcher revises on every rejection relay it gets,
 *  as a model that ignores the wait instruction would, and records what each publish returned. */
function wire(runner: ScriptRunner, results: any[]) {
  runner.on.set('dev-lead', async (text, tools) => {
    for (const n of text.matchAll(/document ready: (\S+) v(\d+)/g)) {
      const [, id, v] = n;
      await readAllParts((name, a) => callTool(tools, name, a), { id, version: Number(v) });
      await callTool(tools, 'org_doc_decide', { id, version: Number(v), decision: 'reject', reason: `round ${v}: the summary is still too vague` });
    }
  });
  runner.on.set('researcher', async (text, tools) => {
    const m = /^\[message from [^\]]+\] subject: document rejected: (\S+) v(\d+)/m.exec(text);
    if (m) results.push(await callTool(tools, 'org_doc_publish', { type: 'findings', body: { summary: `revision after v${m[2]}` }, evidence: SOURCE, supersedes: `${m[1]}@v${m[2]}` }));
  });
}

describe('exhaustion, through a real daemon', () => {
  it('the cap is spent at the second rejection: the root and both leads get one notice, the producer is told to wait and is refused, the root accepts', async () => {
    const raw = capped(2);
    const runner = new ScriptRunner();
    const results: any[] = [];
    wire(runner, results);
    const { d, docs, name } = await start(raw, runner);
    for (const r of ['dev-lead', 'research-lead', 'boss']) await runner.toolsOf(d, name, r);
    const researcher = await runner.toolsOf(d, name, 'researcher');
    expect(await callTool(researcher, 'org_doc_publish', { type: 'findings', body: FINDINGS, evidence: SOURCE })).toMatchObject({ ok: true, ref: 'findings-1@v1' });
    expect(await waitFor(() => runner.count('boss', 'rework exhausted') === 1)).toBe(true);
    await docs.notices!.idle();
    expect(await waitFor(() => results.length === 2)).toBe(true);
    // v1 rejected (round 1 of 2) -> the producer revised; v2 rejected (round 2 of 2) -> spent
    expect(head(docs)).toMatchObject({ version: 2, status: 'rejected' });
    expect(results[0]).toMatchObject({ ok: true, ref: 'findings-1@v2' });
    expect(results[1]).toMatchObject({ ok: false, code: 'REWORK_EXHAUSTED', guard_code: 'REWORK_EXHAUSTED' });
    expect(docs.store.list()[0].versions).toHaveLength(2); // nothing was committed for the refused publish
    expect(docs.store.attempts('findings')).toMatchObject({ used: 0 }); // and it was not counted
    // exactly one notice each: the root with the options, the two leads a copy
    expect(runner.count('boss', 'rework exhausted')).toBe(1);
    expect(runner.count('research-lead', 'rework exhausted')).toBe(1);
    expect(runner.count('dev-lead', 'rework exhausted')).toBe(1);
    expect(runner.count('researcher', 'rework exhausted')).toBe(0);
    const bossMsg = runner.turns.get('boss')!.find((t) => t.includes('rework exhausted'))!;
    expect(bossMsg).toMatch(/^\[message from org-docs\] subject: rework exhausted: findings-1 \(development\)\n/);
    expect(bossMsg).toContain('development has rejected 2 versions of it, which is its cap of 2 rework rounds');
    expect(bossMsg).toContain('Last rejection: version 2, by dev-lead: round 2: the summary is still too vague');
    // the producer's relays state the round with the same rule; the second one tells it to wait
    const relays = (runner.turns.get('researcher') ?? []).filter((t) => t.includes('document rejected'));
    expect(relays).toHaveLength(2);
    expect(relays[0]).toContain('This is rework round 1 of 2 for this document from development.');
    expect(relays[1]).toContain('This is rework round 2 of 2 for this document from development.');
    expect(relays[1]).toContain('The cap of 2 rework rounds is spent, so this document is frozen');
    expect(relays[1]).toContain('wait for the root or your section lead to decide it');
    // the root decides: accepting the frozen head thaws and settles the thread
    const boss = runner.tools.get('boss')!;
    await readAllParts((n, a) => callTool(boss, n, a), { id: 'findings-1', version: 2 });
    expect(await callTool(boss, 'org_doc_decide', { id: 'findings-1', version: 2, decision: 'accept' })).toMatchObject({ ok: true, decision: 'accept', consumer: 'development', status: 'accepted' });
    expect(head(docs)).toMatchObject({ version: 2, status: 'accepted' });
    expect(docs.reworkReport()).toMatchObject([{ rounds: 1, cap: 2, exhausted: false, frozen: false }]);
    // the notices were journalled once each; nothing else was committed for them
    const j = readFileSync(join(docs.dir, 'notices.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(j.filter((x) => x.t === 'delivered' && String(x.key).startsWith('x:'))).toHaveLength(3);
    const types = readFileSync(join(docs.dir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).type);
    expect(new Set(types)).toEqual(new Set(['published', 'decided', 'read']));
  });

  it('a reload that raises the cap lets the producer revise again; the same reload needs no stop', async () => {
    const raw = capped(2);
    const runner = new ScriptRunner();
    const results: any[] = [];
    wire(runner, results);
    const { d, docs, name } = await start(raw, runner);
    for (const r of ['dev-lead', 'research-lead', 'boss']) await runner.toolsOf(d, name, r);
    const researcher = await runner.toolsOf(d, name, 'researcher');
    await callTool(researcher, 'org_doc_publish', { type: 'findings', body: FINDINGS, evidence: SOURCE });
    expect(await waitFor(() => results.length === 2)).toBe(true);
    expect(results[1]).toMatchObject({ code: 'REWORK_EXHAUSTED' });
    write(capped(3));
    expect(d.reloadOrgDef(name).changed).toContain('sections.development.max_rework_rounds');
    expect(docs.reworkReport()).toMatchObject([{ rounds: 2, cap: 3, frozen: false }]);
    expect(await callTool(researcher, 'org_doc_publish', { type: 'findings', body: { summary: 'a third try' }, evidence: SOURCE, supersedes: 'findings-1@v2' })).toMatchObject({ ok: true, ref: 'findings-1@v3' });
    // lowering it back freezes the thread on the spot
    expect(await waitFor(() => head(docs)?.status === 'rejected' && head(docs)?.version === 3)).toBe(true);
    write(capped(2));
    d.reloadOrgDef(name);
    expect(await callTool(researcher, 'org_doc_publish', { type: 'findings', body: { summary: 'a fourth' }, evidence: SOURCE, supersedes: 'findings-1@v3' })).toMatchObject({ ok: false, code: 'REWORK_EXHAUSTED' });
  });
});

describe('stop and resume', () => {
  it('a notice not delivered before the stop is sent once after the resume; one the recipients have seen is never sent again', async () => {
    const raw = capped(2);
    const first = await start(raw);
    first.docs.notices!.setEnabledForTest(false); // everything the engine owes stays undelivered: the process "died" after the commit
    const researcher = await first.runner.toolsOf(first.d, raw.name, 'researcher');
    const lead = await first.runner.toolsOf(first.d, raw.name, 'dev-lead');
    await callTool(researcher, 'org_doc_publish', { type: 'findings', body: FINDINGS, evidence: SOURCE });
    for (let v = 1; v <= 2; v++) {
      await readAllParts((n, a) => callTool(lead, n, a), { id: 'findings-1', version: v });
      await callTool(lead, 'org_doc_decide', { id: 'findings-1', version: v, decision: 'reject', reason: `no ${v}` });
      if (v === 1) await callTool(researcher, 'org_doc_publish', { type: 'findings', body: { summary: 'second try' }, evidence: SOURCE, supersedes: 'findings-1@v1' });
    }
    expect(head(first.docs)).toMatchObject({ version: 2, status: 'rejected' });
    await first.d.stopOrg(raw.name);

    const runner = new ScriptRunner();
    const again = await start(raw, runner, true);
    expect(again.running.run).toBe(first.running.run);
    expect(await waitFor(() => runner.count('boss', 'rework exhausted') === 1)).toBe(true);
    await again.docs.notices!.idle();
    expect(await waitFor(() => runner.count('research-lead', 'rework exhausted') === 1 && runner.count('dev-lead', 'rework exhausted') === 1)).toBe(true);
    // the freeze is derived from the replayed log: the producer is refused straight after the resume
    const researcher2 = await runner.toolsOf(again.d, raw.name, 'researcher');
    expect(await callTool(researcher2, 'org_doc_publish', { type: 'findings', body: { summary: 'after resume' }, evidence: SOURCE, supersedes: 'findings-1@v2' })).toMatchObject({ ok: false, code: 'REWORK_EXHAUSTED' });
    // the root and the leads read the document: they have seen their notice
    for (const r of ['boss', 'research-lead']) {
      const t = await runner.toolsOf(again.d, raw.name, r);
      await callTool(t, 'org_doc_read', { id: 'findings-1', version: 2 });
    }
    const devTools = await runner.toolsOf(again.d, raw.name, 'dev-lead');
    await callTool(devTools, 'org_doc_read', { id: 'findings-1', version: 2 });
    await again.d.stopOrg(raw.name);

    const third = new ScriptRunner();
    const last = await start(raw, third, true);
    await last.docs.notices!.idle();
    await new Promise((r) => setTimeout(r, 200));
    for (const r of ['boss', 'research-lead', 'dev-lead']) expect(third.count(r, 'rework exhausted'), r).toBe(0);
    const j = readFileSync(join(last.docs.dir, 'notices.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(j.filter((x) => x.t === 'delivered' && String(x.key).startsWith('x:'))).toHaveLength(3);
  });
});
