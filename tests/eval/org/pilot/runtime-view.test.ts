// P3.15: reading a finished trial's hand-off records (runtime-view.mjs) on fixture trial dirs made by the scripted runs: the
// harness layer reads exactly as before, the runtime layer reads in the same shape, and report.ts, the stage gate and the
// report command read either. No model, no network.
// @ts-nocheck: plain .mjs modules and loosely typed fixtures

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeFiles } from '../../../../packages/@monomind/cli/__tests__/orgrt/documents/e2e/mini-org.js';
import {
  call,
  useWorld,
} from '../../../../packages/@monomind/cli/__tests__/orgrt/documents/e2e/scripted.js';
import { pilotReport, pilotRow } from './report.js';
import {
  honest,
  idOf,
  runHarness,
  runRuntime,
  runtimeMiniDef,
  W1,
} from './runtime-trial-support.js';
import { runtimeDocsDir, trialView } from './runtime-view.mjs';
import { decide, stageOneChecks, stageOneReads } from './stage-gate.mjs';

const world = useWorld('p315-view');
const tmp = (tag: string) => mkdtempSync(join(process.env.TMPDIR ?? '/var/tmp', `${tag}-`));
const NAME = 'smoke-parallel-sweep-3-phase2-p1t-v2r';
const _lines = (f: string) =>
  readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

/** A runtime fixture trial: the miniature's scripted loop, with the trial record and result a real trial leaves. */
async function fixture() {
  const r = await runRuntime(world, undefined, { def: runtimeMiniDef(world.root, { name: NAME }) });
  writeFileSync(
    join(world.root, 'trial.json'),
    JSON.stringify({
      name: NAME,
      scenario: 'parallel-sweep-3',
      contender: 'phase2',
      trial: 'p1t-v2r',
      profile: 'production',
      allocationUsd: 25,
      pilot: { arm: 'treatment', variant: { id: 'v2r', handoff: 'runtime' }, handoff: 'runtime' },
    }),
  );
  writeFileSync(join(world.root, 'result.json'), '{"seconds":10}');
  return r;
}

describe('trialView on the harness layer: what it always read', () => {
  it('returns the events and the store file as written; a trial without a hand-off store is "none"', async () => {
    const h = await runHarness(tmp('p315-vh'));
    const v = trialView(h.w.root);
    expect(v.source).toBe('harness');
    expect(v.events).toEqual(h.w.store.events());
    expect(v.state).toEqual(
      JSON.parse(readFileSync(join(h.w.root, 'pilot-state/pilot-store.json'), 'utf8')),
    );
    expect(v.faultRecord).toBe(true); // the harness's own record is what its fault measures read
    expect(trialView(tmp('p315-empty')).source).toBe('none'); // a baseline trial
    const emptyState = tmp('p315-empty2');
    mkdirSync(join(emptyState, 'pilot-state'), { recursive: true });
    expect(trialView(emptyState).source).toBe('none'); // a state directory with nothing in it
  }, 30000);
});

describe('trialView on the runtime layer', () => {
  it("derives the prototype's events and versions from the event log, the delivery journal and the check journal", async () => {
    await fixture();
    const v = trialView(world.root);
    expect(v.source).toBe('runtime');
    expect(v.faultRecord).toBe(false);
    const kinds = (k: string) => v.events.filter((e) => e.kind === k);
    expect(
      kinds('publish')
        .map((e) => `${e.ok}:${e.role}:${e.doc}:${e.version ?? ''}`)
        .sort(),
    ).toEqual([
      'false:worker-2:module-sheets-w2:', // the consistency refusal
      'true:worker-1:module-sheets-w1:1',
      'true:worker-1:module-sheets-w1:2',
      'true:worker-1:module-sheets-w1:3',
      'true:worker-2:module-sheets-w2:1',
      'true:worker-2:module-sheets-w2:2',
      'true:worker-3:module-sheets-w3:1',
    ]);
    const refused = kinds('publish').find((e) => !e.ok);
    expect(refused.detail).toMatch(/^consistency: DELIVERABLE_MISMATCH/);
    expect(refused.file).toBe('out/m6/answers.json'); // the file the refusal names, as the prototype's event does
    expect(
      kinds('decide')
        .filter((e) => e.ok)
        .map((e) => e.detail)
        .sort(),
    ).toEqual(['accept', 'accept', 'accept', 'reject', 'reject', 'reject']);
    const check = JSON.parse(kinds('check')[0].detail);
    expect(Object.keys(check).sort()).toEqual(['answers', 'by_check', 'flagged']);
    expect(Object.values(check.by_check).every((n) => n > 0)).toBe(true); // failing checks only, as the prototype lists them
    const relays = kinds('relay').map((e) => JSON.parse(e.detail));
    expect(relays.map((r) => `${r.to_kind}:${r.reason}`).sort()).toEqual(
      Array(3).fill('lead:rejected').concat(Array(3).fill('producer:rejected')).sort(),
    );
    expect(
      kinds('notice')
        .map((e) => JSON.parse(e.detail).kind)
        .sort(),
    ).toEqual(['all-available', ...Array(6).fill('published')]);
    expect(v.state.versions[W1].map((x) => `${x.version}:${x.status}:${x.by}`)).toEqual([
      '1:rejected:worker-1',
      '2:rejected:worker-1',
      '3:accepted:worker-1',
    ]);
    expect(v.state.versions[W1][0].decisions.synthesiser).toMatchObject({ decision: 'reject' });
    expect(v.state.versions[W1][2].content.worker).toBe('worker-1'); // the body itself, not the stored file's wrapper
    expect(v.events.map((e) => e.at)).toEqual([...v.events.map((e) => e.at)].sort());
  }, 60000);

  it('ignores a torn final line of any journal, as the runtime does', async () => {
    await fixture();
    const before = trialView(world.root);
    const dir = runtimeDocsDir(world.root);
    for (const f of ['events.jsonl', 'notices.jsonl', 'checks.jsonl'])
      appendFileSync(join(dir, f), '{"seq":99,"typ');
    const after = trialView(world.root);
    expect(after.events.length).toBe(before.events.length);
    expect(after.state).toEqual(before.state);
  }, 60000);

  it('keys a document by its id when a type has several (a publish that did not name its head opens a second document)', async () => {
    const { Scripted } = await import(
      '../../../../packages/@monomind/cli/__tests__/orgrt/documents/e2e/scripted.js'
    );
    const { setOrgSignatureEnforcement } = await import(
      '../../../../packages/@monomind/cli/src/orgrt/org-signature-enforcement.js'
    );
    setOrgSignatureEnforcement(false);
    const runner = new Scripted();
    const { d, name } = await world.start(runtimeMiniDef(world.root), { runner });
    const w1 = await runner.toolsOf(d, name, 'worker-1');
    writeFiles(join(world.root, 'workspace'), honest(W1));
    expect(await call(w1, 'org_doc_publish', { type: W1, body: honest(W1) })).toMatchObject({
      ok: true,
      id: idOf(W1),
    });
    expect(
      await call(w1, 'org_doc_publish', {
        type: W1,
        body: { ...honest(W1) },
        supersedes: `${idOf(W1)}@v1`,
      }),
    ).toMatchObject({ ok: true, version: 2 });
    expect(Object.keys(trialView(world.root).state.versions)).toEqual([W1]);
    const body = honest(W1);
    body.sheets[0].answers[0].value += 1;
    body.sheets[0].answers[0].evidence[0].out += 1;
    writeFiles(join(world.root, 'workspace'), body);
    expect(await call(w1, 'org_doc_publish', { type: W1, body })).toMatchObject({
      ok: true,
      id: `${W1}-2`,
    });
    expect(Object.keys(trialView(world.root).state.versions).sort()).toEqual([idOf(W1), `${W1}-2`]);
  }, 60000);
});

describe('report.ts and the report command on a runtime trial', () => {
  it('pilotRow reads the runtime records: counts per tool and per role, relays, the layer and the variant', async () => {
    await fixture();
    const row = pilotRow(world.root);
    expect(row).toMatchObject({
      arm: 'treatment',
      n: 1,
      variant: 'v2r',
      handoffLayer: 'runtime',
      interrupted: false,
    });
    expect(row.handoff).toMatchObject({
      publish: { ok: 6, refused: 1 },
      decide: { ok: 6, refused: 0 },
      check: { ok: 6, refused: 0 },
      relays: 6,
      sendRefused: 0,
    });
    expect(row.handoff.read.refused).toBe(0);
    expect(row.handoffByRole['worker-2'].publish).toEqual({ ok: 2, refused: 1 });
    expect(row.handoffByRole.synthesiser.decide).toEqual({ ok: 6, refused: 0 });
    expect(row.handoffByRole.synthesiser.read.ok).toBe(row.handoff.read.ok);
    const report = pilotReport([row]);
    const pair = report.scenarios[0].pairs[0];
    expect(pair.treatmentV2r.name).toBe(NAME);
    expect(pair.treatmentV2).toBeUndefined();
    expect(pair.incomplete).toBe(true);
    expect(pair.reasons.join(' ')).toContain('a variant trial only (v2r)');
  }, 60000);

  it('the report command prints the runtime variant with its faults as n/a', async () => {
    await fixture();
    const cli = join(__dirname, 'report.cli.ts');
    const out = spawnSync('npx', ['tsx', cli, world.root], {
      encoding: 'utf8',
      cwd: join(__dirname, '../../../..'),
    });
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('treatment v2r (runtime tools)');
    expect(out.stdout).toMatch(/doc_check 6\/0 {2}relays 6/);
    const json = JSON.parse(
      spawnSync('npx', ['tsx', cli, world.root, '--json'], {
        encoding: 'utf8',
        cwd: join(__dirname, '../../../..'),
      }).stdout,
    );
    expect(json.scenarios[0].pairs[0].treatmentV2r.handoffLayer).toBe('runtime');
  }, 90000);
});

describe('the stage gate counts the runtime records', () => {
  const pilot = JSON.parse(readFileSync(join(__dirname, 'parallel-sweep-3.pilot.json'), 'utf8'));
  const env = { PILOT_OWNER_DECISION: 'handoff-relay-consistency-check handoff-runtime-port' };

  it("v2r x2 is allowed from the synthesiser's runtime reads and checks in the stage 1 v2r trial; refused without them", async () => {
    await fixture();
    const base = tmp('p315-gate');
    cpSync(world.root, join(base, 'trials', NAME), { recursive: true });
    const reads = stageOneReads(base, 'parallel-sweep-3', 'v2r');
    const checks = stageOneChecks(base, 'parallel-sweep-3', 'v2r');
    expect(reads).toBeGreaterThanOrEqual(6);
    expect(checks).toBe(6);
    expect(
      decide({ pilot, arm: 'treatment', n: 2, variant: 'v2r', reads, checks, env }),
    ).toMatchObject({ allowed: true });
    expect(
      decide({ pilot, arm: 'treatment', n: 2, variant: 'v2r', reads, checks: 0, env }).reason,
    ).toMatch(/0 successful doc_check calls/);
    expect(
      decide({ pilot, arm: 'treatment', n: 2, variant: 'v2r', reads: 0, checks, env }).reason,
    ).toMatch(/0 successful doc_read calls/);
    expect(
      decide({
        pilot,
        arm: 'treatment',
        n: 2,
        variant: 'v2r',
        reads,
        checks,
        env: { PILOT_OWNER_DECISION: 'handoff-relay-consistency-check' },
      }).allowed,
    ).toBe(false);
    // the harness variant of the same scenario still counts its own trials only (p1t-v2 is not p1t-v2r)
    expect(stageOneReads(base, 'parallel-sweep-3', 'v2')).toBeUndefined();
  }, 60000);
});
