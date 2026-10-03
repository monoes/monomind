import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../lib/manifest.js';
import { pilotPlan, validatePilotManifest } from './pilot-manifest.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (p: string) => JSON.parse(readFileSync(join(here, p), 'utf8'));
const scenario = (id: string) => load(`../manifests/${id}.json`);
const pilots = [
  'growth-like',
  'dev-feature-qa',
  'dev-feature-qa-revise',
  'parallel-sweep',
  'parallel-sweep-2',
  'parallel-sweep-3',
].map(
  (id) => load(`${id}.pilot.json`),
);

describe('the committed pilot manifests', () => {
  it.each(pilots)(
    '$id is valid, and the scenario manifest it names is valid and committed first',
    (p) => {
      expect(validatePilotManifest(p, scenario)).toEqual({ ok: true, problems: [] });
      expect(validateManifest(scenario(p.scenario)).ok).toBe(true);
      expect(p.committed_at >= scenario(p.scenario).committed_at).toBe(true);
    },
  );

  it('plans round 2 of growth-like: 3 arms x 3 trials at $12 is 9 runs and $108; the round 1 dev-feature pilot is 6 runs at $8', () => {
    const [growth, dev, revise, sweep, sweep2, sweep3] = pilots;
    // parallel-sweep-3: baseline and treatment x 2 trials at $34 is 4 runs and $136 at the ceiling; the staged plan runs 1, then 2 or 3
    expect(pilotPlan([sweep3], scenario)).toEqual({ runs: 4, allocation_usd: 136 });
    expect(pilotPlan([sweep], scenario)).toEqual({ runs: 9, allocation_usd: 108 });
    // parallel-sweep-2 at the ceiling of 3 trials per arm is 9 runs and $270 planned; the staged plan starts with 1 run
    expect(pilotPlan([sweep2], scenario)).toEqual({ runs: 9, allocation_usd: 270 });
    expect(pilotPlan([growth], scenario)).toEqual({ runs: 9, allocation_usd: 108 });
    expect(pilotPlan([dev], scenario)).toEqual({ runs: 6, allocation_usd: 48 });
    // revise has gained the single arm (2026-10-03): 3 arms x 3 trials at $8 is 9 runs and $72 planned
    expect(pilotPlan([revise], scenario)).toEqual({ runs: 9, allocation_usd: 72 });
    expect(pilotPlan([growth, revise], scenario)).toEqual({ runs: 18, allocation_usd: 180 });
  });

  it('dev-feature-qa-revise declares its single arm, the Sonnet profile and the $4 org-wide stop, and keeps Haiku as the default', () => {
    const r = pilots[2];
    expect(r.arms.map((a: { id: string }) => a.id)).toEqual(['baseline', 'treatment', 'single']);
    expect(r.profile).toBe('haiku');
    expect(r.profiles).toEqual(['haiku', 'production']);
    expect(r.org_stop_usd).toBe(4);
    expect(r.org_stop_usd).toBeLessThanOrEqual(r.per_run_allocation_usd);
    expect(r.declared_changes.map((c: { id: string }) => c.id)).toEqual([
      'single-arm',
      'sonnet-profile',
      'org-stop',
    ]);
    for (const c of r.declared_changes) {
      expect(c).toMatchObject({ date: '2026-10-03', approved_by: 'owner' });
      expect(c.earlier_result).toBeTruthy();
    }
    expect(r.trials_per_arm).toBe(3); // earlier fields kept
  });

  it('growth-like has the third, single-agent arm, the production profile and the $12 org-wide stop, declared', () => {
    const g = pilots[0];
    expect(g.arms.map((a: { id: string }) => a.id)).toEqual(['baseline', 'treatment', 'single']);
    expect(g.profile).toBe('production');
    expect(g.org_stop_usd).toBe(12);
    expect(g.per_run_allocation_usd).toBe(12);
    expect(g.declared_changes.map((c: { id: string }) => c.id)).toEqual([
      'lead-coordinates',
      'caps-and-stop',
      'single-arm',
      'production-model',
    ]);
    expect(scenario('growth-like').cost.planning_allocation_usd).toBe(12);
    expect(scenario('growth-like').declared_changes.length).toBeGreaterThan(0);
  });

  it('parallel-sweep: arms, 3 trials, production profile, $12 stop and allocation, native children disabled, 8 module-sheet contracts, the no-node sandbox declared', () => {
    const p = pilots[3];
    expect(p.arms.map((a: { id: string }) => a.id)).toEqual(['baseline', 'treatment', 'single']);
    expect(p.trials_per_arm).toBe(3);
    expect(p.harness_only).toBe(true);
    expect(p.native_children).toBe('disabled');
    expect(p.profile).toBe('production');
    expect(p.org_stop_usd).toBe(12);
    expect(p.per_run_allocation_usd).toBe(12);
    expect(p.contracts).toHaveLength(8);
    expect(p.status).toBeUndefined();
    expect(p.notice).toBeUndefined();
    expect(p.committed_at).toBe('2026-10-03');
    expect(p.declared_changes.map((c: { id: string }) => c.id)).toEqual([
      'owner-approval',
      'no-node-sandbox',
      'task-text-sheet-shape',
      'home-write-deny',
      'stopped-after-first-trio',
    ]);
  });

  it('parallel-sweep-2: three arms, production profile, $30 stop and allocation, 8 per-worker contracts, committed as approved with the staged plan and the carried safety changes', () => {
    const p = pilots[4];
    expect(p.arms.map((a: { id: string }) => a.id)).toEqual(['single', 'baseline', 'treatment']);
    expect(p.harness_only).toBe(true);
    expect(p.sections_serialized).toBe(false);
    expect(p.native_children).toBe('disabled');
    expect(p.profile).toBe('production');
    expect(p.org_stop_usd).toBe(30);
    expect(p.per_run_allocation_usd).toBe(30);
    expect(p.deadline_seconds).toBe(600);
    expect(p.contracts.map((c: { id: string }) => c.id)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((k) => `module-sheets-w${k}`),
    );
    expect(p.status).toBeUndefined();
    expect(p.notice).toBeUndefined();
    expect(JSON.stringify(p)).not.toMatch(/PROPOSED/);
    expect(p.committed_at).toBe('2026-10-03');
    expect(p.declared_changes.map((c: { id: string }) => c.id)).toEqual([
      'owner-approval',
      'staged-plan',
      'harness-dollars',
      'no-node-sandbox',
      'home-write-deny',
      'task-text-sheet-shape',
      'single-deadline-480-variant',
      'stage2-after-inconclusive-stage1',
      'process-cap-lifted-rerun',
    ]);
    const v480 = p.declared_changes[6];
    expect(v480).toMatchObject({ date: '2026-10-04', approved_by: 'owner' });
    expect(v480.what).toMatch(/single arm only/);
    expect(v480.what).toMatch(/PILOT_OWNER_DECISION/);
    expect(v480.what).toMatch(/30 or more units stop/);
    expect(v480.why).toMatch(/29 of 33/);
    expect(v480.earlier_result).toMatch(/600 s design is not changed/);
    expect(p.declared_changes[7]).toMatchObject({ date: '2026-10-04' });
    expect(p.declared_changes[7].what).toMatch(/600 s design/);
    expect(p.declared_changes[7].earlier_result).toMatch(/thresholds and the 600 s design are unchanged/);
    expect(p.declared_changes[8].what).toMatch(/MONOMIND_MAX_SDK_PROCS=40/);
    expect(p.declared_changes[8].why).toMatch(/3 processes per role/);
    expect(p.declared_changes[0].what).toMatch(/approved as proposed/);
    expect(p.declared_changes[2].what).toMatch(/1\.5x/);
    expect(p.staged_plan.stages).toHaveLength(3);
    expect(p.stop_rule.thresholds.stop_at_or_above).toBe(30);
    expect(Object.keys(p.routing.sections)).toHaveLength(5);
  });

  it('parallel-sweep-3: baseline control and treatment (no single arm), 720 s, $34, 8 contracts with 4 attempts, the fault plan, the staged plan with its mechanism gate and the cost estimate, committed as approved by the lead', () => {
    const p = pilots[5];
    expect(p.arms.map((a: { id: string }) => a.id)).toEqual(['baseline', 'treatment']);
    expect(p.harness_only).toBe(true);
    expect(p.sections_serialized).toBe(false);
    expect(p.native_children).toBe('disabled');
    expect(p.profile).toBe('production');
    expect([p.deadline_seconds, p.org_stop_usd, p.per_run_allocation_usd, p.trials_per_arm]).toEqual([720, 34, 34, 2]);
    expect(p.contracts.map((c: { id: string }) => c.id)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((k) => `module-sheets-w${k}`),
    );
    for (const c of p.contracts) expect([c.max_attempts, c.consumers]).toEqual([4, ['synthesiser']]);
    expect(p.fault_injection).toEqual({
      seed_base: 20261003,
      seed_rule: 'seed_base plus the trial number',
      documents: 4,
      classes: ['wrong-value-q05', 'wrong-value-q07', 'files-order', 'duplicate-sheet'],
      scope: expect.stringMatching(/treatment arm of this scenario only; each document is changed once/),
    });
    expect(p.status).toBeUndefined();
    expect(JSON.stringify(p)).not.toMatch(/PROPOSED/);
    expect(p.committed_at).toBe('2026-10-04');
    expect(p.declared_changes.map((c: { id: string }) => c.id)).toEqual([
      'handoff-decision-variant',
      'hand-off-only-path',
      'fault-injection',
      'deadline-720',
      'baseline-no-faults-control',
      'harness-dollars',
      'no-node-sandbox',
      'home-write-deny',
      'natural-errors-in-injected-versions',
      'synth-cap-resized',
    ]);
    for (const c of p.declared_changes)
      expect(c.approved_by).toMatch(/^lead, under the owner's standing instruction/);
    // the staged plan: stage 1 is one treatment trial with the mechanism gate; stage 2 only past it
    const s = p.staged_plan;
    expect(s.gate_kind).toBe('handoff-read');
    expect(s.stages.map((x: any) => x.stage)).toEqual([1, 2, 3]);
    expect(s.stages[0].trials).toEqual([{ arm: 'treatment', n: 1 }]);
    expect(s.stages[0].gate).toMatch(/always runs first/);
    expect(s.stages[1].gate).toMatch(/at least one successful pilot__doc_read/);
    expect(s.stages[2].gate).toBe('PILOT_STAGE3_APPROVED=yes');
    expect(p.stop_rule.mechanism_gate).toMatch(/0 successful pilot__doc_read calls/);
    expect(p.stop_rule.thresholds).toMatchObject({ stage1_min_synthesiser_doc_reads: 1, of_units: 33 });
    expect(p.stop_rule.predictions).toHaveLength(3);
    // cost estimate: low <= expected <= high everywhere, stages add up to the pilot, under the owner's 150 line
    const est = (x: any) => [x.low_usd, x.expected_usd, x.high_usd];
    for (const x of [s.stages[0], s.stages[1], s.estimate_total_usd, s.estimate_cheapest_pilot_usd]) {
      const [lo, mid, hi] = est(x);
      expect(lo).toBeLessThanOrEqual(mid);
      expect(mid).toBeLessThanOrEqual(hi);
    }
    for (let i = 0; i < 3; i++)
      expect(est(s.stages[0])[i] + est(s.stages[1])[i]).toBe(est(s.estimate_total_usd)[i]);
    expect(s.estimate_total_usd.high_usd).toBeLessThan(150);
    expect(s.pilot_soft_cap_usd).toBeGreaterThanOrEqual(s.estimate_total_usd.high_usd);
    expect(s.stages[0].soft_cap_usd).toBeGreaterThanOrEqual(s.stages[0].high_usd);
    expect(s.stages[1].cumulative_soft_cap_usd).toBe(s.pilot_soft_cap_usd);
    expect(s.estimate_cheapest_pilot_usd.expected_usd).toBeLessThan(s.estimate_total_usd.expected_usd);
    expect(p.stop_rule.thresholds.spend_flag_per_trial_usd).toBe(s.stages[0].high_usd);
    expect(JSON.stringify(s)).toMatch(/harness dollars/);
  });

  it('each pilot has a contract that crosses sections, so the hand-off has something to measure', () => {
    for (const p of pilots) {
      const section = (r: string) =>
        Object.entries(p.routing.sections).find(
          ([, s]: any) => s.lead === r || s.members.includes(r),
        )?.[0];
      expect(
        p.contracts.some((c: any) =>
          c.consumers.some((x: string) => section(x) !== section(c.producer)),
        ),
      ).toBe(true);
    }
  });
});

describe('validatePilotManifest refuses a pilot that is not a harness-only prototype', () => {
  const ok = () => structuredClone(pilots[0]);
  const problems = (mutate: (p: any) => void) => {
    const p = ok();
    mutate(p);
    return validatePilotManifest(p, scenario).problems.join('\n');
  };

  it('requires harness_only true and sections not serialized', () => {
    expect(problems((p) => (p.harness_only = false))).toMatch(/harness_only/);
    expect(problems((p) => (p.sections_serialized = true))).toMatch(/sections_serialized/);
  });

  it('requires native children disabled, a writer authority and both arms', () => {
    expect(problems((p) => (p.native_children = 'allowed'))).toMatch(/native_children/);
    expect(problems((p) => (p.writer_authority = ''))).toMatch(/writer_authority/);
    expect(
      problems((p) => (p.arms = p.arms.filter((a: { id: string }) => a.id !== 'treatment'))),
    ).toMatch(/baseline and a treatment/);
    expect(problems((p) => p.arms.push({ id: 'other' }))).toMatch(/baseline and a treatment/);
  });

  it('requires the allocation to match the scenario manifest, and an unknown scenario to be refused', () => {
    expect(problems((p) => (p.per_run_allocation_usd = 5))).toMatch(/per_run_allocation_usd.*12/);
    expect(problems((p) => (p.scenario = 'nope'))).toMatch(/scenario "nope"/);
  });

  it('refuses a role in two sections, a contract naming an unsectioned role, and a producer consuming its own document', () => {
    expect(problems((p) => p.routing.sections.content.members.push('researcher'))).toMatch(
      /researcher.*more than one section/,
    );
    expect(problems((p) => (p.contracts[0].consumers = ['growth-lead']))).toMatch(
      /growth-lead.*no section/,
    );
    expect(problems((p) => p.contracts[0].consumers.push('researcher'))).toMatch(
      /producer.*consumer/,
    );
  });

  it('refuses a contract schema outside the dialect, a duplicate contract id and a pilot with no cross-section contract', () => {
    expect(problems((p) => (p.contracts[0].schema.properties.topic.pattern = '^a'))).toMatch(
      /pattern/,
    );
    expect(problems((p) => (p.contracts[1].id = 'research-brief'))).toMatch(/duplicate contract/);
    expect(
      problems((p) => {
        p.contracts = [p.contracts[1]]; // content-writer -> brand-reviewer: one section
      }),
    ).toMatch(/crosses sections/);
  });
});
