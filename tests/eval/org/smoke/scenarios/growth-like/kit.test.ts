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
import { ALLOCATION_USD, CAPS, ORG_STOP_USD, SESSION_CAP, SOLO_TASK, TASK } from './kit.mjs';

const snapshot = process.env.SMOKE_GROWTH_SNAPSHOT ?? '/var/tmp/mm-phase0/snapshot';
const have = existsSync(join(snapshot, 'manifest.json'));

// Declared change, round 2 (2026-10-02, owner decision 2): the per-role caps are doubled, the planning
// allocation is $12 per run, and an org-wide stop of $12 bounds the worst case, so the role caps may sum
// above it. Round 1's caps ($7.90 in all) stay on record in kit.mjs.
describe('growth-like caps', () => {
  const ROUND_1: Record<string, number> = {
    'growth-lead': 1.8,
    researcher: 1.2,
    'content-writer': 1.2,
    'site-seo': 1.1,
    'brand-reviewer': 1.0,
    analyst: 0.4,
    'community-manager': 0.4,
    'social-publisher': 0.4,
    'outreach-manager': 0.4,
  };
  it.each(Object.entries(ROUND_1))('%s has twice its round 1 cap', (role, was) => {
    expect(CAPS[role]).toBeCloseTo(was * 2);
  });
  it('has an org-wide stop at the allocation, which the role caps are allowed to exceed', () => {
    expect(ALLOCATION_USD).toBe(12);
    expect(ORG_STOP_USD).toBe(12);
    expect(
      Object.values(CAPS as Record<string, number>).reduce((a, b) => a + b, 0),
    ).toBeGreaterThan(ORG_STOP_USD);
  });
});

describe('growth-like tasks', () => {
  it('tells every multi-role arm that the lead coordinates and does not write deliverables, and asks for new work', () => {
    expect(TASK).toMatch(/lead coordinates and does not write deliverables itself/);
    expect(TASK).toMatch(/new work, not a copy of a file already in the workspace/);
  });
  it('tells the single agent it is alone, with the same deliverables, and no coordination rule', () => {
    expect(SOLO_TASK).toMatch(/only agent in this run: do all of it yourself/);
    expect(SOLO_TASK).not.toMatch(/lead coordinates/);
    expect(SOLO_TASK).toMatch(
      /deliverables\/content\/, deliverables\/research\/ and deliverables\/listing\//,
    );
  });
});

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
        4_000_000,
      );
      expect(org.run_config.context).toEqual(
        contender === 'phase2'
          ? { require_brief: true, notes: true, session_cap: SESSION_CAP }
          : undefined,
      );
    },
  );

  it('the single arm is the Phase 2 configuration with the growth lead alone, capped at the org-wide stop', async () => {
    const root = await prepareTrial({
      scenario: 'growth-like',
      base,
      contender: 'single',
      trial: '1',
    });
    const trial = JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8'));
    const org = JSON.parse(
      readFileSync(join(root, '.monomind/orgs', `${trial.name}.json`), 'utf8'),
    );
    expect(OrgDefSchema.parse(org)).toBeTruthy();
    expect(checklistFindings(OrgDefSchema.parse(org)).errors).toEqual([]);
    expect(org.roles.map((r: any) => r.id)).toEqual(['growth-lead']);
    expect(org.roles[0].budget_usd).toBe(ORG_STOP_USD);
    expect(org.run_config.context).toEqual({
      require_brief: true,
      notes: true,
      session_cap: SESSION_CAP,
    });
    expect(trial.task).toBe(SOLO_TASK);
    expect(trial.runners).toEqual({
      'growth-lead': { runtime: 'claude', model: 'claude-haiku-4-5-20251001' },
    }); // same model as the others, by default
  });

  it('the production profile puts the Claude roles on Sonnet, scales the USD caps by the price ratio, keeps the designers', async () => {
    const root = await prepareTrial({
      scenario: 'growth-like',
      base,
      contender: 'phase2',
      trial: '3',
      profile: 'production',
    });
    const trial = JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8'));
    const org = JSON.parse(
      readFileSync(join(root, '.monomind/orgs', `${trial.name}.json`), 'utf8'),
    );
    expect(trial.profile).toBe('production');
    expect(trial.runners['growth-lead']).toEqual({ runtime: 'claude', model: 'claude-sonnet-5-5' });
    expect(trial.runners.researcher).toEqual({ runtime: 'claude', model: 'claude-sonnet-5-5' });
    expect(trial.runners['visual-designer-codex']).toMatchObject({ runtime: 'codex' });
    expect(trial.runners['visual-designer-agy']).toMatchObject({ runtime: 'antigravity' });
    expect(org.roles.find((r: any) => r.id === 'researcher').budget_usd).toBeCloseTo(
      CAPS.researcher * 2,
    );
    expect(trial.allocationUsd).toBe(12);
    expect(OrgDefSchema.parse(org)).toBeTruthy();
    expect(checklistFindings(OrgDefSchema.parse(org)).errors).toEqual([]);
  });

  it('keeps Haiku and the unscaled caps when no profile is given (harness checks)', async () => {
    const root = await prepareTrial({
      scenario: 'growth-like',
      base,
      contender: 'phase2',
      trial: '4',
    });
    const trial = JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8'));
    const org = JSON.parse(
      readFileSync(join(root, '.monomind/orgs', `${trial.name}.json`), 'utf8'),
    );
    expect(trial.profile).toBe('haiku');
    expect(trial.runners.researcher.model).toBe('claude-haiku-4-5-20251001');
    expect(org.roles.find((r: any) => r.id === 'researcher').budget_usd).toBe(CAPS.researcher);
  });

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
