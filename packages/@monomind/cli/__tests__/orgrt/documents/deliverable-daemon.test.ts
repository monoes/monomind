// P3.10: deliverable consistency through the real tool-call path on a real OrgDaemon (sections org through the
// eval gate, scripted runner, no model). The producer writes its files, then publishes; the consumer decides.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import { bindRoleWorkspaces } from '../../../src/orgrt/documents/deliverable-guards.js';
import { sweepOrg } from '../support/doc-defs.js';
import { CaptureRunner, callTool, readAllParts } from '../support/doc-runner.js';

const DOC = 'module-sheets-w1';
const MODS = ['m1', 'm2', 'm3', 'm4'];
let root: string;
const daemons: OrgDaemon[] = [];
const saved = { ...process.env };
beforeEach(() => {
  process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
  process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
  root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'deliv-daemon-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
});
afterEach(async () => {
  await Promise.all(daemons.splice(0).map((d) => d.stopAll().catch(() => {})));
  rmSync(root, { recursive: true, force: true });
  for (const k of ['MONOMIND_SPAWN_STAGGER_MS', 'MONOMIND_MIN_FREE_MEM_MB'])
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});

const sheet = (m: string, bump = 0) => ({
  module: m,
  answers: Array.from({ length: 12 }, (_, i) => ({
    q: `q${String(i + 1).padStart(2, '0')}`,
    value: 100 * Number(m.slice(1)) + i + (i === 3 ? bump : 0),
    files: ['a.js', 'b.js', 'c.js', 'd.js'].map((f) => `${m}/${f}`),
  })),
});
const docBody = (bump = 0) => ({ worker: 'worker-1', sheets: MODS.map((m) => sheet(m, m === 'm2' ? bump : 0)) });
const writeSheet = (dir: string, m: string, bump = 0) => {
  mkdirSync(join(dir, 'out', m), { recursive: true });
  writeFileSync(join(dir, 'out', m, 'answers.json'), JSON.stringify(sheet(m, bump)));
};

function orgDef(over: { workspace?: string; max?: number } = {}) {
  const raw = sweepOrg();
  raw.documents[DOC].deliverable_files = MODS.map((m) => ({
    file: `out/${m}/answers.json`,
    select: { array: 'sheets', key: 'module', value: m },
    compare: ['module', 'answers[].q', 'answers[].value', 'answers[].files'],
  }));
  if (over.max) raw.documents[DOC].max_consistency_refusals = over.max;
  if (over.workspace) raw.run_config.workspace = over.workspace;
  return raw;
}

async function start(raw: Record<string, any>) {
  writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
  const runner = new CaptureRunner();
  const d = new OrgDaemon(root, { runner, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
  daemons.push(d);
  const running = await d.startOrg(raw.name, undefined, { evalGate: true });
  return { d, running, tools: (role: string) => runner.toolsOf(d, raw.name, role) };
}

const publish = (t: any, body: unknown, extra = {}) => callTool(t, 'org_doc_publish', { type: DOC, body, ...extra });

describe('the producer writes its files, then publishes (workspace repo: the run root)', () => {
  it('a matching publish is accepted; a mismatch is refused naming the file and path and uses no attempt; the fix publishes', async () => {
    const { tools } = await start(orgDef());
    const w1 = await tools('worker-1');
    for (const m of MODS) writeSheet(root, m);
    const bad = await publish(w1, docBody(3));
    expect(bad).toMatchObject({ ok: false, code: 'GUARD_REFUSED', guard_code: 'DELIVERABLE_MISMATCH', refusals_left: 4 });
    expect(bad.error).toMatch(/out\/m2\/answers\.json differs from the document's sheets entry m2 at \$\.answers\[3\]\.value: the file has 203, the document has 206/);
    expect(bad.error).not.toContain(root);
    expect(bad).not.toHaveProperty('attempts_left');
    writeSheet(root, 'm2', 3);
    expect(await publish(w1, docBody(3))).toMatchObject({ ok: true, ref: `${DOC}-1@v1`, status: 'pending' });
  });

  it('a producer only sees which files its document must match, in the list; nobody else does', async () => {
    const { tools } = await start(orgDef());
    const listed = await callTool(await tools('worker-1'), 'org_doc_list');
    expect(listed.types[0].files_must_match).toEqual(MODS.map((m) => `out/${m}/answers.json`));
    expect(JSON.stringify(await callTool(await tools('synthesiser'), 'org_doc_list'))).not.toContain('files_must_match');
  });

  it('missing and invalid files are refused; a symlink out of the workspace is refused and not read', async () => {
    const { tools } = await start(orgDef());
    const w1 = await tools('worker-1');
    writeSheet(root, 'm1');
    writeFileSync(join(root, 'out/m1/answers.json'), '{nope');
    const r = await publish(w1, docBody());
    expect(r.error).toMatch(/out\/m1\/answers\.json is not valid JSON/);
    expect(r.error).toMatch(/out\/m2\/answers\.json does not exist/);
    const outside = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'deliv-out-'));
    for (const m of MODS) {
      mkdirSync(join(outside, m), { recursive: true });
      writeFileSync(join(outside, m, 'answers.json'), JSON.stringify(sheet(m)));
    }
    rmSync(join(root, 'out'), { recursive: true, force: true });
    symlinkSync(outside, join(root, 'out'));
    const esc = await publish(w1, docBody());
    expect(esc).toMatchObject({ ok: false, guard_code: 'DELIVERABLE_MISMATCH' });
    expect(esc.error).toMatch(/resolves outside your workspace/);
    rmSync(outside, { recursive: true, force: true });
  });

  it('after max_consistency_refusals the tool fails closed with CONSISTENCY_EXHAUSTED, and no attempt was used', async () => {
    const { tools, running } = await start(orgDef({ max: 2 }));
    const w1 = await tools('worker-1');
    for (const m of MODS) writeSheet(root, m);
    for (let i = 0; i < 2; i++) expect((await publish(w1, docBody(5))).guard_code).toBe('DELIVERABLE_MISMATCH');
    expect(await publish(w1, docBody())).toMatchObject({ ok: false, code: 'CONSISTENCY_EXHAUSTED' });
    expect(running.documents?.store.attempts(DOC)).toMatchObject({ used: 0, refusals_used: 2, refusals_left: 0 });
  });

  it('a retried publish with the same idempotency key replays the committed receipt', async () => {
    const { tools } = await start(orgDef());
    const w1 = await tools('worker-1');
    for (const m of MODS) writeSheet(root, m);
    const first = await publish(w1, docBody(), { idempotency_key: 'same' });
    expect(first.ok).toBe(true);
    writeSheet(root, 'm1', 0);
    expect(await publish(w1, docBody(), { idempotency_key: 'same' })).toMatchObject({ ok: true, ref: first.ref, replayed: true });
  });
});

describe('the consumer decides', () => {
  const id = `${DOC}-1`;
  const decide = async (t: any, version: number, decision = 'accept') => {
    await readAllParts((n, a) => callTool(t, n, a), { id, version }); // org_doc_decide needs every part read (P3.16b)
    return callTool(t, 'org_doc_decide', { id, version, decision, ...(decision === 'reject' ? { reason: 'no' } : {}) });
  };

  it('an accept after a file changed is refused naming file and path; the republish supersedes and is accepted', async () => {
    const { tools } = await start(orgDef());
    const w1 = await tools('worker-1');
    const syn = await tools('synthesiser');
    for (const m of MODS) writeSheet(root, m);
    expect((await publish(w1, docBody())).ok).toBe(true);
    writeSheet(root, 'm3', 9); // the producer's file moves after the publish
    const r = await decide(syn, 1);
    expect(r).toMatchObject({ ok: false, code: 'GUARD_REFUSED', guard_code: 'DELIVERABLE_CHANGED' });
    expect(r.error).toMatch(/deliverable files changed after it was published \(out\/m3\/answers\.json differs from the document's sheets entry m3 at \$\.answers\[3\]\.value/);
    expect((await callTool(syn, 'org_doc_read', { id, version: 1 })).status).toBe('pending');
    const v2 = await publish(w1, { worker: 'worker-1', sheets: MODS.map((m) => sheet(m, m === 'm3' ? 9 : 0)) }, { supersedes: `${id}@v1` });
    expect(v2).toMatchObject({ ok: true, ref: `${id}@v2` });
    expect(await decide(syn, 2)).toMatchObject({ ok: true, status: 'accepted' });
  });

  it('an accept with unchanged files is accepted, and a later file change does not touch the accepted version', async () => {
    const { tools } = await start(orgDef());
    const w1 = await tools('worker-1');
    const syn = await tools('synthesiser');
    for (const m of MODS) writeSheet(root, m);
    await publish(w1, docBody());
    expect(await decide(syn, 1)).toMatchObject({ ok: true, status: 'accepted' });
    writeSheet(root, 'm1', 7);
    const read = await callTool(syn, 'org_doc_read', { id });
    expect(read).toMatchObject({ ok: true, status: 'accepted', version: 1 });
    expect(read.body.sheets[0]).toEqual(sheet('m1'));
  });

  it('a reject works whatever the files say', async () => {
    const { tools } = await start(orgDef());
    const w1 = await tools('worker-1');
    const syn = await tools('synthesiser');
    for (const m of MODS) writeSheet(root, m);
    await publish(w1, docBody());
    writeSheet(root, 'm1', 7);
    expect(await decide(syn, 1, 'reject')).toMatchObject({ ok: true, status: 'rejected' });
  });
});

describe('workspace modes', () => {
  it('isolated: the files are the producer files under the org workspace, not the run root', async () => {
    const { tools } = await start(orgDef({ workspace: 'isolated' }));
    const w1 = await tools('worker-1');
    for (const m of MODS) writeSheet(root, m); // in the root: not where the producer works
    expect((await publish(w1, docBody())).error).toMatch(/out\/m1\/answers\.json does not exist/);
    const ws = join(root, '.monomind/orgs/sweep-org/workspace');
    for (const m of MODS) writeSheet(ws, m);
    expect((await publish(w1, docBody())).ok).toBe(true);
  });

  it('an absolute workspace path is used verbatim', async () => {
    const abs = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'deliv-abs-'));
    const { tools } = await start(orgDef({ workspace: abs }));
    const w1 = await tools('worker-1');
    for (const m of MODS) writeSheet(abs, m);
    expect((await publish(w1, docBody())).ok).toBe(true);
    rmSync(abs, { recursive: true, force: true });
  });

  it('worktree-per-role resolves a role to its session worktree, else its worktree directory, else the shared cwd; the boss keeps the cwd', () => {
    const wt = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'deliv-wt-'));
    const orgRoot = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'deliv-root-'));
    mkdirSync(join(orgRoot, '.monomind/orgs/o/worktree-w2'), { recursive: true });
    let bound: ((r: string) => string | undefined) | undefined;
    const running: any = { def: { run_config: { workspace: 'worktree-per-role' } }, bossRoleId: 'boss', roleSlots: new Map([['w1', { runtime: { worktreePath: wt } }]]) };
    bindRoleWorkspaces({ bindWorkspaces: (f) => (bound = f) }, { workspaceSetting: () => 'worktree-per-role', root: orgRoot } as any, 'o', running, '/shared');
    expect(bound?.('w1')).toBe(wt);
    expect(bound?.('w2')).toBe(join(orgRoot, '.monomind/orgs/o/worktree-w2'));
    expect(bound?.('w3')).toBe('/shared');
    expect(bound?.('boss')).toBe('/shared');
    const repo: any = { def: { run_config: {} }, bossRoleId: 'boss', roleSlots: new Map() };
    bindRoleWorkspaces({ bindWorkspaces: (f) => (bound = f) }, { workspaceSetting: () => 'repo', root: orgRoot } as any, 'o', repo, '/shared');
    expect(bound?.('w2')).toBe('/shared');
  });
});

describe('definitions', () => {
  it('a deliverable path that leaves the workspace fails the start', async () => {
    const raw = orgDef();
    raw.documents[DOC].deliverable_files[0].file = '../escape.json';
    writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
    const d = new OrgDaemon(root, { runner: new CaptureRunner(), forward: false, stopWaitMs: 100 });
    daemons.push(d);
    await expect(d.startOrg(raw.name, undefined, { evalGate: true })).rejects.toThrow(/deliverable_files/);
  });

  it('contracts without deliverable_files behave as after P3.6: no guard is installed', async () => {
    const raw = sweepOrg();
    const { tools, running } = await start(raw);
    const w1 = await tools('worker-1');
    const r = await callTool(w1, 'org_doc_publish', { type: DOC, body: docBody() });
    expect(r).toMatchObject({ ok: true });
    expect((running.documents?.store as any).guards).toHaveLength(0);
  });
});
