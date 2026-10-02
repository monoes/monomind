// The analysis plan of a scenario manifest, applied to two arms of runs: every
// figure with its interval, spend over every attempt, and failure (not zero
// cost) for an arm that accepted nothing.
import { describe, expect, it } from 'vitest';
import { type ArmRun, compareArms } from './compare.js';
import type { ScenarioManifest } from './manifest.js';

const manifest = {
  units: [
    { id: 'a', count: 1 },
    { id: 'b', count: 1 },
  ],
} as unknown as ScenarioManifest;
const run = (
  usd: number,
  accepted: Record<string, number>,
  over: Partial<ArmRun> = {},
): ArmRun => ({ usd, accepted, interventions: 0, falseClaims: 0, ...over });

describe('compareArms', () => {
  it('reports per arm the spend, fixture success with its Wilson interval, and pooled cost per accepted unit', () => {
    const r = compareArms(
      manifest,
      [run(2, { a: 1, b: 1 }), run(4, { a: 1 })],
      [run(3, { a: 1, b: 1 }), run(3, { a: 1, b: 1 })],
    );
    expect(r.control).toMatchObject({ runs: 2, completed: 1, accepted_units: 3, spend_total: 6 });
    expect(r.control.cost_per_accepted_unit).toEqual({ value: 2, failed: false });
    expect(r.control.fixture_success.rate).toBe(0.5);
    expect(r.control.fixture_success.lo).toBeLessThan(0.5);
    expect(r.treatment).toMatchObject({ completed: 2, accepted_units: 4 });
    expect(r.treatment.cost_per_accepted_unit.value).toBeCloseTo(1.5);
  });

  it('counts every attempt: a run that accepted nothing still adds its spend', () => {
    const r = compareArms(manifest, [run(5, {}), run(1, { a: 1, b: 1 })], [run(1, { a: 1, b: 1 })]);
    expect(r.control.spend_total).toBe(6);
    expect(r.control.cost_per_accepted_unit.value).toBe(3);
  });

  it('is a failure, not a zero cost, for an arm that accepted nothing', () => {
    const r = compareArms(manifest, [run(4, {}), run(2, {})], [run(1, { a: 1, b: 1 })]);
    expect(r.control.cost_per_accepted_unit).toEqual({ value: null, failed: true });
  });

  it('gives a paired spend difference only for equal run counts, and says how few runs it rests on', () => {
    const paired = compareArms(
      manifest,
      [run(2, { a: 1 }), run(3, { a: 1 }), run(4, { a: 1 })],
      [run(1, { a: 1 }), run(1, { a: 1 }), run(2, { a: 1 })],
    );
    expect(paired.paired_spend_difference?.n).toBe(3);
    expect(paired.paired_spend_difference?.mean).toBeCloseTo(5 / 3);
    const unpaired = compareArms(
      manifest,
      [run(2, { a: 1 })],
      [run(1, { a: 1 }), run(1, { a: 1 })],
    );
    expect(unpaired.paired_spend_difference).toBeNull();
  });

  it('flags a comparison too small to conclude anything', () => {
    const r = compareArms(manifest, [run(2, { a: 1, b: 1 })], [run(1, { a: 1, b: 1 })]);
    expect(r.inconclusive).toBe(true);
    expect(r.notes.join()).toMatch(/runs per arm/);
  });

  it('tallies interventions and false claims per arm', () => {
    const r = compareArms(
      manifest,
      [run(1, {}, { interventions: 2, falseClaims: 3 })],
      [run(1, {}, { interventions: 0, falseClaims: 1 })],
    );
    expect(r.control).toMatchObject({ interventions: 2, false_claims: 3 });
    expect(r.treatment).toMatchObject({ interventions: 0, false_claims: 1 });
  });
});
