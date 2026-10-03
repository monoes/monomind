// Every committed scenario manifest is complete (spec section 10) and none is a draft.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../lib/manifest.js';

const here = dirname(fileURLToPath(import.meta.url));
const scenarios = [
  'dev-feature-qa',
  'dev-feature-qa-revise',
  'deliberative-design',
  'growth-like',
  'parallel-sweep',
  'research-report',
  'sparse-dispatch',
];

describe('committed scenario manifests', () => {
  it('are exactly the seven scenarios', () => {
    expect(
      readdirSync(here)
        .filter((f) => f.endsWith('.json'))
        .sort(),
    ).toEqual(scenarios.map((s) => `${s}.json`).sort());
  });
  it.each(scenarios)('%s validates and carries no draft marker', (id) => {
    const m = JSON.parse(readFileSync(join(here, `${id}.json`), 'utf8'));
    expect(validateManifest(m)).toEqual({ ok: true, problems: [] });
    expect(m.status).toBeUndefined();
    expect(m.id).toBe(id);
  });

  it('dev-feature-qa-revise (approved by the owner 2026-10-02) has the revision unit, the dev-feature cost and margin, and its fixture record is approved', () => {
    const m = JSON.parse(readFileSync(join(here, 'dev-feature-qa-revise.json'), 'utf8'));
    expect(m.units.map((u: { id: string }) => u.id)).toEqual([
      'feature-change',
      'qa-report',
      'defect-found-and-fixed',
    ]);
    expect(m.cost).toEqual({ basis: 'estimated-inference', planning_allocation_usd: 8 });
    expect(m.rubric.non_inferiority_margin).toBe(0.1);
    expect(m.rubric.critical_failures.join(' ')).toMatch(/first version/);
    expect(m.committed_at).toBe('2026-10-02');
    const fixture = JSON.parse(
      readFileSync(join(here, '../fixtures/dev-feature-qa-revise/fixture.json'), 'utf8'),
    );
    expect(fixture.status).toMatch(/^APPROVED 2026-10-02/);
    expect(fixture.fixture.status).toMatch(/^APPROVED 2026-10-02/);
  });

  it('parallel-sweep (approved by the owner 2026-10-03) has the module-sheet and synthesis units, the standard margin and the $12 allocation, and records the no-node sandbox', () => {
    const m = JSON.parse(readFileSync(join(here, 'parallel-sweep.json'), 'utf8'));
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
    expect(m.committed_at).toBe('2026-10-03');
    expect(m.proposed_on).toBeUndefined();
    expect(m.notice).toBeUndefined();
    expect(m.declared_changes.map((c: { id: string }) => c.id)).toEqual([
      'owner-approval',
      'no-node-sandbox',
      'task-text-sheet-shape',
      'home-write-deny',
      'stopped-after-first-trio',
    ]);
    expect(m.declared_changes[1].what).toMatch(/denyExec/);
    const home = m.declared_changes[3];
    expect(home).toMatchObject({ date: '2026-10-03', approved_by: 'owner' });
    expect(home.what).toMatch(/homeWriteAllow/);
    expect(home.what).toMatch(/every arm|all three arms/);
    expect(home.why).toMatch(/f7\.sh/);
    expect(home.earlier_result).toMatch(/stay on record/);
    expect(m.declared_changes[4]).toMatchObject({ date: '2026-10-03', approved_by: 'owner' });
    expect(m.declared_changes[4].what).toMatch(/remaining 6/);
    const fixture = JSON.parse(
      readFileSync(join(here, '../fixtures/parallel-sweep/fixture.json'), 'utf8'),
    );
    expect(fixture.status).toMatch(/^APPROVED 2026-10-03/);
    expect(fixture.fixture.status).toMatch(/^APPROVED 2026-10-03/);
    expect(fixture.notice).toBeUndefined();
  });
});
