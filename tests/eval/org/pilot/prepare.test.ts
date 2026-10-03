// Needs the Phase 0 snapshot for growth-like (skipped without it); dev-feature-qa builds its own fixture.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OrgDefSchema } from '../../../../packages/@monomind/cli/src/orgrt/types.js';
import { checklistFindings } from '../../../../packages/@monomind/cli/src/orgrt/validate-checklist.js';
// @ts-expect-error plain .mjs module
import { effectiveDiff } from '../smoke/lib.mjs';
// @ts-expect-error plain .mjs module
import { buildInputs } from '../smoke/prepare.mjs';
import { preparePilotTrial } from './prepare.js';

const org = (root: string) => {
  const t = JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8'));
  return {
    t,
    def: JSON.parse(readFileSync(join(root, '.monomind/orgs', `${t.name}.json`), 'utf8')),
  };
};

describe('dev-feature-qa pilot trials', () => {
  it('differ between arms only by the prototype, and both are Phase 2 without sections', async () => {
    const base = mkdtempSync(join(tmpdir(), 'pilot-'));
    await buildInputs({ scenario: 'dev-feature-qa', base });
    const b = org(
      await preparePilotTrial({ scenario: 'dev-feature-qa', base, arm: 'baseline', n: 1 }),
    );
    const t = org(
      await preparePilotTrial({ scenario: 'dev-feature-qa', base, arm: 'treatment', n: 1 }),
    );

    expect(b.t.name).toBe('smoke-dev-feature-qa-phase2-p1b');
    expect(t.t.name).toBe('smoke-dev-feature-qa-phase2-p1t');
    for (const x of [b, t]) {
      expect(x.def.sections).toBeUndefined(); // no definition carries sections:
      expect(x.def.run_config.experimental).toBeUndefined();
      expect(x.def.run_config.context).toMatchObject({ require_brief: true, notes: true }); // Phase 2
      expect(OrgDefSchema.parse(x.def)).toBeTruthy();
      expect(checklistFindings(OrgDefSchema.parse(x.def)).errors).toEqual([]);
    }
    // the baseline has no prototype at all; the treatment's difference is the placeholder provider and one responsibilities line on each sectioned role
    expect(b.def.roles.some((r: any) => r.tool_providers?.length)).toBe(false);
    const byId = (d: any, id: string) => d.roles.find((r: any) => r.id === id);
    const diffs = b.def.roles.flatMap((r: any) => effectiveDiff(r, byId(t.def, r.id)));
    expect(diffs.length).toBeGreaterThan(0);
    // (a role's write-deny lists absolute paths inside its own trial root: plumbing, not a difference between arms)
    const real = diffs.filter((p: string) => p !== 'policy.sandbox.denyWrite');
    expect(real.length).toBeGreaterThan(0);
    expect(real.every((p: string) => p === 'tool_providers' || p === 'responsibilities')).toBe(
      true,
    );
    expect(effectiveDiff({ ...b.def, roles: 0 }, { ...t.def, roles: 0 })).toEqual([
      'name',
      'run_config.workspace',
    ]); // nothing else differs, per-trial names and paths aside
    // lead is in no section: untouched
    expect(t.def.roles.find((r: any) => r.id === 'lead').tool_providers).toBeUndefined();
    expect(t.def.roles.find((r: any) => r.id === 'implementer').tool_providers[0].name).toBe(
      'pilot',
    );
  });

  it('records the arm, the run token, the routing map and the controls in the trial record, and only there', async () => {
    const base = mkdtempSync(join(tmpdir(), 'pilot-'));
    await buildInputs({ scenario: 'dev-feature-qa', base });
    const { t, def } = org(
      await preparePilotTrial({ scenario: 'dev-feature-qa', base, arm: 'treatment', n: 2 }),
    );
    expect(t.pilot).toMatchObject({
      arm: 'treatment',
      id: 'pilot-dev-feature-qa',
      nativeChildren: 'disabled',
    });
    expect(t.pilot.runId).toMatch(/^[0-9a-f]{24}$/);
    expect(t.pilot.routing.sections.dev.lead).toBe('implementer');
    expect(t.pilot.contracts.map((c: any) => c.id)).toEqual(['change-summary', 'qa-verdict']);
    expect(JSON.stringify(def)).not.toContain(t.pilot.runId); // the token never enters the definition
    expect(existsSync(t.pilot.dir)).toBe(false); // the store is created by the run, not by preparation
  });
});

describe('round 2 arms and profile', () => {
  it("refuses an arm the scenario's pilot manifest does not list", async () => {
    const base = mkdtempSync(join(tmpdir(), 'pilot-'));
    await buildInputs({ scenario: 'dev-feature-qa', base });
    await expect(
      preparePilotTrial({ scenario: 'dev-feature-qa', base, arm: 'single', n: 1 }),
    ).rejects.toThrow(/does not list the arm "single"/);
  });

  const snapshot = process.env.SMOKE_GROWTH_SNAPSHOT ?? '/var/tmp/mm-phase0/snapshot';
  describe.skipIf(!existsSync(join(snapshot, 'manifest.json')))('growth-like', () => {
    const base = mkdtempSync(join(tmpdir(), 'pilot-growth-'));
    it('builds the three arms on the production profile: single alone, baseline and treatment with the roles', async () => {
      await buildInputs({ scenario: 'growth-like', base });
      const s = org(
        await preparePilotTrial({ scenario: 'growth-like', base, arm: 'single', n: 1 }),
      );
      const b = org(
        await preparePilotTrial({ scenario: 'growth-like', base, arm: 'baseline', n: 1 }),
      );
      const t = org(
        await preparePilotTrial({ scenario: 'growth-like', base, arm: 'treatment', n: 1 }),
      );
      expect([s.t.name, b.t.name, t.t.name]).toEqual([
        'smoke-growth-like-single-p1s',
        'smoke-growth-like-phase2-p1b',
        'smoke-growth-like-phase2-p1t',
      ]);
      expect(s.def.roles.map((r: any) => r.id)).toEqual(['growth-lead']);
      expect(s.def.roles[0].tool_providers).toBeUndefined(); // no prototype, no other role's tools
      expect(s.t.pilot).toMatchObject({ arm: 'single' });
      expect(b.def.roles.length).toBeGreaterThan(5);
      for (const x of [s, b, t]) {
        expect(x.t.profile).toBe('production');
        expect(x.t.orgStopUsd).toBe(12);
        expect(x.t.allocationUsd).toBe(12);
        expect(x.t.runners['growth-lead'].model).toBe('claude-sonnet-5-5');
      }
      expect(s.t.task).toMatch(/only agent in this run/);
      expect(b.t.task).toMatch(/lead coordinates and does not write deliverables itself/);
      expect(t.t.task).toBe(b.t.task); // the two role arms get the same task
      expect(
        t.def.roles.some((r: any) => r.tool_providers?.some((p: any) => p.name === 'pilot')),
      ).toBe(true);
    });
  });
});

describe('dev-feature-qa-revise: the single arm and a per-trial Sonnet profile', () => {
  it('builds single, baseline and treatment on Haiku by default, and on Sonnet with an S marker in the id when asked', async () => {
    const base = mkdtempSync(join(tmpdir(), 'pilot-revise-'));
    await buildInputs({ scenario: 'dev-feature-qa-revise', base });
    const make = async (arm: 'baseline' | 'treatment' | 'single', profile?: string) =>
      org(
        await preparePilotTrial({
          scenario: 'dev-feature-qa-revise',
          base,
          arm,
          n: 1,
          ...(profile ? { profile } : {}),
        }),
      );
    const hs = await make('single');
    const hb = await make('baseline');
    const ps = await make('single', 'production');
    const pb = await make('baseline', 'production');
    const pt = await make('treatment', 'production');
    expect([hs, hb, ps, pb, pt].map((x) => x.t.name)).toEqual([
      'smoke-dev-feature-qa-revise-single-p1s',
      'smoke-dev-feature-qa-revise-phase2-p1b',
      'smoke-dev-feature-qa-revise-single-p1sS',
      'smoke-dev-feature-qa-revise-phase2-p1bS',
      'smoke-dev-feature-qa-revise-phase2-p1tS',
    ]);
    expect(hs.def.roles.map((r: any) => r.id)).toEqual(['lead']);
    expect(hs.t.pilot).toMatchObject({ arm: 'single' });
    expect(hs.t.profile).toBe('haiku');
    expect(hs.def.roles[0].tool_providers).toBeUndefined(); // no prototype
    for (const x of [ps, pb, pt]) {
      expect(x.t.profile).toBe('production');
      expect(Object.values(x.t.runners).every((r: any) => r.model === 'claude-sonnet-5-5')).toBe(
        true,
      );
    }
    expect(pb.def.roles.map((r: any) => r.budget_usd)).toEqual([2, 8, 6]);
    expect(hb.def.roles.map((r: any) => r.budget_usd)).toEqual([1, 4, 3]);
    expect(pt.t.orgStopUsd).toBe(4);
    expect(pt.t.task).toBe(pb.t.task);
    expect(hs.t.task).toMatch(/only agent in this run/);
  });

  it('refuses a profile the pilot manifest does not list, and a non-default profile on a pilot that lists none', async () => {
    const base = mkdtempSync(join(tmpdir(), 'pilot-revise-'));
    await buildInputs({ scenario: 'dev-feature-qa-revise', base });
    await expect(
      preparePilotTrial({
        scenario: 'dev-feature-qa-revise',
        base,
        arm: 'baseline',
        n: 1,
        profile: 'fast',
      }),
    ).rejects.toThrow(/does not list the profile "fast"/);
    await buildInputs({ scenario: 'dev-feature-qa', base });
    await expect(
      preparePilotTrial({
        scenario: 'dev-feature-qa',
        base,
        arm: 'baseline',
        n: 1,
        profile: 'production',
      }),
    ).rejects.toThrow(/does not list the profile "production"/);
  });
});

describe('a redo trial', () => {
  it('replaces an interrupted trial under its own id, flagged in the trial record, and the original is untouched', async () => {
    const base = mkdtempSync(join(tmpdir(), 'pilot-redo-'));
    await buildInputs({ scenario: 'dev-feature-qa', base });
    const first = org(
      await preparePilotTrial({ scenario: 'dev-feature-qa', base, arm: 'baseline', n: 3 }),
    );
    const again = org(
      await preparePilotTrial({ scenario: 'dev-feature-qa', base, arm: 'baseline', n: 3, redo: 1 }),
    );
    expect(first.t.name).toBe('smoke-dev-feature-qa-phase2-p3b');
    expect(again.t.name).toBe('smoke-dev-feature-qa-phase2-p3br1');
    expect(again.t.pilot).toMatchObject({
      arm: 'baseline',
      redoOf: 'smoke-dev-feature-qa-phase2-p3b',
      redo: 1,
    });
    expect(first.t.pilot.redoOf).toBeUndefined();
  });
});
