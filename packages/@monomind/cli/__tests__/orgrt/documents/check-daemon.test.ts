// P3.11: org_doc_check through a real OrgDaemon started through the eval gate (P3.3) with a scripted runner (no
// model). The test calls the very tool handlers the daemon built for each role session: the producers publish a
// faulted sheet, the consumer reads, checks, and rejects the flagged document and accepts the clean one; the call
// record is in the run's documents directory. Orgs without declared checks, and sections-off orgs, have no tool.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import { DOCS, honestDoc, sweepChecksOrg, worker } from '../support/check-defs.js';
import { CaptureRunner, callTool, readAllParts } from '../support/doc-runner.js';
import { findingsOrg, role } from '../support/doc-defs.js';

let root: string;
const daemons: OrgDaemon[] = [];
const saved = { ...process.env };
beforeEach(() => {
  process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
  process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
  root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'check-daemon-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
});
afterEach(async () => {
  await Promise.all(daemons.splice(0).map((d) => d.stopAll().catch(() => {})));
  rmSync(root, { recursive: true, force: true });
  for (const k of ['MONOMIND_SPAWN_STAGGER_MS', 'MONOMIND_MIN_FREE_MEM_MB'])
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});

async function start(raw: Record<string, any>) {
  writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
  const runner = new CaptureRunner();
  const d = new OrgDaemon(root, { runner, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
  daemons.push(d);
  const running = await d.startOrg(raw.name, undefined, { ...(raw.sections ? { evalGate: true } : {}) });
  return { d, running, tools: (r: string) => runner.toolsOf(d, raw.name, r) };
}
const names = (t: { name: string }[]) => t.map((x) => x.name);

describe('registration through the daemon', () => {
  it('every role of an org with declared checks gets org_doc_check, last of the document tools', async () => {
    const { tools } = await start(sweepChecksOrg());
    for (const r of ['worker-1', 'worker-2', 'synthesiser']) {
      const n = names(await tools(r));
      expect(n.slice(-5), r).toEqual(['org_doc_list', 'org_doc_read', 'org_doc_publish', 'org_doc_decide', 'org_doc_check']);
    }
  });

  it('a sections org that declares no checks has no check tool', async () => {
    const { tools } = await start(findingsOrg({ qa: true }));
    const n = names(await tools('researcher'));
    expect(n.filter((x) => x.startsWith('org_doc'))).toEqual(['org_doc_list', 'org_doc_read', 'org_doc_publish', 'org_doc_decide']);
  });

  it('a sections-off org has no document tool and no docs directory', async () => {
    const raw = {
      name: 'plain-org',
      goal: 'plain',
      run_config: { idle_minutes: 0 },
      roles: [role('boss', null), role('dev', 'boss')],
    };
    const { tools, running } = await start(raw);
    expect(names(await tools('dev')).filter((x) => x.startsWith('org_doc'))).toEqual([]);
    expect(running.documents).toBeUndefined();
  });
});

describe('the consumer reads, checks, then decides', () => {
  it('rejects the document the check flags (naming the check), accepts the clean one, and the calls are recorded', async () => {
    const { tools, running } = await start(
      sweepChecksOrg((raw) => {
        raw.roles.push(role('observer', 'lead'));
        raw.sections.watch = { members: ['observer'] };
      }),
    );
    const [flawed, clean] = [DOCS[0], DOCS[1]];
    const bad = honestDoc(flawed);
    bad.sheets[2].answers[4].value += 7; // the value no longer follows from the evidence trace
    const w1 = await tools(worker(flawed));
    const w2 = await tools(worker(clean));
    expect(await callTool(w1, 'org_doc_publish', { type: flawed, body: bad })).toMatchObject({ ok: true });
    expect(await callTool(w2, 'org_doc_publish', { type: clean, body: honestDoc(clean) })).toMatchObject({ ok: true });

    const syn = await tools('synthesiser');
    const idOf = (d: string) => `${d}-1`;
    // read, then check, then decide
    expect(await readAllParts((n, a) => callTool(syn, n, a), { id: idOf(flawed) })).toMatchObject({ ok: true, version: 1 });
    const checked = await callTool(syn, 'org_doc_check', { id: idOf(flawed) });
    expect(checked).toMatchObject({ ok: true, passed: false, flagged_count: 1 });
    expect(checked.flagged[0]).toMatchObject({ q: 'q05' });
    expect(checked.flagged[0].failed[0].check).toBe('value_matches_chain');
    const reject = await callTool(syn, 'org_doc_decide', {
      id: idOf(flawed),
      version: 1,
      decision: 'reject',
      reason: `${checked.flagged[0].answer}: ${checked.flagged[0].failed[0].check} failed`,
    });
    expect(reject).toMatchObject({ ok: true, decision: 'reject', status: 'rejected' });

    expect(await readAllParts((n, a) => callTool(syn, n, a), { id: idOf(clean) })).toMatchObject({ ok: true });
    expect(await callTool(syn, 'org_doc_check', { id: idOf(clean) })).toMatchObject({ ok: true, passed: true });
    expect(await callTool(syn, 'org_doc_decide', { id: idOf(clean), version: 1, decision: 'accept' })).toMatchObject({
      ok: true,
      status: 'accepted',
    });

    // a producer republishes, the fix is checked clean and accepted
    expect(
      await callTool(w1, 'org_doc_publish', { type: flawed, body: honestDoc(flawed), supersedes: `${idOf(flawed)}@v1` }),
    ).toMatchObject({ ok: true, version: 2 });
    expect(await callTool(syn, 'org_doc_check', { id: idOf(flawed) })).toMatchObject({ version: 2, passed: true });

    // a role that may not read it is refused, and that is recorded too
    const obs = await tools('observer');
    expect(await callTool(obs, 'org_doc_check', { id: idOf(flawed) })).toMatchObject({ ok: false, code: 'ACCESS_READ' });

    const file = join(running.documents!.dir, 'checks.jsonl');
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(lines.map((l) => [l.by, l.ok, l.ref ?? l.id, l.flagged ?? null])).toEqual([
      ['synthesiser', true, `${idOf(flawed)}@v1`, 1],
      ['synthesiser', true, `${idOf(clean)}@v1`, 0],
      ['synthesiser', true, `${idOf(flawed)}@v2`, 0],
      ['observer', false, idOf(flawed), null],
    ]);
    expect(running.documents!.checks.counts()).toMatchObject({ calls: 4, ran: 3, refused: 1, calls_flagging: 1, flagged_answers: 1 });
  });
});
