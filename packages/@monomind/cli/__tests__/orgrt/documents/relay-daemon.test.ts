// P3.9 acceptance through a real OrgDaemon, a real store, the real deliver path and real mailboxes, with a scripted
// runner (no model): an idle producer woken ONLY by messages. A consumer rejects, the runtime tells the producer
// (and the lead) with no daemon.deliver override, the producer republishes, the consumer is notified again and
// accepts. A refused accept (changed deliverable files) reaches the producer the same way. A rejection committed
// while the process was "down" is relayed after a resume.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentMessage, AgentRunArgs, AgentRunner, OrgToolDef } from '../../../src/orgrt/agent-runner.js';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import { FINDINGS, SOURCE, findingsOrg, sweepOrg } from '../support/doc-defs.js';
import { callTool } from '../support/doc-runner.js';

const saved = { ...process.env };
let root: string;
const daemons: OrgDaemon[] = [];

beforeEach(() => {
  process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
  process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
  root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'relay-daemon-'));
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

/** Every role records the full text of each message it is woken with and answers with an empty turn, after running
 *  the reaction scripted for its role (what a model woken by that message would do). */
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
  async toolsOf(d: OrgDaemon, org: string, role: string): Promise<OrgToolDef[]> {
    if (!this.tools.has(role)) {
      const seen = new Promise<void>((r) => this.waiters.set(role, r));
      await d.deliver(org, 'human', role, 'brief', 'brief');
      await Promise.race([seen, new Promise((_, rej) => setTimeout(() => rej(new Error(`${role} never started`)), 5000))]);
    }
    return this.tools.get(role) as OrgToolDef[];
  }
}

async function start(raw: Record<string, any>, runner = new ScriptRunner(), resume = false) {
  writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
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
const head = (docs: { store: { list(): { id: string; head: { version: number; status: string } }[] } }, id = 'findings-1') => docs.store.list().find((x) => x.id === id)?.head;

/** Consumer: reads and decides each notice's version, rejecting v1 and accepting later ones. Producer: on a rejection
 *  relay, publishes a corrected version superseding the rejected one. */
function wire(runner: ScriptRunner) {
  runner.on.set('dev-lead', async (text, tools) => {
    for (const n of text.matchAll(/document ready: (\S+) v(\d+)/g)) {
      const [, id, v] = n;
      await callTool(tools, 'org_doc_read', { id, version: Number(v) });
      await callTool(
        tools,
        'org_doc_decide',
        Number(v) === 1
          ? { id, version: 1, decision: 'reject', reason: 'the summary is too vague for development to start' }
          : { id, version: Number(v), decision: 'accept' },
      );
    }
  });
  runner.on.set('researcher', async (text, tools) => {
    const m = /^\[message from [^\]]+\] subject: document rejected: (\S+) v(\d+)/m.exec(text);
    if (m) await callTool(tools, 'org_doc_publish', { type: 'findings', body: { summary: 'a sharper summary of 2.22' }, evidence: SOURCE, supersedes: `${m[1]}@v${m[2]}` });
  });
}

describe('reject -> relay -> republish -> accept, through a real daemon', () => {
  it('an idle producer is woken only by the relay, republishes, the consumer is notified again and accepts; the lead gets a copy', async () => {
    const raw = findingsOrg();
    const runner = new ScriptRunner();
    wire(runner);
    const { d, running, docs, name } = await start(raw, runner);
    await runner.toolsOf(d, name, 'dev-lead');
    const researcher = await runner.toolsOf(d, name, 'researcher');
    await runner.toolsOf(d, name, 'research-lead');
    expect(runner.subjects('researcher')).toEqual(['brief']); // briefed and idle
    expect(await callTool(researcher, 'org_doc_publish', { type: 'findings', body: FINDINGS, evidence: SOURCE })).toMatchObject({ ok: true, ref: 'findings-1@v1' });
    expect(await waitFor(() => head(docs)?.status === 'accepted')).toBe(true);
    expect(head(docs)).toMatchObject({ version: 2, status: 'accepted' });
    // exactly one relay to the producer, sent by the runtime as org-docs, naming the reason the consumer gave
    const relays = (runner.turns.get('researcher') ?? []).filter((t) => t.includes('document rejected'));
    expect(relays).toHaveLength(1);
    expect(relays[0]).toMatch(/^\[message from org-docs\] subject: document rejected: findings-1 v1\n/);
    expect(relays[0]).toContain('dev-lead (development) rejected version 1 of document "findings-1"');
    expect(relays[0]).toContain('Reason given: the summary is too vague for development to start');
    expect(relays[0]).toContain('Publish attempts for "findings": 0 of 3 used, 3 left');
    expect(relays[0]).toContain('(supersedes: "findings-1@v1")');
    // the lead of the producing section got the short copy; the root (boss) did not need one
    await docs.notices!.idle();
    expect(await waitFor(() => runner.subjects('research-lead').length === 2)).toBe(true);
    expect(runner.subjects('research-lead')).toEqual(['brief', 'document rejected: findings-1 v1 (copy)']);
    expect(runner.subjects('boss').filter((s) => s.startsWith('document rejected'))).toEqual([]);
    // the republish notified the consumer again, naming the version it supersedes and what it had decided
    const notices = runner.turns.get('dev-lead')!.filter((t) => t.includes('document ready'));
    expect(notices).toHaveLength(2);
    expect(notices[1]).toContain('It supersedes version 1, which you had already decided (rejected): decide on this version instead.');
    // the facts lead-watch will need
    const [f] = docs.notices!.relayFacts();
    expect(f).toMatchObject({ kind: 'rejected', doc: 'findings-1', version: 1, producer: 'researcher', state: 'delivered', republished_version: 2 });
    expect(typeof f.delivered_at).toBe('string');
    expect(typeof f.republished_at).toBe('string');
    expect(f.copies).toMatchObject([{ to: 'research-lead', state: 'delivered' }]);
    // the cross-section refusal still holds for roles; the runtime sender is exempt, and the audit trail has no relay failure
    expect(await d.deliver(name, 'dev-lead', 'researcher', 's', 'b')).toMatch(/^REFUSED: dev-lead \(section development\) cannot message researcher/);
    expect(running.busEvents().filter((e) => /doc-relay/.test(e.reason ?? ''))).toEqual([]);
    // nothing was committed for the relay: the log has the publishes, decisions and reads only
    const types = readFileSync(join(docs.dir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).type);
    expect(new Set(types)).toEqual(new Set(['published', 'decided', 'read']));
  });

  it('a rejection by one consumer of several reaches the producer once, naming the consuming section', async () => {
    const raw = findingsOrg({ qa: true });
    const runner = new ScriptRunner();
    const { d, docs, name } = await start(raw, runner);
    const researcher = await runner.toolsOf(d, name, 'researcher');
    const qa = await runner.toolsOf(d, name, 'qa-lead');
    await callTool(researcher, 'org_doc_publish', { type: 'findings', body: FINDINGS, evidence: SOURCE });
    await callTool(qa, 'org_doc_decide', { id: 'findings-1', version: 1, decision: 'reject', reason: 'no test plan can start from this' });
    expect(await waitFor(() => runner.subjects('researcher').some((s) => s.startsWith('document rejected')))).toBe(true);
    expect(runner.subjects('researcher')).toContain('document rejected: findings-1 v1 (qa)');
    await docs.notices!.idle();
    expect(runner.subjects('researcher').filter((s) => s.startsWith('document rejected'))).toHaveLength(1);
  });

  it('crash between the commit of a rejection and its delivery: after a resume the producer is woken by the relay, exactly once', async () => {
    const raw = findingsOrg();
    const first = await start(raw);
    first.docs.notices!.setEnabledForTest(false); // the process "died" after the commit, before anything was delivered
    const researcher = await first.runner.toolsOf(first.d, raw.name, 'researcher');
    const lead = await first.runner.toolsOf(first.d, raw.name, 'dev-lead');
    await callTool(researcher, 'org_doc_publish', { type: 'findings', body: FINDINGS, evidence: SOURCE });
    expect(await callTool(lead, 'org_doc_decide', { id: 'findings-1', version: 1, decision: 'reject', reason: 'not specific enough' })).toMatchObject({ ok: true, status: 'rejected' });
    await first.d.stopOrg(raw.name);
    const runner = new ScriptRunner();
    const again = await start(raw, runner, true);
    expect(again.running.run).toBe(first.running.run);
    expect(await waitFor(() => runner.subjects('researcher').some((s) => s.startsWith('document rejected')))).toBe(true);
    await again.docs.notices!.idle();
    expect(runner.subjects('researcher').filter((s) => s.startsWith('document rejected'))).toHaveLength(1);
    expect(runner.subjects('research-lead').filter((s) => s.startsWith('document rejected'))).toHaveLength(1);
    // the producer relay and the copy were each delivered once, and journalled
    const rel = readFileSync(join(again.docs.dir, 'notices.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(rel.filter((j) => j.t === 'delivered' && String(j.key).startsWith('r:'))).toHaveLength(2);
  });
});

describe('a refused accept (the producer deliverable files changed) reaches the producer through the runtime', () => {
  const DOC = 'module-sheets-w1';
  const MODS = ['m1', 'm2', 'm3', 'm4'];
  const sheet = (m: string, bump = 0) => ({
    module: m,
    answers: Array.from({ length: 12 }, (_, i) => ({
      q: `q${String(i + 1).padStart(2, '0')}`,
      value: 100 * Number(m.slice(1)) + i + (i === 3 ? bump : 0),
      files: ['a.js', 'b.js', 'c.js', 'd.js'].map((f) => `${m}/${f}`),
    })),
  });
  const body = (bump = 0) => ({ worker: 'worker-1', sheets: MODS.map((m) => sheet(m, m === 'm3' ? bump : 0)) });
  const writeSheet = (m: string, bump = 0) => {
    mkdirSync(join(root, 'out', m), { recursive: true });
    writeFileSync(join(root, 'out', m, 'answers.json'), JSON.stringify(sheet(m, bump)));
  };

  it('the file moves after the publish: the accept is refused, the producer is woken, republishes, and the accept goes through; the lead is the root', async () => {
    const raw = sweepOrg();
    raw.documents[DOC].deliverable_files = MODS.map((m) => ({
      file: `out/${m}/answers.json`,
      select: { array: 'sheets', key: 'module', value: m },
      compare: ['module', 'answers[].q', 'answers[].value', 'answers[].files'],
    }));
    const runner = new ScriptRunner();
    runner.on.set('worker-1', async (text, tools) => {
      if (/subject: document needs republishing: module-sheets-w1-1 v1/.test(text))
        await callTool(tools, 'org_doc_publish', { type: DOC, body: body(9), supersedes: `${DOC}-1@v1` });
    });
    const { d, docs, name } = await start(raw, runner);
    const w1 = await runner.toolsOf(d, name, 'worker-1');
    const syn = await runner.toolsOf(d, name, 'synthesiser');
    await runner.toolsOf(d, name, 'lead');
    for (const m of MODS) writeSheet(m);
    expect(await callTool(w1, 'org_doc_publish', { type: DOC, body: body() })).toMatchObject({ ok: true });
    writeSheet('m3', 9); // the producer's file moves after the publish
    const refused = await callTool(syn, 'org_doc_decide', { id: `${DOC}-1`, version: 1, decision: 'accept' });
    expect(refused).toMatchObject({ ok: false, guard_code: 'DELIVERABLE_CHANGED' });
    expect(await waitFor(() => docs.store.list()[0].versions.length === 2)).toBe(true); // woken by the relay, it republished
    const msg = (runner.turns.get('worker-1') ?? []).find((t) => t.includes('needs republishing'))!;
    expect(msg).toMatch(/^\[message from org-docs\] subject: document needs republishing: module-sheets-w1-1 v1\n/);
    expect(msg).toContain('could not be accepted by synthesiser (synthesis) because your deliverable files changed after you published it: out/m3/answers.json.');
    expect(msg).toMatch(/First difference: out\/m3\/answers\.json differs from the document's sheets entry m3 at \$\.answers\[3\]\.value/);
    expect(msg).not.toContain(root);
    // worker-1 leads its own section, so the copy goes to the root
    await docs.notices!.idle();
    expect(await waitFor(() => runner.subjects('lead').some((x) => x.endsWith('(copy)')))).toBe(true);
    expect(runner.subjects('lead')).toContain('document needs republishing: module-sheets-w1-1 v1 (copy)');
    expect(await callTool(syn, 'org_doc_decide', { id: `${DOC}-1`, version: 2, decision: 'accept' })).toMatchObject({ ok: true, status: 'accepted' });
    // one relay for that refusal, and a repeat of the refused accept while still different would not be relayed again
    expect((runner.turns.get('worker-1') ?? []).filter((t) => t.includes('needs republishing'))).toHaveLength(1);
    expect(docs.notices!.relayFacts()).toMatchObject([{ kind: 'deliverable-changed', version: 1, state: 'delivered', republished_version: 2 }]);
  });
});
