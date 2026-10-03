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
  'parallel-sweep-2',
  'parallel-sweep-3',
  'research-report',
  'sparse-dispatch',
];

describe('committed scenario manifests', () => {
  it('are exactly the nine scenarios', () => {
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

  it('parallel-sweep-2 (approved by the owner, staged plan) has 32 sheets and the synthesis (33 units), the $30 allocation, the 10 minute deadline, no draft marker, and records the staged plan, the harness dollars and the carried safety changes', () => {
    const m = JSON.parse(readFileSync(join(here, 'parallel-sweep-2.json'), 'utf8'));
    expect(m.units.map((u: { id: string; count: number }) => [u.id, u.count])).toEqual([
      ['module-sheet', 32],
      ['synthesis', 1],
    ]);
    expect(m.units[0].evidence).toMatch(/11 of its 12/);
    expect(m.units[0].evidence).toMatch(/12 of 12/);
    expect(m.rubric.non_inferiority_margin).toBe(0.1);
    expect(m.cost).toEqual({ basis: 'estimated-inference', planning_allocation_usd: 30 });
    expect(m.qualification.deadline_minutes).toBe(10);
    expect(m.completion_rule).toMatch(/files present when the run ends/);
    expect(m.rubric.critical_failures.join(' ')).toMatch(/fabricated/);
    expect(m.rubric.critical_failures.join(' ')).toMatch(/copied from another module/);
    expect(m.committed_at).toBe('2026-10-03');
    expect(m.proposed_on).toBeUndefined();
    expect(m.notice).toBeUndefined();
    expect(JSON.stringify(m)).not.toMatch(/PROPOSED/);
    expect(m.declared_changes.map((c: { id: string }) => c.id)).toEqual([
      'owner-approval',
      'staged-plan-and-stop-rule',
      'harness-dollars',
      'no-node-sandbox',
      'home-write-deny',
      'task-text-sheet-shape',
      'single-deadline-480-variant',
      'stage2-after-inconclusive-stage1',
      'process-cap-lifted-rerun',
    ]);
    for (const c of m.declared_changes.slice(0, 6))
      expect(c).toMatchObject({ date: '2026-10-03', approved_by: 'owner' });
    expect(m.declared_changes[6]).toMatchObject({ date: '2026-10-04', approved_by: 'owner' });
    expect(m.declared_changes[6].what).toMatch(/480 s/);
    expect(m.declared_changes[6].what).toMatch(/single arm only/);
    expect(m.declared_changes[7]).toMatchObject({ date: '2026-10-04' });
    expect(m.declared_changes[7].what).toMatch(/PILOT_OWNER_DECISION/);
    expect(m.declared_changes[7].earlier_result).toMatch(/0 of 33/);
    expect(m.declared_changes[8].what).toMatch(/MONOMIND_MAX_SDK_PROCS=40/);
    expect(m.declared_changes[8].earlier_result).toMatch(/not overwritten/);
    expect(m.declared_changes[1].what).toMatch(/only if the single agent misses/);
    expect(m.declared_changes[2].what).toMatch(/1\.5x the Sonnet 5\.5 list rates/);
    expect(m.declared_changes[3].what).toMatch(/denyExec/);
    expect(m.declared_changes[4].what).toMatch(/homeWriteAllow/);
    const fixture = JSON.parse(
      readFileSync(join(here, '../fixtures/parallel-sweep-2/fixture.json'), 'utf8'),
    );
    expect(fixture.status).toMatch(/^APPROVED 2026-10-03/);
    expect(fixture.fixture.status).toMatch(/^APPROVED 2026-10-03/);
    expect(fixture.notice).toBeUndefined();
  });

  it('parallel-sweep-3 (approved by the lead under the owner\'s standing instruction) keeps the 33 units, moves to the 720 s deadline and the $34 allocation, and records the hand-off decision design', () => {
    const m = JSON.parse(readFileSync(join(here, 'parallel-sweep-3.json'), 'utf8'));
    expect(m.units.map((u: { id: string; count: number }) => [u.id, u.count])).toEqual([
      ['module-sheet', 32],
      ['synthesis', 1],
    ]);
    expect(m.cost).toEqual({ basis: 'estimated-inference', planning_allocation_usd: 34 });
    expect(m.qualification.deadline_minutes).toBe(12);
    expect(m.completion_rule).toMatch(/720 second wall deadline/);
    expect(m.completion_rule).not.toMatch(/600/);
    expect(m.rubric.non_inferiority_margin).toBe(0.1);
    expect(m.committed_at).toBe('2026-10-04');
    expect(m.notice).toBeUndefined();
    expect(JSON.stringify(m)).not.toMatch(/PROPOSED/);
    expect(m.analysis.primary_comparisons[0]).toMatch(/mechanism measurement, not a comparison/);
    expect(m.declared_changes.map((c: { id: string }) => c.id)).toEqual([
      'handoff-decision-variant',
      'hand-off-only-path',
      'fault-injection',
      'deadline-720',
      'baseline-no-faults-control',
      'harness-dollars',
      'no-node-sandbox',
      'home-write-deny',
    ]);
    for (const c of m.declared_changes) {
      expect(c).toMatchObject({ date: '2026-10-04' });
      expect(c.approved_by).toMatch(/^lead, under the owner's standing instruction/);
      expect(c.earlier_result).toBeTruthy();
    }
    expect(m.declared_changes[2].why).toMatch(/harness-injected, so this measures the decision path, not natural errors/);
    expect(m.declared_changes[4].why).toMatch(/mechanism measurement, not a comparison/);
    expect(m.declared_changes[4].what).toMatch(/single arm is dropped/);
    const fixture = JSON.parse(
      readFileSync(join(here, '../fixtures/parallel-sweep-3/fixture.json'), 'utf8'),
    );
    expect(fixture.status).toMatch(/^APPROVED 2026-10-04/);
    expect(fixture.notice).toBeUndefined();
  });
});
