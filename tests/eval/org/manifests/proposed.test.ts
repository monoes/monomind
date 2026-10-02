// A proposed scenario manifest and a proposed pilot manifest are drafts for owner review. Each must be
// complete enough to review, refused as it stands (only the committed_at placeholder is missing), and kept
// out of the committed directories until the owner commits it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../lib/manifest.js';
import { pilotPlan, validatePilotManifest } from '../pilot/pilot-manifest.js';

const here = dirname(fileURLToPath(import.meta.url));
const scenarioDir = join(here, 'proposed');
const pilotDir = join(here, '../pilot/proposed');
const read = (dir: string, f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const drafts = readdirSync(scenarioDir).filter((f) => f.endsWith('.proposed.json'));
const pilotDrafts = readdirSync(pilotDir).filter((f) => f.endsWith('.pilot.json'));

describe('PROPOSED drafts exist', () => {
  it('finds at least one scenario draft and one pilot draft (no vacuous it.each)', () => {
    expect(drafts.length).toBeGreaterThan(0);
    expect(pilotDrafts.length).toBeGreaterThan(0);
  });
});

describe('PROPOSED scenario manifests', () => {
  it.each(drafts)(
    '%s is marked proposed and refused only for the placeholder committed_at',
    (f) => {
      const m = read(scenarioDir, f);
      expect(m.status).toBe('PROPOSED');
      expect(m.committed_at).toBe('PROPOSED');
      expect(m.notice).toMatch(/PROPOSED DRAFT.*owner/);
      expect(validateManifest(m)).toEqual({
        ok: false,
        problems: ['committed_at is required and must be an ISO date (YYYY-MM-DD)'],
      });
    },
  );

  it.each(drafts)('%s is otherwise a complete manifest: only committing it is left', (f) => {
    expect(validateManifest({ ...read(scenarioDir, f), committed_at: '2026-10-03' })).toEqual({
      ok: true,
      problems: [],
    });
  });

  it('parallel-sweep has the module-sheet and synthesis units, the standard margin and the $12 allocation', () => {
    const m = read(scenarioDir, 'parallel-sweep.proposed.json');
    expect(m.units.map((u: { id: string; count: number }) => [u.id, u.count])).toEqual([
      ['module-sheet', 8],
      ['synthesis', 1],
    ]);
    expect(m.rubric.non_inferiority_margin).toBe(0.1);
    expect(m.rubric.min_quality).toBe(0.75);
    expect(m.cost).toEqual({ basis: 'estimated-inference', planning_allocation_usd: 12 });
    expect(m.qualification.deadline_minutes).toBe(35);
    expect(m.rubric.critical_failures.join(' ')).toMatch(/fabricated/);
    expect(m.rubric.critical_failures.join(' ')).toMatch(/copied from another module/);
  });
});

describe('PROPOSED pilot manifests', () => {
  const scenarioFor = (dated: boolean) => (id: string) => {
    const m = read(scenarioDir, `${id}.proposed.json`);
    return dated ? { ...m, committed_at: '2026-10-03' } : m;
  };

  it.each(pilotDrafts)(
    '%s names a scenario that has no committed manifest, so it cannot be used',
    (f) => {
      const p = read(pilotDir, f);
      expect(p.status).toBe('PROPOSED');
      expect(p.committed_at).toBe('PROPOSED');
      const committed = (id: string) => read(join(here), `${id}.json`);
      const check = validatePilotManifest(p, committed);
      expect(check.ok).toBe(false);
      expect(check.problems).toEqual([
        `scenario "${p.scenario}" has no committed scenario manifest`,
      ]);
    },
  );

  it.each(pilotDrafts)(
    '%s is otherwise a valid pilot once its scenario manifest is committed',
    (f) => {
      const p = { ...read(pilotDir, f), committed_at: '2026-10-03' };
      expect(validatePilotManifest(p, scenarioFor(true))).toEqual({ ok: true, problems: [] });
    },
  );

  it('parallel-sweep: arms, 3 trials, production profile, $12 stop and allocation, native children disabled', () => {
    const p = read(pilotDir, 'parallel-sweep.pilot.json');
    expect(p.arms.map((a: { id: string }) => a.id)).toEqual(['baseline', 'treatment', 'single']);
    expect(p.trials_per_arm).toBe(3);
    expect(p.harness_only).toBe(true);
    expect(p.native_children).toBe('disabled');
    expect(p.profile).toBe('production');
    expect(p.org_stop_usd).toBe(12);
    expect(p.per_run_allocation_usd).toBe(12);
    expect(p.contracts).toHaveLength(8);
    expect(pilotPlan([p], scenarioFor(false))).toEqual({ runs: 9, allocation_usd: 108 });
  });
});

describe('drafts stay out of the committed directories', () => {
  it('has no parallel-sweep manifest among the committed scenarios or the committed pilots', () => {
    expect(readdirSync(here).filter((f) => f.includes('parallel-sweep'))).toEqual([]);
    expect(readdirSync(join(here, '../pilot')).filter((f) => f.includes('parallel-sweep'))).toEqual(
      [],
    );
    expect(existsSync(join(here, 'parallel-sweep.json'))).toBe(false);
  });
});
