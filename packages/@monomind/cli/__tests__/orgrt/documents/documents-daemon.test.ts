// P3.6: the document tools through a real OrgDaemon started through the eval gate (P3.3) with a scripted runner
// (no model). The test calls the very tool handlers the daemon built for each role session.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import { CaptureRunner, callTool } from '../support/doc-runner.js';
import { FINDINGS, SOURCE, findingsOrg, sweepOrg } from '../support/doc-defs.js';

let root: string;
const daemons: OrgDaemon[] = [];
const DOC_TOOLS = ['org_doc_list', 'org_doc_read', 'org_doc_publish', 'org_doc_decide'];

const saved = { ...process.env };
beforeEach(() => {
  // lazy role spawns are staggered and memory-gated on a real host; a test waits for neither
  process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
  process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
  root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'doc-daemon-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
});
afterEach(async () => {
  await Promise.all(daemons.splice(0).map((d) => d.stopAll().catch(() => {})));
  rmSync(root, { recursive: true, force: true });
  process.env.MONOMIND_SPAWN_STAGGER_MS = saved.MONOMIND_SPAWN_STAGGER_MS;
  process.env.MONOMIND_MIN_FREE_MEM_MB = saved.MONOMIND_MIN_FREE_MEM_MB;
  if (saved.MONOMIND_SPAWN_STAGGER_MS === undefined) delete process.env.MONOMIND_SPAWN_STAGGER_MS;
  if (saved.MONOMIND_MIN_FREE_MEM_MB === undefined) delete process.env.MONOMIND_MIN_FREE_MEM_MB;
});

async function start(raw: Record<string, any>, runner = new CaptureRunner(), resume = false) {
  writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
  const d = new OrgDaemon(root, { runner, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
  daemons.push(d);
  const running = await d.startOrg(raw.name, undefined, {
    ...(raw.sections ? { evalGate: true } : {}),
    ...(resume ? { resume: true } : {}),
  });
  const tools = (role: string) => runner.toolsOf(d, raw.name, role);
  return { d, running, runner, tools };
}

describe('a sections org through the eval gate', () => {
  it('creates the runtime and docs/<run> at start, and every role gets the same four tools last', async () => {
    const { running, tools } = await start(findingsOrg({ qa: true }));
    expect(running.documents).toBeDefined();
    expect(running.documents?.dir).toBe(join(root, '.monomind/orgs/sec-org/docs', running.run));
    expect(existsSync(join(running.documents!.dir, 'contracts'))).toBe(true);
    const lists: string[][] = [];
    for (const role of ['boss', 'researcher', 'dev-lead', 'coder', 'observer']) {
      const t = await tools(role);
      if (role !== 'boss') lists.push(t.map((x) => x.name)); // the coordinator also has the task and completion tools
      expect(t.slice(-4).map((x) => x.name), role).toEqual(DOC_TOOLS);
    }
    expect(new Set(lists.map((l) => l.join(','))).size).toBe(1);
  });

  it('publish, read and decide end to end, with the read events and refusals', async () => {
    const { running, tools } = await start(findingsOrg({ qa: true }));
    const researcher = await tools('researcher');
    const devLead = await tools('dev-lead');
    const qaLead = await tools('qa-lead');
    const coder = await tools('coder');
    const observer = await tools('observer');

    const pub = await callTool(researcher, 'org_doc_publish', { type: 'findings', body: FINDINGS, evidence: SOURCE });
    expect(pub).toMatchObject({ ok: true, ref: 'findings-1@v1', status: 'pending' });
    expect(await callTool(observer, 'org_doc_read', { id: 'findings-1' })).toMatchObject({ ok: false, code: 'ACCESS_READ' });
    expect(await callTool(coder, 'org_doc_read', { id: 'findings-1' })).toMatchObject({ ok: false, code: 'NOT_ACCEPTED_YET' });
    expect(await callTool(coder, 'org_doc_publish', { type: 'findings', body: FINDINGS, evidence: SOURCE })).toMatchObject({
      ok: false,
      code: 'ACCESS_PUBLISH',
    });
    const read = await callTool(devLead, 'org_doc_read', { id: 'findings-1' });
    expect(read).toMatchObject({ ok: true, body: FINDINGS, status: 'pending' });
    expect(await callTool(coder, 'org_doc_decide', { id: 'findings-1', version: 1, decision: 'accept' })).toMatchObject({
      ok: false,
      code: 'ACCESS_DECIDE',
    });
    expect(await callTool(devLead, 'org_doc_decide', { id: 'findings-1', version: 1, decision: 'accept' })).toMatchObject({
      ok: true,
      status: 'pending',
      waiting_on: ['qa'],
    });
    // a decider that has not read the version is refused (P3.16b), then reads and decides
    expect(await callTool(qaLead, 'org_doc_decide', { id: 'findings-1', version: 1, decision: 'accept' })).toMatchObject({
      ok: false,
      code: 'UNREAD_PARTS',
    });
    await callTool(qaLead, 'org_doc_read', { id: 'findings-1' });
    expect(await callTool(qaLead, 'org_doc_decide', { id: 'findings-1', version: 1, decision: 'accept' })).toMatchObject({
      ok: true,
      status: 'accepted',
    });
    expect(await callTool(coder, 'org_doc_read', { id: 'findings-1' })).toMatchObject({ ok: true, status: 'accepted' });

    const events = readFileSync(join(running.documents!.dir, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(events.map((e) => e.type)).toEqual(['published', 'read', 'decided', 'read', 'decided', 'read']);
    expect(events.filter((e) => e.type === 'read').map((e) => e.by)).toEqual(['dev-lead', 'qa-lead', 'coder']);
  });

  it('a sweep-3 shaped org: eight producers, the synthesiser reads and decides each of its eight documents', async () => {
    const { running, tools } = await start(sweepOrg());
    expect(running.documents?.store.contracts()).toHaveLength(8);
    const w1 = await tools('worker-1');
    const w2 = await tools('worker-2');
    const syn = await tools('synthesiser');
    const listed = await callTool(w1, 'org_doc_list');
    expect(listed.types.map((t: any) => t.type)).toEqual(['module-sheets-w1']);
    expect(await callTool(w2, 'org_doc_publish', { type: 'module-sheets-w1', body: {} })).toMatchObject({ ok: false, code: 'ACCESS_PUBLISH' });
    expect((await callTool(syn, 'org_doc_list')).types).toHaveLength(8);
  });

  it('resume reopens the store: the derived state is the replayed log', async () => {
    const raw = findingsOrg();
    const first = await start(raw);
    const researcher = await first.tools('researcher');
    await callTool(researcher, 'org_doc_publish', { type: 'findings', body: FINDINGS, evidence: SOURCE });
    const run = first.running.run;
    const before = first.running.documents!.store.list();
    await first.d.stopOrg(raw.name);
    expect(first.running.documents?.closed).toBe(true);
    const again = await start(raw, new CaptureRunner(), true);
    expect(again.running.run).toBe(run);
    expect(again.running.documents?.store.list()).toEqual(before);
    const t = await again.tools('researcher');
    expect(await callTool(t, 'org_doc_publish', { type: 'findings', body: { summary: 'second' }, evidence: SOURCE, supersedes: 'findings-1@v1' })).toMatchObject({
      ok: true,
      ref: 'findings-1@v2',
    });
  });

  it('stop closes the runtime: a tool handler built earlier refuses and writes nothing', async () => {
    const { d, running, tools } = await start(findingsOrg());
    const researcher = await tools('researcher');
    await d.stopOrg('sec-org');
    const seq = running.documents!.store.info().seq;
    const r = await callTool(researcher, 'org_doc_publish', { type: 'findings', body: FINDINGS, evidence: SOURCE });
    expect(r).toMatchObject({ ok: false, code: 'RUNTIME_CLOSED' });
    expect(running.documents!.store.info().seq).toBe(seq);
  });

  it('a definition the contract dialect refuses fails the start and leaves nothing running', async () => {
    const raw = findingsOrg();
    raw.documents.findings.schema = { type: 'object', patternProperties: {} };
    writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
    const d = new OrgDaemon(root, { runner: new CaptureRunner(), forward: false, stopWaitMs: 100 });
    daemons.push(d);
    await expect(d.startOrg(raw.name, undefined, { evalGate: true })).rejects.toThrow(/findings/);
    expect(d.getOrg(raw.name)).toBeUndefined();
  });
});

describe('an org without sections', () => {
  const legacy = () => {
    const raw = findingsOrg();
    for (const k of ['sections', 'documents', 'requires']) delete raw[k];
    delete raw.run_config.experimental;
    delete raw.run_config.completion;
    return raw;
  };

  it('has no documents runtime, no docs directory and none of the org_doc_* tools', async () => {
    const { running, tools } = await start(legacy());
    expect(running.documents).toBeUndefined();
    expect('documents' in running).toBe(false);
    const names = (await tools('researcher')).map((t) => t.name);
    expect(names.filter((n) => n.startsWith('org_doc'))).toEqual([]);
    expect(existsSync(join(root, '.monomind/orgs/sec-org/docs'))).toBe(false);
    expect(readdirSync(join(root, '.monomind/orgs/sec-org')).includes('docs')).toBe(false);
  });
});
