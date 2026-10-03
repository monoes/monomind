import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../lib/manifest.js';
import { pilotPlan, validatePilotManifest } from './pilot-manifest.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (p: string) => JSON.parse(readFileSync(join(here, p), 'utf8'));
const scenario = (id: string) => load(`../manifests/${id}.json`);
const pilots = ['growth-like', 'dev-feature-qa', 'dev-feature-qa-revise', 'parallel-sweep'].map(
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
    const [growth, dev, revise, sweep] = pilots;
    expect(pilotPlan([sweep], scenario)).toEqual({ runs: 9, allocation_usd: 108 });
    expect(pilotPlan([growth], scenario)).toEqual({ runs: 9, allocation_usd: 108 });
    expect(pilotPlan([dev], scenario)).toEqual({ runs: 6, allocation_usd: 48 });
    expect(pilotPlan([growth, revise], scenario)).toEqual({ runs: 15, allocation_usd: 156 }); // all of round 2
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
    ]);
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
