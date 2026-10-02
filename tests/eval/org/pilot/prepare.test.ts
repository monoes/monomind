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
