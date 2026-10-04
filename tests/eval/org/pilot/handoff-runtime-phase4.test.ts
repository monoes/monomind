// P4.13: eval-tree parity for the Phase 4 keys, the read side. Scripted, no daemon, no model: runtime records written by hand
// (phase4-records-support.ts) are read by the view (runtime-view.mjs), the report row (report.ts) and the hand-off metrics
// (fixtures/parallel-sweep-3/handoff-metrics.mjs).
//  1. A trial with only the records Phase 3 leaves reads exactly as it did before P4.13: pinned by
//     fixtures/handoff-runtime-phase3-records.json, captured BEFORE the Phase 4 reader was written (re-capture, only after a
//     deliberate change: PILOT_RECAPTURE_GOLDEN=1).
//  2. The same trial plus the Phase 4 records: the Phase 3 part of every output is unchanged, and a `phase4` block appears with
//     the counts of the records that exist (and only of those).
// What this does not show, on purpose: the harness (the prototype store) has no Phase 4 behaviour, so a harness trial never has
// these records; Phase 4 is runtime-only. See docs/mastermind/pilot/2026-10-04-phase4-runtime-notes.md.
// @ts-nocheck: plain .mjs modules and loosely typed fixtures
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { handoffMetrics } from '../fixtures/parallel-sweep-3/handoff-metrics.mjs';
import { addPhase4Records, ORG, phase3Root, truth } from './phase4-records-support.js';
import { pilotRow } from './report.js';
import { trialView } from './runtime-view.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(here, 'fixtures/handoff-runtime-phase3-records.json');

function withTrialFiles(root: string) {
  writeFileSync(
    join(root, 'trial.json'),
    JSON.stringify({
      name: ORG,
      scenario: 'parallel-sweep-3',
      contender: 'phase2',
      trial: 'p1t-v2r',
      profile: 'production',
      allocationUsd: 25,
      pilot: { arm: 'treatment', variant: { id: 'v2r', handoff: 'runtime' }, handoff: 'runtime' },
    }),
  );
  writeFileSync(join(root, 'result.json'), '{"seconds":10}');
  return root;
}
const read = (root: string) => {
  const row = pilotRow(root);
  return {
    view: trialView(root),
    metrics: handoffMetrics({ root, truth: truth() }),
    handoff: row.handoff,
    handoffByRole: row.handoffByRole,
  };
};
const without = <T extends object>(o: T, key: string) => {
  const { [key]: _gone, ...rest } = o as any;
  return rest;
};
const plain = (x: unknown) => JSON.parse(JSON.stringify(x));

describe('a runtime trial with only the Phase 3 records', () => {
  const root = withTrialFiles(phase3Root('p413-p3'));
  const got = read(root);

  it('reads exactly as it did before the Phase 4 reader existed (golden)', () => {
    if (process.env.PILOT_RECAPTURE_GOLDEN === '1')
      writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`);
    expect(existsSync(GOLDEN)).toBe(true);
    expect(plain(got)).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
  });

  it('has no phase4 key anywhere: absent records change nothing', () => {
    expect('phase4' in got.view).toBe(false);
    expect('phase4' in got.metrics).toBe(false);
    expect('phase4' in got.handoff).toBe(false);
    expect(got.view.events.some((e) => e.kind === 'escalation')).toBe(false);
  });

  it('is unchanged by empty Phase 4 files (a record that exists with nothing in it counts nothing)', () => {
    const r = withTrialFiles(phase3Root('p413-empty'));
    const docs = join(r, '.monomind/orgs', ORG, 'docs/run-a');
    for (const f of ['budget-notices.jsonl', 'part-reads.jsonl']) writeFileSync(join(docs, f), '');
    expect(plain(read(r))).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
  });
});

describe('the same trial with the records of the Phase 4 keys', () => {
  const root = withTrialFiles(phase3Root('p413-p4'));
  addPhase4Records(root);
  const got = read(root);
  const golden = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : undefined; // absent only while capturing
  const P4 = {
    budget_notices: { warnings: 1, closures: 1, delivered: 3, failed: 1 },
    rework_exhausted: { cycles: 1, notices: 3 },
    loop_exhausted: { loops: 1, notices: 3 },
    part_reads: { calls: 3, documents: 1 },
    writer_refused: { total: 2, by_role: { 'worker-2': 2 } },
    doc_unread: 1,
    lead_notices: { total: 2, silent: 1, not_started: 1 },
  };

  it('exposes the counts of the records that exist, in one phase4 block', () => {
    expect(got.view.phase4).toEqual(P4);
    expect(got.metrics.phase4).toEqual(P4);
    expect(got.handoff.phase4).toEqual(P4);
  });

  it('leaves everything else of the view, the metrics and the counts as the Phase 3 trial had it', () => {
    expect(plain(without(got.metrics, 'phase4'))).toEqual(golden.metrics);
    expect(plain(without(got.handoff, 'phase4'))).toEqual(golden.handoff);
    expect(plain(got.handoffByRole)).toEqual(golden.handoffByRole);
    expect(plain(got.view.state)).toEqual(golden.view.state);
    // the exhaustion notices are escalations, not relays: the relay count of the Phase 3 trial does not move
    const kinds = (k: string) => got.view.events.filter((e) => e.kind === k);
    expect(plain(kinds('relay'))).toEqual(golden.view.events.filter((e) => e.kind === 'relay'));
    const esc = kinds('escalation').map((e) => JSON.parse(e.detail));
    expect(esc.filter((d) => d.kind === 'rework-exhausted')).toHaveLength(3);
    expect(esc.filter((d) => d.kind === 'loop-exhausted')).toHaveLength(3);
    expect(esc.map((d) => d.to).sort()).toEqual([
      'lead',
      'lead',
      'synthesiser',
      'synthesiser',
      'worker-1',
      'worker-1',
    ]);
  });

  it('counts only the families whose records exist', () => {
    const only = withTrialFiles(phase3Root('p413-one'));
    const docs = join(only, '.monomind/orgs', ORG, 'docs/run-a');
    writeFileSync(
      join(docs, 'part-reads.jsonl'),
      `${JSON.stringify({ at: 'x', by: 'a', doc: 'd', version: 1, part: 1, parts: 1 })}\n`,
    );
    const v = trialView(only);
    expect(v.phase4).toEqual({ part_reads: { calls: 1, documents: 1 } });
    expect(handoffMetrics({ root: only, truth: truth() }).phase4).toEqual(v.phase4);
  });

  it('ignores a torn final line, and a bus without the Phase 4 events counts none', () => {
    const r = withTrialFiles(phase3Root('p413-torn'));
    addPhase4Records(r);
    const docs = join(r, '.monomind/orgs', ORG, 'docs/run-a');
    const file = join(docs, 'budget-notices.jsonl');
    writeFileSync(file, `${readFileSync(file, 'utf8')}{"t":"owed","ke`);
    expect(trialView(r).phase4.budget_notices).toEqual(P4.budget_notices);
    rmSync(join(r, '.monomind/orgs', ORG, 'run-1/bus.jsonl'));
    const v = trialView(r).phase4;
    expect(v.writer_refused).toBeUndefined();
    expect(v.doc_unread).toBeUndefined();
    expect(v.lead_notices).toBeUndefined();
  });
});
