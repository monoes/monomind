// P4.8 acceptance through a real OrgDaemon, a real store, the real deliver path and real mailboxes, with a scripted
// runner (no model): a dev and QA loop. Rounds one to N complete and a last round that is accepted ends cleanly;
// round N+1 is refused and escalated once to the root and both leads; the root decides; a reload moves max_rounds;
// a stop and a resume re-send an undelivered notice once and a seen one never; an undeclared cycle is refused at start.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentMessage, AgentRunArgs, AgentRunner, OrgToolDef } from '../../../src/orgrt/agent-runner.js';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import { callTool, readAllParts } from '../support/doc-runner.js';
import { SUMMARY, loopOrg } from '../support/loop-defs.js';

const saved = { ...process.env };
let root: string;
const daemons: OrgDaemon[] = [];

beforeEach(() => {
  process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
  process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
  root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'loops-daemon-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
});
afterEach(async () => {
  await Promise.all(daemons.splice(0).map((d) => d.stopAll().catch(() => {})));
  rmSync(root, { recursive: true, force: true });
  for (const k of ['MONOMIND_SPAWN_STAGGER_MS', 'MONOMIND_MIN_FREE_MEM_MB'])
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});

/** Every role records the text of each message it is woken with and answers with an empty turn. */
class ScriptRunner implements AgentRunner {
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
  count(role: string, subjectPrefix: string): number {
    return (this.turns.get(role) ?? []).filter((t) => (/subject: (.*)/.exec(t)?.[1] ?? '').startsWith(subjectPrefix)).length;
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
const LOOP_SUBJECT = 'loop exhausted';
const head = (docs: { store: { list(): { id: string; head: { version: number; status: string } }[] } }) =>
  docs.store.list().find((x) => x.id === 'build-1')?.head;

type Roles = { coder: OrgToolDef[]; qa: OrgToolDef[]; boss: OrgToolDef[]; devLead: OrgToolDef[] };
async function roles(t: Awaited<ReturnType<typeof start>>): Promise<Roles> {
  return {
    coder: await t.runner.toolsOf(t.d, t.name, 'coder'),
    qa: await t.runner.toolsOf(t.d, t.name, 'qa-lead'),
    boss: await t.runner.toolsOf(t.d, t.name, 'boss'),
    devLead: await t.runner.toolsOf(t.d, t.name, 'dev-lead'),
  };
}
const build = (r: Roles, v: number) =>
  callTool(r.coder, 'org_doc_publish', { type: 'build', body: SUMMARY(`build try ${v}`), ...(v > 1 ? { supersedes: `build-1@v${v - 1}` } : {}) });
const review = async (r: Roles, v: number, decision: 'accept' | 'reject') => {
  await readAllParts((n, a) => callTool(r.qa, n, a), { id: 'build-1', version: v });
  return callTool(r.qa, 'org_doc_decide', { id: 'build-1', version: v, decision, ...(decision === 'reject' ? { reason: `round ${v}: tests fail` } : {}) });
};

describe('a dev and QA loop to exhaustion, through a real daemon', () => {
  it('rounds one and two complete, round three is refused and escalated once, and the root decides', async () => {
    const t = await start(loopOrg(2));
    const r = await roles(t);
    expect(await build(r, 1)).toMatchObject({ ok: true, ref: 'build-1@v1' });
    expect(await review(r, 1, 'reject')).toMatchObject({ ok: true, status: 'rejected' });
    expect(await build(r, 2)).toMatchObject({ ok: true, ref: 'build-1@v2' }); // return 1
    expect(await review(r, 2, 'reject')).toMatchObject({ ok: true });
    expect(await build(r, 3)).toMatchObject({ ok: true, ref: 'build-1@v3' }); // return 2: the cap
    expect(t.docs.loopReport()[0]).toMatchObject({ rounds: 2, max_rounds: 2, exhausted: true, frozen: true });
    await t.docs.notices!.idle();
    expect(t.runner.count('boss', LOOP_SUBJECT)).toBe(0); // the last round is still under review
    expect(await review(r, 3, 'reject')).toMatchObject({ ok: true });
    expect(await waitFor(() => t.runner.count('boss', LOOP_SUBJECT) === 1)).toBe(true);
    await t.docs.notices!.idle();
    expect(await waitFor(() => t.runner.count('dev-lead', LOOP_SUBJECT) === 1 && t.runner.count('qa-lead', LOOP_SUBJECT) === 1)).toBe(true);
    expect(t.runner.count('coder', LOOP_SUBJECT)).toBe(0);
    const bossMsg = t.runner.turns.get('boss')!.find((x) => x.includes(LOOP_SUBJECT))!;
    expect(bossMsg).toMatch(/^\[message from org-docs\] subject: loop exhausted: loops\[0\] \(development, qa\)\n/);
    expect(bossMsg).toContain('which is max_rounds 2 (loops[0].max_rounds)');
    expect(bossMsg).toContain('Last rejection: build-1@v3, by qa-lead for qa: round 3: tests fail');
    // round three is refused, uncounted, and the refusal names the code
    const refused = await build(r, 4);
    expect(refused).toMatchObject({ ok: false, code: 'LOOP_EXHAUSTED', guard_code: 'LOOP_EXHAUSTED' });
    expect(refused.remedy).toContain('wait for the root');
    expect(t.docs.store.list()[0].versions).toHaveLength(3);
    expect(t.docs.store.attempts('build')).toMatchObject({ used: 0 });
    // escalated once: asking again changes nothing
    await build(r, 4);
    await t.docs.notices!.retry();
    expect(t.runner.count('boss', LOOP_SUBJECT)).toBe(1);
    // the root accepts the last version: the loop ends
    await readAllParts((n, a) => callTool(r.boss, n, a), { id: 'build-1', version: 3 });
    expect(await callTool(r.boss, 'org_doc_decide', { id: 'build-1', version: 3, decision: 'accept' })).toMatchObject({ ok: true, consumer: 'qa', status: 'accepted' });
    expect(head(t.docs)).toMatchObject({ version: 3, status: 'accepted' });
    expect(t.docs.loopReport()[0]).toMatchObject({ exhausted: true, settled: true, frozen: false });
    // the notices were journalled once each
    const j = readFileSync(join(t.docs.dir, 'notices.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(j.filter((x) => x.t === 'delivered' && String(x.key).startsWith('l:'))).toHaveLength(3);
  }, 30_000);

  it('a last round that QA accepts ends the loop cleanly: no escalation, no further round', async () => {
    const t = await start(loopOrg(2));
    const r = await roles(t);
    await build(r, 1);
    await review(r, 1, 'reject');
    await build(r, 2);
    await review(r, 2, 'reject');
    await build(r, 3);
    expect(await review(r, 3, 'accept')).toMatchObject({ ok: true, status: 'accepted' });
    await t.docs.notices!.idle();
    await new Promise((x) => setTimeout(x, 150));
    for (const role of ['boss', 'dev-lead', 'qa-lead']) expect(t.runner.count(role, LOOP_SUBJECT), role).toBe(0);
    expect(t.docs.loopReport()[0]).toMatchObject({ rounds: 2, exhausted: true, settled: true });
  }, 30_000);
});

describe('a reload that moves max_rounds', () => {
  it('raising it lets the producer go another round with no stop; lowering it freezes and escalates at once', async () => {
    const t = await start(loopOrg(2));
    const r = await roles(t);
    await build(r, 1);
    await review(r, 1, 'reject');
    await build(r, 2);
    await review(r, 2, 'reject');
    await build(r, 3);
    await review(r, 3, 'reject');
    expect(await waitFor(() => t.runner.count('boss', LOOP_SUBJECT) === 1)).toBe(true);
    expect(await build(r, 4)).toMatchObject({ ok: false, code: 'LOOP_EXHAUSTED' });
    write(loopOrg(3));
    expect(t.d.reloadOrgDef(t.name).changed).toContain('loops[0].max_rounds');
    expect(t.docs.loopReport()[0]).toMatchObject({ max_rounds: 3, exhausted: false });
    expect(await build(r, 4)).toMatchObject({ ok: true, ref: 'build-1@v4' });
    expect(t.docs.loopReport()[0]).toMatchObject({ rounds: 3, exhausted: true });
    await review(r, 4, 'reject');
    expect(await waitFor(() => t.runner.count('boss', LOOP_SUBJECT) === 2)).toBe(true); // the cap of 2 was told at v3, the cap of 3 at v4
    write(loopOrg(1));
    t.d.reloadOrgDef(t.name);
    expect(await build(r, 5)).toMatchObject({ ok: false, code: 'LOOP_EXHAUSTED' });
    // a lowered cap owes the notice for the rejection that is already committed (under a cap of 1 the loop was spent at v2)
    expect(await waitFor(() => t.runner.count('boss', LOOP_SUBJECT) === 3)).toBe(true);
  }, 30_000);
});

describe('stop and resume', () => {
  it('a notice not delivered before the stop is sent once after the resume; one the recipients have seen is never sent again', async () => {
    const raw = loopOrg(2);
    const first = await start(raw);
    first.docs.notices!.setEnabledForTest(false); // everything the engine owes stays undelivered: the process "died" after the commit
    const r = await roles(first);
    await build(r, 1);
    await review(r, 1, 'reject');
    await build(r, 2);
    await review(r, 2, 'reject');
    await build(r, 3);
    await review(r, 3, 'reject');
    await first.d.stopOrg(raw.name);

    const runner = new ScriptRunner();
    const again = await start(raw, runner, true);
    expect(again.running.run).toBe(first.running.run);
    expect(await waitFor(() => runner.count('boss', LOOP_SUBJECT) === 1)).toBe(true);
    await again.docs.notices!.idle();
    expect(await waitFor(() => runner.count('dev-lead', LOOP_SUBJECT) === 1 && runner.count('qa-lead', LOOP_SUBJECT) === 1)).toBe(true);
    // the freeze is derived from the replayed log: the producer is refused straight after the resume
    const coder = await runner.toolsOf(again.d, raw.name, 'coder');
    expect(await callTool(coder, 'org_doc_publish', { type: 'build', body: SUMMARY('after resume'), supersedes: 'build-1@v3' })).toMatchObject({ ok: false, code: 'LOOP_EXHAUSTED' });
    // the root and the leads read the document: they have seen their notice
    for (const role of ['boss', 'dev-lead', 'qa-lead']) {
      const tools = await runner.toolsOf(again.d, raw.name, role);
      await callTool(tools, 'org_doc_read', { id: 'build-1', version: 3 });
    }
    await again.d.stopOrg(raw.name);

    const third = new ScriptRunner();
    const last = await start(raw, third, true);
    await last.docs.notices!.idle();
    await new Promise((x) => setTimeout(x, 200));
    for (const role of ['boss', 'dev-lead', 'qa-lead']) expect(third.count(role, LOOP_SUBJECT), role).toBe(0);
    const j = readFileSync(join(last.docs.dir, 'notices.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(j.filter((x) => x.t === 'delivered' && String(x.key).startsWith('l:'))).toHaveLength(3);
  }, 60_000);
});

describe('at org start', () => {
  it('an undeclared cycle between sections is refused, naming both sections', async () => {
    const raw = loopOrg(null);
    write(raw);
    const d = new OrgDaemon(root, { runner: new ScriptRunner(), forward: false, stopWaitMs: 100 });
    daemons.push(d);
    await expect(d.startOrg(raw.name, undefined, { evalGate: true })).rejects.toThrow(
      /sections "development", "qa" hand documents around a cycle .* and no loop declares it/,
    );
  });

  it('a declared loop starts, with the enforcement installed', async () => {
    const t = await start(loopOrg(4));
    expect(t.docs.loopReport()).toEqual([]);
    const r = await roles(t);
    await build(r, 1);
    expect(t.docs.loopReport()[0]).toMatchObject({ rounds: 0, max_rounds: 4, exhausted: false });
  }, 30_000);
});
