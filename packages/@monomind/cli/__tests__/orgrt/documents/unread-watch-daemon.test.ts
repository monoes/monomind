// P3.13 through a real OrgDaemon and a scripted runner (no model): a published document nobody reads reaches the
// lead as one `doc-unread` event and one mailbox notice, a read ends it, a superseding version replaces it, and
// an org without sections gets no watch, no event and no text. Real timers with fractional-second intervals
// (`run_config.lead_watch.unread_s`), the way the repo's other daemon watch tests run.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentMessage, AgentRunArgs, AgentRunner, OrgToolDef } from '../../../src/orgrt/agent-runner.js';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import { FINDINGS, SOURCE, findingsOrg } from '../support/doc-defs.js';
import { callTool } from '../support/doc-runner.js';

const CONSUMER = 'dev-lead';
const saved = { ...process.env };
let root: string;
const daemons: OrgDaemon[] = [];

beforeEach(() => {
  process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
  process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
  root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'unread-daemon-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
});
afterEach(async () => {
  await Promise.all(daemons.splice(0).map((d) => d.stopAll().catch(() => {})));
  rmSync(root, { recursive: true, force: true });
  for (const k of ['MONOMIND_SPAWN_STAGGER_MS', 'MONOMIND_MIN_FREE_MEM_MB'])
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});

/** Records every message each role is given. The consumer ignores what it is told: it never reads on its own. */
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
    return (this.turns.get(role) ?? []).filter((t) => t.includes('[watch] Document'));
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

function org(unread: number | false | undefined): Record<string, any> {
  const raw = findingsOrg();
  if (unread !== undefined) raw.run_config.lead_watch = unread === false ? false : { unread_s: unread };
  return raw;
}

async function start(raw: Record<string, any>, resume = false) {
  writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
  const runner = new Recorder();
  const d = new OrgDaemon(root, { runner, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
  daemons.push(d);
  const running = await d.startOrg(raw.name, undefined, { evalGate: true, ...(resume ? { resume: true } : {}) });
  const events = () => running.busEvents().filter((e) => e.reason === 'doc-unread');
  return { d, running, runner, docs: running.documents!, events };
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
const publish = (tools: OrgToolDef[], extra: Record<string, unknown> = {}) =>
  callTool(tools, 'org_doc_publish', { type: 'findings', body: FINDINGS, evidence: SOURCE, ...extra });

describe('P3.13: a published document nobody reads reaches the lead', () => {
  it('the notice is pending (notices off): the watch stays silent however long, delivery later starts the clock, the read ends it', async () => {
    const raw = org(0.5);
    const { d, runner, docs, events } = await start(raw);
    docs.notices!.setEnabledForTest(false);
    const consumer = await runner.toolsOf(d, raw.name, CONSUMER);
    const researcher = await runner.toolsOf(d, raw.name, 'researcher');
    await publish(researcher);
    expect(docs.notices!.pending().length).toBeGreaterThan(0);
    await sleep(2200); // more than four intervals: still silent, 6.2 (f) "no pending notice"
    expect(events()).toEqual([]);
    expect(runner.watchTurns('boss')).toEqual([]);
    // the consumer itself is told nothing by the watch
    expect(runner.turns.get(CONSUMER)).toHaveLength(1); // only the human's hello
    // delivery goes ahead: the clock runs from the delivery, and then it is the not-read case
    docs.notices!.setEnabledForTest(true);
    await docs.notices!.retry();
    expect(await waitFor(() => events().length === 1)).toBe(true);
    expect(events()[0].data).toMatchObject({ cause: 'not-read', unread: [CONSUMER], n: 1 });
    await callTool(consumer, 'org_doc_read', { id: 'findings-1', version: 1 });
    await sleep(1800);
    expect(events()).toHaveLength(1);
  });

  it('the runtime gave up delivering the notice: one lead event, cause notice-gave-up, naming the document; the read ends it', async () => {
    const raw = org(0.5);
    const { d, runner, docs, events } = await start(raw);
    const consumer = await runner.toolsOf(d, raw.name, CONSUMER);
    const researcher = await runner.toolsOf(d, raw.name, 'researcher');
    // every delivery of the runtime fails from now on: the engine retries on each tick and gives up after its cap
    docs.notices!.start({ deliver: async () => 'ERROR: mailbox closed' });
    await publish(researcher);
    expect(await waitFor(() => events().length === 1, 10_000)).toBe(true);
    const [e] = events();
    expect(e).toMatchObject({
      type: 'audit',
      from: 'org-docs',
      reason: 'doc-unread',
      data: { doc: 'findings-1', version: 1, type: 'findings', producer: 'researcher', to: 'boss', unread: [CONSUMER], cause: 'notice-gave-up', n: 1 },
    });
    expect(e.data?.key).toBe('findings-1@v1>boss');
    expect(await waitFor(() => runner.watchTurns('boss').length === 1)).toBe(true);
    const text = runner.watchTurns('boss')[0];
    expect(text).toContain('[watch] Document "findings-1" v1 (findings, published by researcher) has gone unread for');
    expect(text).toContain('dev-lead (the runtime gave up delivering its notice after 5 failed attempts)');
    expect(text).toContain('org_send to "dev-lead"');
    expect(runner.turns.get(CONSUMER)).toHaveLength(1);
    expect(await callTool(consumer, 'org_doc_read', { id: 'findings-1', version: 1 })).toMatchObject({ ok: true });
    await sleep(1800);
    expect(events()).toHaveLength(1);
    expect(runner.watchTurns('boss')).toHaveLength(1);
  });

  it('the notice was delivered and the consumer does not read: one notice, cause not-read, ended by the read', async () => {
    const raw = org(0.5);
    const { d, runner, docs, events } = await start(raw);
    const consumer = await runner.toolsOf(d, raw.name, CONSUMER);
    const researcher = await runner.toolsOf(d, raw.name, 'researcher');
    await publish(researcher);
    await docs.notices!.idle();
    expect(await waitFor(() => events().length === 1)).toBe(true);
    expect(events()[0].data).toMatchObject({ cause: 'not-read', unread: [CONSUMER], n: 1 });
    expect(await waitFor(() => runner.watchTurns('boss').length === 1)).toBe(true);
    expect(runner.watchTurns('boss')[0]).toContain('dev-lead (told, no org_doc_read)');
    await callTool(consumer, 'org_doc_read', { id: 'findings-1', version: 1 });
    await sleep(1800);
    expect(events()).toHaveLength(1);
  });

  it('a superseding version replaces the episode: only the head is reported', async () => {
    const raw = org(0.5);
    const { d, runner, events } = await start(raw);
    await runner.toolsOf(d, raw.name, CONSUMER);
    const researcher = await runner.toolsOf(d, raw.name, 'researcher');
    await publish(researcher);
    await publish(researcher, { supersedes: 'findings-1@v1', body: { summary: 'second try' } });
    expect(await waitFor(() => events().length >= 1)).toBe(true);
    await sleep(300);
    expect(events().map((x) => `${x.data?.doc}@v${x.data?.version}`)).toEqual(['findings-1@v2']);
  });

  it('a decision refused for want of a read does not end it (P3.16b: a decision needs the read first)', async () => {
    const raw = org(0.5);
    const { d, runner, events } = await start(raw);
    const consumer = await runner.toolsOf(d, raw.name, CONSUMER);
    const researcher = await runner.toolsOf(d, raw.name, 'researcher');
    await publish(researcher);
    expect(await callTool(consumer, 'org_doc_decide', { id: 'findings-1', version: 1, decision: 'accept' })).toMatchObject({ ok: false, code: 'UNREAD_PARTS' });
    expect(await waitFor(() => events().length === 1)).toBe(true);
    expect(events()[0].data).toMatchObject({ cause: 'not-read' });
  });

  it('lead_watch: false turns it off', async () => {
    const raw = org(false);
    const { d, runner, events } = await start(raw);
    await runner.toolsOf(d, raw.name, CONSUMER);
    const researcher = await runner.toolsOf(d, raw.name, 'researcher');
    await publish(researcher);
    await sleep(1500);
    expect(events()).toEqual([]);
  });

  it('resume: the bus history seeds the episode, so the count carries over and the cap holds', async () => {
    const raw = org(0.5);
    const first = await start(raw);
    await first.runner.toolsOf(first.d, raw.name, CONSUMER);
    const researcher = await first.runner.toolsOf(first.d, raw.name, 'researcher');
    await publish(researcher);
    expect(await waitFor(() => first.events().length === 1)).toBe(true);
    await first.d.stopOrg(raw.name);
    const again = await start(raw, true);
    expect(again.running.run).toBe(first.running.run);
    expect(await waitFor(() => again.events().length >= 1, 8000)).toBe(true);
    expect(again.events()[0].data).toMatchObject({ key: 'findings-1@v1>boss', n: 2 });
  });
});

describe('an org without sections', () => {
  it('has no unread watch: lead_watch.unread_s is inert, no event, no text, no documents runtime', async () => {
    const raw = findingsOrg();
    for (const k of ['sections', 'documents', 'requires']) delete raw[k];
    delete raw.run_config.experimental;
    delete raw.run_config.completion;
    raw.run_config.lead_watch = { unread_s: 0.2 };
    writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
    const runner = new Recorder();
    const d = new OrgDaemon(root, { runner, forward: false, stopWaitMs: 100 });
    daemons.push(d);
    const running = await d.startOrg(raw.name);
    await runner.toolsOf(d, raw.name, 'researcher');
    await sleep(800);
    expect(running.documents).toBeUndefined();
    expect(existsSync(join(root, '.monomind/orgs', raw.name, 'docs'))).toBe(false);
    expect(running.busEvents().filter((e) => e.reason === 'doc-unread')).toEqual([]);
    expect(runner.watchTurns('boss')).toEqual([]);
  });
});
