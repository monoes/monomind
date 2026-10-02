// Needs the Phase 0 snapshot (default /var/tmp/mm-phase0/snapshot, or SMOKE_GROWTH_SNAPSHOT); skipped without it.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OrgDefSchema } from '../../../../../../packages/@monomind/cli/src/orgrt/types.js';
import { checklistFindings } from '../../../../../../packages/@monomind/cli/src/orgrt/validate-checklist.js';
// @ts-expect-error plain .mjs modules
import { checkTrial } from '../../check.mjs';
// @ts-expect-error plain .mjs modules
import { buildInputs, prepareTrial } from '../../prepare.mjs';
// @ts-expect-error plain .mjs modules
import { CAPS, SESSION_CAP } from './kit.mjs';

const snapshot = process.env.SMOKE_GROWTH_SNAPSHOT ?? '/var/tmp/mm-phase0/snapshot';
const have = existsSync(join(snapshot, 'manifest.json'));

describe.skipIf(!have)('growth-like kit', () => {
  const base = mkdtempSync(join(tmpdir(), 'growth-'));
  let inputs: string;
  const prod = have ? JSON.parse(readFileSync(join(snapshot, 'manifest.json'), 'utf8')) : {};

  it('builds the inputs from the snapshot', async () => {
    inputs = await buildInputs({ scenario: 'growth-like', base });
    for (const f of ['org.json', 'tools.json', 'replay.json', 'workspace', 'org-memory', 'repo'])
      expect(existsSync(join(inputs, f))).toBe(true);
  });

  it.each(['current-best', 'phase2'])(
    '%s: a valid, isolated org that cannot reach production',
    async (contender) => {
      const root = await prepareTrial({ scenario: 'growth-like', base, contender, trial: '1' });
      const trial = JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8'));
      const text = readFileSync(join(root, '.monomind/orgs', `${trial.name}.json`), 'utf8');
      const org = JSON.parse(text);
      const parsed = OrgDefSchema.parse(org);
      expect(checklistFindings(parsed).errors).toEqual([]);
      // the production profile appears only as each role's write deny, and nowhere else
      expect(text.split(prod.source).length - 1).toBe(org.roles.length);
      expect(org.schedule).toBeUndefined();
      expect(org.run_config.workspace).toBe(join(root, 'workspace'));
      expect(org.run_config.memory_namespace).toBe(`org:${trial.name}`);
      expect(existsSync(join(root, '.monomind/org-memory'))).toBe(true);
      // the trial guards its inputs, the production workspace and the production org memory
      expect(trial.guard).toEqual([
        inputs,
        prod.workspace,
        join(prod.source, '.monomind/org-memory'),
      ]);
      // stubs, not mono-agent grants
      for (const r of org.roles)
        for (const tp of r.tool_providers ?? [])
          expect(tp.args[0]).toMatch(/stub-monoagent-mcp\.mjs$/);
      // the designers keep their own runners; Claude roles run Haiku; USD caps only where priced
      expect(trial.runners['visual-designer-codex']).toMatchObject({ runtime: 'codex' });
      expect(trial.runners['visual-designer-agy']).toMatchObject({ runtime: 'antigravity' });
      expect(trial.runners.researcher).toEqual({
        runtime: 'claude',
        model: 'claude-haiku-4-5-20251001',
      });
      expect(org.roles.find((r: any) => r.id === 'researcher').budget_usd).toBe(CAPS.researcher);
      expect(org.roles.find((r: any) => r.id === 'visual-designer-codex').budget_tokens).toBe(
        500_000,
      );
      expect(org.run_config.context).toEqual(
        contender === 'phase2'
          ? { require_brief: true, notes: true, session_cap: SESSION_CAP }
          : undefined,
      );
    },
  );

  it('hands deliverable directories to review and rejects a unit with nothing saved', async () => {
    const root = await prepareTrial({
      scenario: 'growth-like',
      base,
      contender: 'current-best',
      trial: '2',
    });
    expect((await checkTrial(root)).map((u: any) => u.accepted)).toEqual([false, false, false]);
    mkdirSync(join(root, 'workspace/deliverables/content'), { recursive: true });
    writeFileSync(join(root, 'workspace/deliverables/content/post.md'), '# post');
    const units = await checkTrial(root);
    expect(units[0]).toMatchObject({
      unit: 'content-piece',
      accepted: null,
      evidence: { files: ['post.md'], needsReview: true },
    });
    expect(units[1].accepted).toBe(false);
  });
});
