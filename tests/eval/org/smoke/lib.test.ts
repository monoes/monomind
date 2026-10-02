import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OrgDefSchema } from '../../../../packages/@monomind/cli/src/orgrt/types.js';
import { checklistFindings } from '../../../../packages/@monomind/cli/src/orgrt/validate-checklist.js';
// @ts-expect-error plain .mjs modules
import { checkTrial } from './check.mjs';
// @ts-expect-error plain .mjs modules
import {
  applyCaps,
  applyContender,
  applyModel,
  CONTENDERS,
  effectiveDiff,
  isolate,
  MODEL,
} from './lib.mjs';
// @ts-expect-error plain .mjs modules
import { buildInputs, prepareTrial } from './prepare.mjs';

const def = () => ({
  name: 'x',
  schedule: '* * * * *',
  run_config: { workspace: '/w', session_scope: 'role' },
  roles: [
    { id: 'a', type: 'boss', runtime: 'codex', adapter_config: { model: 'm', keep: 1 } },
    { id: 'b', type: 's', reports_to: 'a', provider: 'p' },
  ],
});

describe('contenders', () => {
  it('has the two the spec names', () => expect(CONTENDERS).toEqual(['current-best', 'phase2']));

  it('current-best is task-scoped with no context surface; phase2 adds exactly the Phase 2 surface', () => {
    const base = applyContender(def(), 'current-best');
    expect(base.run_config).toEqual({ workspace: '/w', session_scope: 'task' });
    const p2 = applyContender(def(), 'phase2', { sessionCap: { tokens: 1000 } });
    expect(effectiveDiff(base, p2)).toEqual(['run_config.context']);
    expect(p2.run_config.context).toEqual({
      require_brief: true,
      notes: true,
      session_cap: { tokens: 1000 },
    });
  });

  it("refuses phase2 without the scenario's cap, and an unknown contender; never mutates its input", () => {
    expect(() => applyContender(def(), 'phase2')).toThrow(/session cap/);
    expect(() => applyContender(def(), 'best')).toThrow(/contender must be/);
    const d = def();
    applyContender(d, 'phase2', { sessionCap: { tasks: 3 } });
    expect(d).toEqual(def());
  });
});

describe('model, caps and isolation', () => {
  it('pins every role to Haiku 4.5 and drops other runtimes and providers', () => {
    const out = applyModel(def());
    expect(MODEL).toBe('claude-haiku-4-5-20251001');
    expect(out.roles.map((r: any) => [r.adapter_config.model, r.runtime, r.provider])).toEqual([
      [MODEL, undefined, undefined],
      [MODEL, undefined, undefined],
    ]);
    expect(out.roles[0].adapter_config.keep).toBe(1);
  });

  it('applies per-role caps within the allocation, and refuses an overrun, a missing role or an unknown role', () => {
    expect(applyCaps(def(), { a: 3, b: 5 }, 8).roles.map((r: any) => r.budget_usd)).toEqual([3, 5]);
    expect(() => applyCaps(def(), { a: 5, b: 5 }, 8)).toThrow(/over the \$8/);
    expect(() => applyCaps(def(), { a: 1 }, 8)).toThrow(/role b has no cap/);
    expect(() => applyCaps(def(), { a: 1, b: 1, c: 1 }, 8)).toThrow(/unknown role c/);
  });

  it('isolates: renamed, unscheduled, own workspace, immutable inputs write-denied', () => {
    const out = isolate(def(), { name: 't1', workspace: '/trial/ws', denyWrite: ['/inputs'] });
    expect(out.name).toBe('t1');
    expect(out.schedule).toBeUndefined();
    expect(out.run_config.workspace).toBe('/trial/ws');
    for (const r of out.roles) expect(r.policy.sandbox.denyWrite).toEqual(['/inputs']);
  });
});

describe('prepare and check, end to end on the self-test kit', () => {
  it('builds read-only inputs once, a fresh isolated trial per call, and checks a finished trial', async () => {
    const base = mkdtempSync(join(tmpdir(), 'smoke-'));
    const inputs = await buildInputs({ scenario: '_selftest', base });
    await expect(buildInputs({ scenario: '_selftest', base })).rejects.toThrow(/immutable/);
    expect(() => writeFileSync(join(inputs, 'workspace/seed.txt'), 'x')).toThrow(); // read-only

    const root = await prepareTrial({
      scenario: '_selftest',
      base,
      contender: 'phase2',
      trial: '1',
    });
    await expect(
      prepareTrial({ scenario: '_selftest', base, contender: 'phase2', trial: '1' }),
    ).rejects.toThrow(/fresh root/);
    const trial = JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8'));
    expect(trial).toMatchObject({
      name: 'smoke-_selftest-phase2-1',
      contender: 'phase2',
      model: MODEL,
      task: 'Write answer.txt',
      guard: [inputs],
      deadlineSeconds: 600,
      allocationUsd: 8,
    });
    expect(trial.effectiveDiffFromCurrentBest).toEqual(['run_config.context']);
    const org = JSON.parse(
      readFileSync(join(root, '.monomind/orgs/smoke-_selftest-phase2-1.json'), 'utf8'),
    );
    const parsed = OrgDefSchema.parse(org); // the runtime accepts what the kit prepared
    expect(checklistFindings(parsed).errors).toEqual([]);
    expect(org.schedule).toBeUndefined();
    expect(org.run_config).toMatchObject({
      session_scope: 'task',
      workspace: join(root, 'workspace'),
      context: { session_cap: { tokens: 50_000 } },
    });
    expect(org.roles.map((r: any) => r.budget_usd)).toEqual([2, 4]);
    expect(existsSync(join(root, 'workspace/seed.txt'))).toBe(true);

    expect((await checkTrial(root))[0]).toMatchObject({ unit: 'answer', accepted: false });
    writeFileSync(join(root, 'workspace/answer.txt'), '42\n');
    expect((await checkTrial(root))[0]).toMatchObject({ accepted: true });
    expect(JSON.parse(readFileSync(join(root, 'units.json'), 'utf8')).contender).toBe('phase2');
  });
});
