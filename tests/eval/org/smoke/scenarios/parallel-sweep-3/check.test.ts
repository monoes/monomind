// parallel-sweep-3 kit, part 2: check() keeps the parallel-sweep-2 33-unit verdict and adds the hand-off decision measures
// under `handoff` for a trial that has a store; check.mjs leaves both in units.json; pilotRow reports them. No model is called.
// @ts-nocheck: plain .mjs modules and fixture scripts

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { referenceDeliverables } from '../../../fixtures/parallel-sweep-2/hidden/reference/write-answers.mjs';
import { faultInjector, planFaults } from '../../../pilot/fault-injection.js';
import { pilotRow } from '../../../pilot/report.js';
import { HandoffStore } from '../../../pilot/store.js';
import { checkTrial } from '../../check.mjs';
import { buildInputs as buildBase } from '../../prepare.mjs';
import { check, id } from './kit.mjs';

const scratch = (p: string) => realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), p)));
let tmp: string;
let base: string;
let pilot: any;
beforeAll(async () => {
  tmp = scratch('sweep3-check-');
  base = join(tmp, 'base');
  await buildBase({ scenario: id, base });
  pilot = JSON.parse(
    readFileSync(new URL('../../../pilot/parallel-sweep-3.pilot.json', import.meta.url), 'utf8'),
  );
});
afterAll(() => {
  spawnSync('chmod', ['-R', 'u+w', tmp]);
  rmSync(tmp, { recursive: true, force: true });
});
const inputs = () => join(base, 'inputs', id);
const truth = () => JSON.parse(readFileSync(join(inputs(), 'truth.json'), 'utf8'));

/** A finished trial root: the reference deliverables in workspace/out, trial.json and (optionally) a hand-off store. */
function root(o: {
  variant?: string;
  arm: 'baseline' | 'treatment';
  store?: (s: HandoffStore) => void;
}) {
  const r = scratch('sweep3-root-');
  const name = `smoke-${id}-phase2-p1${o.arm === 'baseline' ? 'b' : 't'}`;
  const ws = join(r, 'workspace');
  mkdirSync(join(ws, 'out'), { recursive: true });
  if (o.variant)
    for (const [p, doc] of Object.entries(referenceDeliverables(truth(), o.variant))) {
      mkdirSync(dirname(join(ws, 'out', p)), { recursive: true });
      writeFileSync(join(ws, 'out', p), JSON.stringify(doc));
    }
  writeFileSync(
    join(r, 'trial.json'),
    JSON.stringify({
      name,
      scenario: id,
      contender: 'phase2',
      guard: [inputs()],
      allocationUsd: 34,
      runners: {},
      pilot: { arm: o.arm, id: pilot.id },
    }),
  );
  if (o.store) {
    const plan = planFaults(
      20261004,
      pilot.contracts.map((c) => c.id),
    );
    const s = new HandoffStore(
      join(r, 'pilot-state'),
      pilot.contracts,
      undefined,
      faultInjector(plan),
    );
    o.store(s);
  }
  return r;
}
const sheets = (k: number) =>
  [4 * k - 3, 4 * k - 2, 4 * k - 1, 4 * k].map((i) => ({
    module: `m${i}`,
    answers: Object.entries(truth().modules[`m${i}`]).map(([q, t]: [string, any]) => ({
      q,
      value: t.value,
      files: t.files,
    })),
  }));
const publishAll = (s: HandoffStore) => {
  for (let k = 1; k <= 8; k++)
    s.publish(`worker-${k}`, `module-sheets-w${k}`, { worker: `worker-${k}`, sheets: sheets(k) });
};

describe('check(): the sweep-2 verdict, then the hand-off measures', () => {
  it('33 units and the delivered count are the parallel-sweep-2 ones (complete: 33 of 33; nothing written: 0 of 33)', async () => {
    const r = root({ variant: 'complete', arm: 'baseline' });
    const u = await check({ root: r, workspace: join(r, 'workspace'), inputs: inputs() });
    expect(u).toHaveLength(33);
    expect([u.delivered, u.total, u.summary.sheets_exact, u.summary.synthesis_accepted]).toEqual([
      33,
      33,
      32,
      true,
    ]);
    const e = root({ arm: 'baseline' });
    expect(
      (await check({ root: e, workspace: join(e, 'workspace'), inputs: inputs() })).delivered,
    ).toBe(0);
  });

  it('a baseline trial has no hand-off store: handoff.present is false; a call without a root says the same', async () => {
    const r = root({ variant: 'complete', arm: 'baseline' });
    expect(
      (await check({ root: r, workspace: join(r, 'workspace'), inputs: inputs() })).handoff,
    ).toEqual({ present: false });
    expect((await check({ workspace: join(r, 'workspace'), inputs: inputs() })).handoff).toEqual({
      present: false,
    });
  });

  it('a treatment trial with a store: the injected faults, the decisions (all accepted) and the files-based verdict are separate', async () => {
    const r = root({
      variant: 'complete',
      arm: 'treatment',
      store: (s) => {
        publishAll(s);
        for (let k = 1; k <= 8; k++) s.decide('synthesiser', `module-sheets-w${k}`, 1, 'accept');
      },
    });
    const u = await check({ root: r, workspace: join(r, 'workspace'), inputs: inputs() });
    expect(u.delivered).toBe(33); // the files are what is scored: correct whatever the documents hold
    expect(u.handoff).toMatchObject({
      present: true,
      injected: 4,
      caught: 0,
      missed: 4,
      final_accepted_docs: 8,
      final_accepted_correct: 4,
      final_accepted_corrupted: 4,
    });
  });

  it('check.mjs writes the hand-off measures into units.json next to delivered, and pilotRow reports them with the calls per role', async () => {
    const r = root({
      variant: 'complete',
      arm: 'treatment',
      store: (s) => {
        publishAll(s);
        s.read('synthesiser', 'module-sheets-w1');
        s.decide('synthesiser', 'module-sheets-w1', 1, 'reject', 'm1 q01 is wrong');
      },
    });
    await checkTrial(r);
    const units = JSON.parse(readFileSync(join(r, 'units.json'), 'utf8'));
    expect(units.delivered).toBe(33);
    expect(units.handoff.present).toBe(true);
    expect(units.handoff.calls.synthesiser).toMatchObject({
      read: { ok: 1, refused: 0 },
      decide: { ok: 1, refused: 0 },
    });
    // the pilot report: counts per consumer and the decision measures
    mkdirSyncRun(r);
    const row = pilotRow(r);
    expect(row.arm).toBe('treatment');
    expect(row.handoffByRole.synthesiser).toEqual({
      read: { ok: 1, refused: 0 },
      decide: { ok: 1, refused: 0 },
    });
    expect(row.handoffByRole['worker-1'].publish).toEqual({ ok: 1, refused: 0 });
    expect(row.decisions).toMatchObject({ injected: 4, present: true });
    expect(row.handoff).toMatchObject({ read: { ok: 1 }, decide: { ok: 1 }, publish: { ok: 8 } });
  });

  it('a baseline pilotRow has handoffByRole empty and no decisions', async () => {
    const r = root({ variant: 'complete', arm: 'baseline' });
    await checkTrial(r);
    mkdirSyncRun(r);
    const row = pilotRow(r);
    expect(row.handoffByRole).toEqual({});
    expect(row.decisions).toBeUndefined();
  });
});

/** trialRow reads a run directory under .monomind/orgs/<name>/run-*: an empty one is enough here. */
function mkdirSyncRun(r: string) {
  const t = JSON.parse(readFileSync(join(r, 'trial.json'), 'utf8'));
  mkdirSync(join(r, '.monomind/orgs', t.name, 'run-1'), { recursive: true });
}
