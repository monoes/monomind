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
  AGY,
  applyCaps,
  applyContender,
  applyModel,
  CODEX,
  CONTENDERS,
  effectiveDiff,
  isolate,
  MODEL,
  ORG_TOKENS,
  RUNNER_PLANS,
  runnersOf,
  UNPRICED_ROLE_TOKENS,
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
  it('puts the root on Claude Haiku and the workers on the scenario plan, dropping other runtimes and providers', () => {
    expect(MODEL).toBe('claude-haiku-4-5-20251001');
    const same = applyModel(def());
    expect(same.roles.map((r: any) => [r.adapter_config.model, r.runtime, r.provider])).toEqual([
      [MODEL, undefined, undefined],
      [MODEL, undefined, undefined],
    ]);
    expect(same.roles[0].adapter_config.keep).toBe(1);
    const mixed = applyModel(def(), { workers: CODEX });
    expect(runnersOf(mixed)).toEqual({
      a: { runtime: 'claude', model: MODEL },
      b: { runtime: 'codex', model: 'gpt-6-astra' },
    });
  });

  it('plans each scenario on one runner for both contenders, with the owner-approved higher models', () => {
    expect(RUNNER_PLANS['research-report'].workers).toEqual({
      runtime: 'codex',
      model: 'gpt-6-astra',
    });
    // not antigravity: its tool-call fences broke on a long org_send in the dry run (see lib.mjs)
    expect(RUNNER_PLANS['deliberative-design'].workers).toEqual({
      runtime: 'codex',
      model: 'gpt-6-astra',
    });
    expect(RUNNER_PLANS['sparse-dispatch'].workers.runtime).toBe('claude');
    expect(RUNNER_PLANS['dev-feature-qa'].workers.runtime).toBe('claude');
  });

  it("keeps a role's own provider under a native plan and pins only the Claude roles", () => {
    const d = def();
    d.roles[1].provider = { kind: 'codex' };
    d.roles[1].adapter_config = { model: 'gpt-6-astra' };
    const out = applyModel(d, { native: true });
    expect(runnersOf(out)).toEqual({
      a: { runtime: 'claude', model: MODEL },
      b: { runtime: 'codex', model: 'gpt-6-astra' },
    });
    expect(applyCaps(out, { a: 1, b: 0 }, 8).roles[1].budget_tokens).toBe(UNPRICED_ROLE_TOKENS);
  });

  it('sizes the caps from the codex dry run: a role cap about 2.5x its busiest codex role, counting cache reads', () => {
    expect(UNPRICED_ROLE_TOKENS).toBe(4_000_000);
    expect(ORG_TOKENS).toBe(60_000_000);
  });

  const priced = () => applyModel(def()); // every role on Claude

  it('applies per-role USD caps within the allocation, and refuses an overrun, a missing role or an unknown role', () => {
    expect(applyCaps(priced(), { a: 3, b: 5 }, 8).roles.map((r: any) => r.budget_usd)).toEqual([
      3, 5,
    ]);
    expect(() => applyCaps(priced(), { a: 5, b: 5 }, 8)).toThrow(/over the \$8/);
    expect(() => applyCaps(priced(), { a: 1 }, 8)).toThrow(/role b has no cap/);
    expect(() => applyCaps(priced(), { a: 1, b: 1, c: 1 }, 8)).toThrow(/unknown role c/);
  });

  it('caps a role on an unpriced runner by tokens, not USD, and fixes the org token cap in every trial', () => {
    const out = applyCaps(applyModel(def(), { workers: AGY }), { a: 3, b: 5 }, 8);
    expect(out.roles[0]).toMatchObject({ budget_usd: 3 });
    expect(out.roles[1].budget_usd).toBeUndefined();
    expect(out.roles[1].budget_tokens).toBe(UNPRICED_ROLE_TOKENS);
    expect(out.run_config.budget_tokens).toBe(ORG_TOKENS);
    expect(out.run_config.budget_tokens_basis).toBe('billable'); // cache reads count: the cap binds on total tokens
    expect(applyCaps(priced(), { a: 3, b: 5 }, 8).run_config.budget_tokens).toBe(ORG_TOKENS);
  });

  it('counts only priced roles against the USD allocation', () => {
    expect(() =>
      applyCaps(applyModel(def(), { workers: CODEX }), { a: 3, b: 99 }, 8),
    ).not.toThrow();
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
      runners: {
        boss: { runtime: 'claude', model: MODEL },
        worker: { runtime: 'claude', model: MODEL },
      },
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
