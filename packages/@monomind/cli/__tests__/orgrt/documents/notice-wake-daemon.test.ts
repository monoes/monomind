// P3.8 acceptance (spec section 11, R24): a scripted consumer that is idle and is woken ONLY by messages completes
// read -> decide for every published document through a real OrgDaemon (real deliver path, real mailbox, real store),
// and the same script deadlocks with the notices off (the internal test switch). No model: the runner is scripted.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentMessage, AgentRunArgs, AgentRunner, OrgToolDef } from '../../../src/orgrt/agent-runner.js';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import { callTool } from '../support/doc-runner.js';
import { FINDINGS, SOURCE, findingsOrg } from '../support/doc-defs.js';

const CONSUMER = 'dev-lead';
const saved = { ...process.env };
let root: string;
const daemons: OrgDaemon[] = [];

beforeEach(() => {
  process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
  process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
  root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'notice-daemon-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
});
afterEach(async () => {
  await Promise.all(daemons.splice(0).map((d) => d.stopAll().catch(() => {})));
  rmSync(root, { recursive: true, force: true });
  for (const k of ['MONOMIND_SPAWN_STAGGER_MS', 'MONOMIND_MIN_FREE_MEM_MB'])
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});

/** Every role records its tools and answers each message with an empty turn; the consumer additionally acts on a
 *  notice the way a woken role would: org_doc_read, then org_doc_decide(accept), for the version the subject names. */
class WakeRunner implements AgentRunner {
  readonly tools = new Map<string, OrgToolDef[]>();
  readonly turns: string[] = [];
  private readonly waiters = new Map<string, () => void>();
  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const role = args.env.MONOMIND_ORG_ROLE;
    this.tools.set(role, args.tools);
    this.waiters.get(role)?.();
    for await (const m of args.prompt as AsyncIterable<{ message: { content: string } }>) {
      const text = m.message.content;
      if (role === CONSUMER) {
        this.turns.push(text.match(/subject: (.*)/)?.[1] ?? text.slice(0, 40));
        for (const n of text.matchAll(/document ready: (\S+) v(\d+)/g)) {
          const [, id, v] = n;
          await callTool(args.tools, 'org_doc_read', { id, version: Number(v) });
          await callTool(args.tools, 'org_doc_decide', { id, version: Number(v), decision: 'accept' });
        }
      }
      yield { type: 'assistant', text: 'ok', session_id: 's' } as AgentMessage;
      yield { type: 'result', subtype: 'success', input_tokens: 1, output_tokens: 1, session_id: 's' } as AgentMessage;
    }
  }
  async toolsOf(d: OrgDaemon, org: string, role: string, brief = 'hello'): Promise<OrgToolDef[]> {
    if (!this.tools.has(role)) {
      const seen = new Promise<void>((r) => this.waiters.set(role, r));
      await d.deliver(org, 'human', role, brief, brief);
      await Promise.race([seen, new Promise((_, rej) => setTimeout(() => rej(new Error(`${role} never started`)), 5000))]);
    }
    return this.tools.get(role) as OrgToolDef[];
  }
}

async function start(raw: Record<string, any>, resume = false) {
  writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
  const runner = new WakeRunner();
  const d = new OrgDaemon(root, { runner, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
  daemons.push(d);
  const running = await d.startOrg(raw.name, undefined, { evalGate: true, ...(resume ? { resume: true } : {}) });
  return { d, running, runner, docs: running.documents! };
}

const waitFor = async (cond: () => boolean, ms = 4000): Promise<boolean> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return cond();
};
const accepted = (docs: { store: { list(): { head: { status: string } }[] } }) => docs.store.list().every((x) => x.head.status === 'accepted');

describe('R24 through a real daemon: an idle consumer woken only by messages', () => {
  it('briefed before any document exists and ending its turn, it is woken by every publish and decides every document, republish included', async () => {
    const raw = findingsOrg();
    const { d, runner, docs } = await start(raw);
    const consumer = await runner.toolsOf(d, raw.name, CONSUMER, 'brief: findings will come, wait for them');
    expect(consumer).toBeDefined();
    const researcher = await runner.toolsOf(d, raw.name, 'researcher');
    expect(runner.turns).toEqual(['brief: findings will come, wait for them']); // it saw its briefing and went idle
    for (let i = 1; i <= 3; i++)
      expect(await callTool(researcher, 'org_doc_publish', { type: 'findings', body: { summary: `finding ${i}` }, evidence: SOURCE })).toMatchObject({ ok: true });
    expect(await waitFor(() => accepted(docs))).toBe(true);
    expect(docs.store.list().map((x) => `${x.id}:${x.head.status}`)).toEqual(['findings-1:accepted', 'findings-2:accepted', 'findings-3:accepted']);
    // the republish wakes it again and the new version is decided
    expect(await callTool(researcher, 'org_doc_publish', { type: 'findings', body: FINDINGS, evidence: SOURCE, supersedes: 'findings-1@v1' })).toMatchObject({ ref: 'findings-1@v2' });
    expect(await waitFor(() => accepted(docs))).toBe(true);
    expect(docs.store.list()[0].head).toMatchObject({ version: 2, status: 'accepted' });
    expect(runner.turns.filter((t) => t.startsWith('document ready')).sort()).toEqual([
      'document ready: findings-1 v1',
      'document ready: findings-1 v2',
      'document ready: findings-2 v1',
      'document ready: findings-3 v1',
    ]);
    // the all-available message went out once, to the one decision maker
    expect(runner.turns.filter((t) => t === 'all documents are available')).toHaveLength(1);
    // the facts lead-watch will need
    const facts = docs.notices!.facts();
    expect(facts).toHaveLength(4);
    for (const f of facts) {
      expect(f.notices).toHaveLength(1);
      expect(f.notices[0]).toMatchObject({ role: CONSUMER, state: 'delivered' });
      expect(typeof f.notices[0].delivered_at).toBe('string');
      expect(Object.keys(f.first_read_at)).toEqual([CONSUMER]);
    }
  });

  it('regression: the same script with the notices off deadlocks, nothing is read or decided', async () => {
    const raw = findingsOrg();
    const { d, runner, docs } = await start(raw);
    docs.notices!.setEnabledForTest(false);
    await runner.toolsOf(d, raw.name, CONSUMER, 'brief: findings will come, wait for them');
    const researcher = await runner.toolsOf(d, raw.name, 'researcher');
    for (let i = 1; i <= 3; i++) await callTool(researcher, 'org_doc_publish', { type: 'findings', body: { summary: `finding ${i}` }, evidence: SOURCE });
    expect(await waitFor(() => accepted(docs), 700)).toBe(false);
    expect(docs.store.list().every((x) => x.head.status === 'pending')).toBe(true);
    expect(runner.turns).toEqual(['brief: findings will come, wait for them']);
    expect(docs.notices!.pending().length).toBeGreaterThan(0);
  });

  it('crash between commit and delivery, then a resume: the daemon re-delivers the committed notices and the consumer decides', async () => {
    const raw = findingsOrg();
    const first = await start(raw);
    first.docs.notices!.setEnabledForTest(false); // the process "died" after the commit, before anything was delivered
    const researcher = await first.runner.toolsOf(first.d, raw.name, 'researcher');
    await callTool(researcher, 'org_doc_publish', { type: 'findings', body: FINDINGS, evidence: SOURCE });
    await first.d.stopOrg(raw.name);
    const again = await start(raw, true);
    expect(again.running.run).toBe(first.running.run);
    expect(await waitFor(() => accepted(again.docs))).toBe(true);
    expect(again.runner.turns.filter((t) => t.startsWith('document ready'))).toEqual(['document ready: findings-1 v1']);
    const journal = readFileSync(join(again.docs.dir, 'notices.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(journal.map((j) => j.t)).toEqual(['delivered', 'delivered']); // the notice and the all-available message
  });
});

describe('an org without sections', () => {
  it('has no notice engine, no journal, no org-docs message and no new bus event', async () => {
    const raw = findingsOrg();
    for (const k of ['sections', 'documents', 'requires']) delete raw[k];
    delete raw.run_config.experimental;
    delete raw.run_config.completion;
    writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
    const runner = new WakeRunner();
    const d = new OrgDaemon(root, { runner, forward: false, stopWaitMs: 100 });
    daemons.push(d);
    const running = await d.startOrg(raw.name);
    await runner.toolsOf(d, raw.name, 'researcher');
    expect(running.documents).toBeUndefined();
    expect(existsSync(join(root, '.monomind/orgs', raw.name, 'docs'))).toBe(false);
    expect(running.busEvents().filter((e) => e.from === 'org-docs' || /doc-notice/.test(e.reason ?? ''))).toEqual([]);
  });
});
