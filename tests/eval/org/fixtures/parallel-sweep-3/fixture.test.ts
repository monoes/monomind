// The parallel-sweep-3 fixture record: it reuses the parallel-sweep-2 corpus, scorer, roster and text, states its changes
// (720 s, the documents text) and its honest weaknesses, and agrees with the pilot manifest, the injector and the kit.
// Nothing of parallel-sweep or parallel-sweep-2 is changed by it (their own fixture tests pin their hashes).
// @ts-nocheck: plain .mjs modules
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FAULT_CLASSES } from '../../pilot/fault-injection.js';
import * as score2 from '../parallel-sweep-2/score.mjs';
import * as score3 from './score.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const load = (p: string) => JSON.parse(readFileSync(join(here, p), 'utf8'));
const rec = load('fixture.json');
const f = rec.fixture;
const f2 = load('../parallel-sweep-2/fixture.json').fixture;
const pilot = load('../../pilot/parallel-sweep-3.pilot.json');
const manifest = load('../../manifests/parallel-sweep-3.json');

describe('parallel-sweep-3 fixture record', () => {
  it('is approved, reuses the sweep-2 corpus (same pinned hash and build) and scorer, and names the cost units', () => {
    expect(rec.status).toMatch(
      /^APPROVED 2026-10-04 by the lead, under the owner's standing instruction/,
    );
    expect(f.status).toMatch(/^APPROVED 2026-10-04/);
    expect(f.pinned_hash).toBe(f2.pinned_hash);
    expect(f2.build.startsWith(f.build)).toBe(true); // the same command (sweep-2's adds a note on the default build)
    expect(f.reuses.pinned_hash).toMatch(
      /no pinned hash of parallel-sweep or parallel-sweep-2 changes/,
    );
    expect(score3.checkDeliverables).toBe(score2.checkDeliverables);
    expect(score3.summarize).toBe(score2.summarize);
    expect(f.deliverables.module_sheet).toBe(f2.deliverables.module_sheet);
    expect(f.workload).toEqual(f2.workload);
    expect(rec.cost_units_note).toMatch(/1\.5x the Sonnet 5\.5 list rates/);
    expect(f.cost_units_note).toBe(rec.cost_units_note);
    expect(rec.cost_units_note).toBe(load('../parallel-sweep-2/fixture.json').cost_units_note);
  });

  it('the common text is the sweep-2 text with only the deadline changed to 720 seconds (twelve minutes)', () => {
    expect(f.tasks.common).toBe(
      f2.tasks.common.replace('600 seconds (ten minutes)', '720 seconds (twelve minutes)'),
    );
    expect(f.tasks.common).not.toMatch(/\b600\b/);
    expect(f.tasks.multi_role).toBe(f2.tasks.multi_role);
    expect(f.wall_deadline_seconds).toBe(720);
    expect(f.wall_deadline_minutes).toBe(12);
    expect(f.wall_deadline_why).toMatch(/297 s/);
    expect(f.wall_deadline_why).toMatch(/660 s/);
    expect(f.tasks.multi_role_documents).toMatch(
      /If a corrected version has not arrived 660 seconds after the start/,
    );
  });

  it('has two arms (no single), the sweep-2 roster, one section per worker pair and the synthesis section for the treatment', () => {
    expect(f.arms.map((a) => a.id)).toEqual(['baseline', 'treatment']);
    const roster = f2.arms[1].roster;
    expect(f.arms[0].roster).toEqual(roster);
    expect(f.arms[1].roster).toEqual(roster);
    expect(f.arms[1].sections).toEqual(f2.arms[2].sections);
    expect(f.arms[0].description).toMatch(/NO fault injection/);
    expect(f.arms[0].responsibilities).toEqual(f2.arms[1].responsibilities);
  });

  it('describes the fault classes of the injector, the seeding, the once-per-document rule and the measures', () => {
    expect(Object.keys(f.fault_injection.classes)).toEqual([...FAULT_CLASSES]);
    expect(f.fault_injection.seed).toMatch(/20261003/);
    expect(f.fault_injection.once).toMatch(/first successful publish only/);
    expect(f.fault_injection.record).toMatch(/`fault` event/);
    expect(f.hand_off_design.only_path).toMatch(/out\/m1 \.\. out\/m32/);
    expect(f.hand_off_design.decision_semantics).toMatch(/NOT notified/);
    expect(f.hand_off_design.consumer_told).toMatch(/does not say which documents are corrupted/);
    expect(f.measures.stop_gate).toMatch(/0 pilot__doc_read calls/);
    for (const m of [
      'caught',
      'missed',
      'false rejects',
      'republish cycles',
      'final accepted',
      'corrupted document',
      'cost split',
    ])
      expect(f.measures.per_trial.join(' ')).toContain(m);
  });

  it('lists the honest weaknesses, including the two the owner asked for', () => {
    const w = f.weaknesses.join('\n');
    expect(w).toMatch(
      /Faults are harness-injected, so this measures the decision path, not natural errors/,
    );
    expect(w).toMatch(/mechanism measurement, not a comparison/);
    expect(w).toMatch(/baseline is a no-fault control/);
    expect(w).toMatch(/cost, time and delivery only/);
    expect(w).toMatch(/primes the synthesiser/);
    expect(w).toMatch(/does not notify a producer/);
    expect(w).toMatch(/Everything not run on a model is unverified/);
    expect(f.weaknesses.length).toBeGreaterThanOrEqual(10);
  });

  it('agrees with the pilot manifest and the scenario manifest (deadline, caps, allocation, seed, classes, attempts)', () => {
    expect(pilot.deadline_seconds).toBe(f.wall_deadline_seconds);
    expect(manifest.qualification.deadline_minutes).toBe(f.wall_deadline_minutes);
    expect(pilot.per_run_allocation_usd).toBe(f.planning_allocation_usd_per_run);
    expect(manifest.cost.planning_allocation_usd).toBe(f.planning_allocation_usd_per_run);
    expect(pilot.org_stop_usd).toBe(f.org_stop_usd);
    expect(pilot.fault_injection.classes).toEqual(Object.keys(f.fault_injection.classes));
    expect(f.fault_injection.seed).toMatch(String(pilot.fault_injection.seed_base));
    expect(f.tasks.multi_role_documents).toMatch(/at most four times/);
    for (const c of pilot.contracts) expect(c.max_attempts).toBe(4);
    expect(manifest.fixture.record).toBe('tests/eval/org/fixtures/parallel-sweep-3/fixture.json');
  });
});
