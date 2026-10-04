// P3.16c through a real OrgDaemon and a scripted runner (no model): the lead is briefed "wait for the documents"
// (an assignment by message, which lead-watch counts as open work). A consumer decider that is correctly waiting
// is not reported "silent with open work"; a role that is not a decider still is (the control), and a consumer
// that has READ a version and then does nothing is reported again. Real timers, fractional-second intervals.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'awaiting-daemon-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
});
afterEach(async () => {
  await Promise.all(daemons.splice(0).map((d) => d.stopAll().catch(() => {})));
  rmSync(root, { recursive: true, force: true });
  for (const k of ['MONOMIND_SPAWN_STAGGER_MS', 'MONOMIND_MIN_FREE_MEM_MB'])
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});

/** Answers every turn with one line and does nothing else: it never reads or decides on its own. */
class Recorder implements AgentRunner {
  readonly tools = new Map<string, OrgToolDef[]>();
  private readonly waiters = new Map<string, () => void>();
  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const role = args.env.MONOMIND_ORG_ROLE;
    this.tools.set(role, args.tools);
    this.waiters.get(role)?.();
    for await (const _m of args.prompt as AsyncIterable<{ message: { content: string } }>) {
      yield { type: 'assistant', text: 'ok', session_id: 's' } as AgentMessage;
      yield { type: 'result', subtype: 'success', input_tokens: 1, output_tokens: 1, session_id: 's' } as AgentMessage;
    }
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

async function start() {
  const raw = findingsOrg();
  // lead-watch silent after 0.5 s; the unread-watch (a different watch) is parked far away
  raw.run_config.lead_watch = { not_started_s: 60, silent_s: 0.5, unread_s: 600 };
  writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
  const runner = new Recorder();
  const d = new OrgDaemon(root, { runner, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
  daemons.push(d);
  const running = await d.startOrg(raw.name, undefined, { evalGate: true });
  const org = raw.name as string;
  const silent = (role: string) =>
    running.busEvents().filter((e) => e.reason === 'lead-watch' && e.data?.role === role && e.data?.kind === 'silent');
  const brief = (role: string) =>
    d.deliver(org, 'boss', role, 'Assignment: the findings', 'Wait for the findings document, then read it and decide on it.');
  return { d, org, running, runner, silent, brief, docs: running.documents! };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond: () => boolean, ms = 6000): Promise<boolean> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return cond();
};
const publish = (tools: OrgToolDef[]) => callTool(tools, 'org_doc_publish', { type: 'findings', body: FINDINGS, evidence: SOURCE });

describe('P3.16c: lead-watch and a consumer waiting for documents', () => {
  it('control: a role that is not a decider and holds the same briefing is reported silent', async () => {
    const t = await start();
    await t.runner.toolsOf(t.d, t.org, 'coder');
    await t.brief('coder');
    expect(await waitFor(() => t.silent('coder').length >= 1)).toBe(true);
  });

  it('no document yet: the consumer waiting for notices is not reported silent', async () => {
    const t = await start();
    await t.runner.toolsOf(t.d, t.org, CONSUMER);
    await t.brief(CONSUMER);
    await sleep(2200); // more than four silent intervals
    expect(t.silent(CONSUMER)).toEqual([]);
  });

  it('a published version it was told of and has not read: still not silent (the unread-watch is the one that flags it)', async () => {
    const t = await start();
    await t.runner.toolsOf(t.d, t.org, CONSUMER);
    const researcher = await t.runner.toolsOf(t.d, t.org, 'researcher');
    await t.brief(CONSUMER);
    await publish(researcher);
    await t.docs.notices!.idle();
    await sleep(2200);
    expect(t.silent(CONSUMER)).toEqual([]);
  });

  it('it read the version and then does nothing: reported silent again; once it has decided, the settled work is silent too', async () => {
    const t = await start();
    const consumer = await t.runner.toolsOf(t.d, t.org, CONSUMER);
    const researcher = await t.runner.toolsOf(t.d, t.org, 'researcher');
    await t.brief(CONSUMER);
    await publish(researcher);
    await t.docs.notices!.idle();
    await callTool(consumer, 'org_doc_read', { id: 'findings-1' });
    expect(await waitFor(() => t.silent(CONSUMER).length >= 1)).toBe(true);
  });
});
