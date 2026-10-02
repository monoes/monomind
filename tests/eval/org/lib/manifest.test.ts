// Spec section 10: "No paid gate starts with unspecified fields." A scenario
// manifest fixes, before any paid trial, the required outcome units, the
// rubric and its floors, the qualification contract and the analysis plan.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateManifest } from './manifest.js';

const valid = () => ({
  id: 'demo',
  title: 'Demo scenario',
  committed_at: '2026-10-02',
  units: [
    {
      id: 'u1',
      description: 'a content piece',
      count: 1,
      output_class: 'content',
      evidence: 'reviewer-accepted under the rubric',
    },
    {
      id: 'u2',
      description: 'a research note',
      count: 1,
      output_class: 'research',
      evidence: 'every repo-derived count verifiable in the archive',
    },
  ],
  completion_rule: 'all units accepted',
  rubric: {
    criteria: [
      { id: 'on-brand', description: 'matches the workspace brand rules' },
      { id: 'supported', description: 'every checkable claim verifiable' },
    ],
    min_quality: 0.75,
    critical_failures: ['a fabricated claim about the product'],
    non_inferiority_margin: 0.1,
  },
  qualification: {
    min_fixture_success_probability: 0.6,
    max_human_interventions: 1,
    deadline_minutes: 90,
    allowed_recovery: ['auto-restart of a crashed role'],
  },
  analysis: {
    confidence: 0.95,
    primary_comparisons: ['cost per accepted unit, treatment vs control'],
    sampling_unit: 'complete-run',
  },
  cost: { basis: 'estimated-inference', planning_allocation_usd: 8 },
});

describe('validateManifest', () => {
  it('accepts a complete manifest', () => {
    expect(validateManifest(valid())).toEqual({ ok: true, problems: [] });
  });

  const clear = (path: string[]) => {
    const m: any = valid();
    let o = m;
    for (const k of path.slice(0, -1)) o = o[k];
    delete o[path.at(-1)!];
    return m;
  };
  for (const path of [
    ['id'],
    ['title'],
    ['committed_at'],
    ['units'],
    ['completion_rule'],
    ['rubric'],
    ['qualification'],
    ['analysis'],
    ['cost'],
    ['rubric', 'criteria'],
    ['rubric', 'min_quality'],
    ['rubric', 'critical_failures'],
    ['rubric', 'non_inferiority_margin'],
    ['qualification', 'min_fixture_success_probability'],
    ['qualification', 'max_human_interventions'],
    ['qualification', 'deadline_minutes'],
    ['qualification', 'allowed_recovery'],
    ['analysis', 'confidence'],
    ['analysis', 'primary_comparisons'],
    ['analysis', 'sampling_unit'],
    ['cost', 'basis'],
    ['cost', 'planning_allocation_usd'],
  ]) {
    it(`names the missing field ${path.join('.')}`, () => {
      const r = validateManifest(clear(path));
      expect(r.ok).toBe(false);
      expect(r.problems.some((p) => p.includes(path.join('.')))).toBe(true);
    });
  }

  it('requires every unit to say what counts as machine-checkable or reviewer evidence', () => {
    const m: any = valid();
    delete m.units[0].evidence;
    expect(validateManifest(m).problems.join()).toMatch(/units\[0\]\.evidence/);
  });

  it('rejects an empty unit list, duplicate unit ids and non-positive counts', () => {
    expect(validateManifest({ ...valid(), units: [] }).ok).toBe(false);
    const dup: any = valid();
    dup.units[1].id = 'u1';
    expect(validateManifest(dup).problems.join()).toMatch(/duplicate unit id "u1"/);
    const zero: any = valid();
    zero.units[0].count = 0;
    expect(validateManifest(zero).problems.join()).toMatch(/units\[0\]\.count/);
  });

  it('rejects out-of-range probabilities, floors and confidence', () => {
    for (const patch of [
      (m: any) => (m.rubric.min_quality = 1.5),
      (m: any) => (m.qualification.min_fixture_success_probability = -0.1),
      (m: any) => (m.analysis.confidence = 1),
      (m: any) => (m.rubric.non_inferiority_margin = -1),
      (m: any) => (m.cost.planning_allocation_usd = 0),
      (m: any) => (m.qualification.deadline_minutes = 0),
    ]) {
      const m: any = valid();
      patch(m);
      expect(validateManifest(m).ok).toBe(false);
    }
  });

  it('requires at least one critical failure condition and one primary comparison', () => {
    const a: any = valid();
    a.rubric.critical_failures = [];
    expect(validateManifest(a).problems.join()).toMatch(/rubric\.critical_failures/);
    const b: any = valid();
    b.analysis.primary_comparisons = [];
    expect(validateManifest(b).problems.join()).toMatch(/analysis\.primary_comparisons/);
  });

  it('fixes the sampling unit to one complete run and the cost basis to a declared one', () => {
    const a: any = valid();
    a.analysis.sampling_unit = 'task';
    expect(validateManifest(a).problems.join()).toMatch(/analysis\.sampling_unit/);
    const b: any = valid();
    b.cost.basis = 'tokens';
    expect(validateManifest(b).problems.join()).toMatch(/cost\.basis/);
  });

  it('rejects a commit date that is not an ISO date', () => {
    expect(validateManifest({ ...valid(), committed_at: 'tomorrow' }).problems.join()).toMatch(
      /committed_at/,
    );
  });

  it('rejects a manifest that is not an object', () => {
    expect(validateManifest(null).ok).toBe(false);
    expect(validateManifest([]).ok).toBe(false);
  });
});

describe('committed manifests', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'manifests');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  it('has at least one manifest', () => expect(files.length).toBeGreaterThan(0));
  for (const f of files)
    it(`${f} is complete`, () => {
      const r = validateManifest(JSON.parse(readFileSync(join(dir, f), 'utf8')));
      expect(r.problems).toEqual([]);
    });
});
