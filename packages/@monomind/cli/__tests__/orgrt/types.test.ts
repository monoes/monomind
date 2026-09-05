// packages/@monomind/cli/__tests__/orgrt/types.test.ts
import { describe, it, expect } from 'vitest';
import { OrgDefSchema, type BusEvent } from '../../src/orgrt/types.js';

describe('OrgDefSchema', () => {
  it('parses a minimal v2 org definition', () => {
    const def = OrgDefSchema.parse({
      name: 'test-org',
      goal: 'test goal',
      roles: [
        { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
        { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss' },
      ],
    });
    expect(def.roles[0].id).toBe('boss');
    expect(def.run_config.max_concurrent_agents).toBe(4); // default
  });

  it('accepts v1 org files (extra fields passthrough)', () => {
    const v1 = {
      name: 'legacy', goal: 'g', created: 'x', updated: 'x', mode: 'daemon',
      topology: 'hierarchical', schedule: null, status: 'active',
      first_run_complete: true,
      governance: { policy: 'auto', approvals_file: 'a.json' },
      run_config: { memory_namespace: 'org:legacy', budget_tokens: 500000 },
      phases: [], communication: [],
      roles: [{
        id: 'ceo', title: 'CEO', type: 'boss', agent_type: 'coordinator',
        reports_to: null, channels: [], color: '#fff', skills: [],
        responsibilities: [], instructions_file: 'x.md',
        adapter_config: { model: 'claude-sonnet-4-5', max_tokens: 8000 },
      }],
    };
    const def = OrgDefSchema.parse(v1);
    expect(def.roles[0].adapter_config?.model).toBe('claude-sonnet-4-5');
    expect(def.run_config.budget_tokens).toBe(500000);
  });

  it('BusEvent type covers all event kinds', () => {
    const e: BusEvent = {
      id: '1', ts: 1, org: 'o', run: 'r', type: 'message',
      from: 'a', to: 'b', msg: 'hi', subject: 's',
    };
    expect(e.type).toBe('message');
    const gate: BusEvent = { id: '2', ts: 2, org: 'o', run: 'r', type: 'gate', from: 'dev' };
    expect(gate.type).toBe('gate');
  });

  it('run_config.circuit_breaker parses with defaults', () => {
    const def = OrgDefSchema.parse({
      name: 'cb-org', goal: 'test', roles: [{ id: 'boss', type: 'boss', reports_to: null }],
      run_config: { circuit_breaker: {} },
    });
    const cb = (def.run_config as Record<string, unknown>).circuit_breaker as { failure_threshold: number; cooldown_ms: number };
    expect(cb.failure_threshold).toBe(5);
    expect(cb.cooldown_ms).toBe(0);
  });

  it('run_config.stale_base_threshold defaults to 0', () => {
    const def = OrgDefSchema.parse({
      name: 'stale-org', goal: 'test', roles: [{ id: 'boss', type: 'boss', reports_to: null }],
    });
    expect((def.run_config as Record<string, unknown>).stale_base_threshold).toBe(0);
  });

  it('run_config.stale_base_threshold accepts a custom value', () => {
    const def = OrgDefSchema.parse({
      name: 'stale-org', goal: 'test', roles: [{ id: 'boss', type: 'boss', reports_to: null }],
      run_config: { stale_base_threshold: 10 },
    });
    expect((def.run_config as Record<string, unknown>).stale_base_threshold).toBe(10);
  });

  it('run_config.workspace accepts worktree-per-role', () => {
    const def = OrgDefSchema.parse({
      name: 'wt-org', goal: 'test', roles: [{ id: 'boss', type: 'boss', reports_to: null }],
      run_config: { workspace: 'worktree-per-role' },
    });
    expect(def.run_config.workspace).toBe('worktree-per-role');
  });

  it('roles accept per-role provider config', () => {
    const def = OrgDefSchema.parse({
      name: 'multi-provider', goal: 'test',
      roles: [
        { id: 'boss', type: 'boss', reports_to: null },
        { id: 'dev', type: 'specialist', reports_to: 'boss', provider: { kind: 'api-key', apiKeyEnv: 'MY_KEY' } },
        { id: 'reviewer', type: 'specialist', reports_to: 'boss', provider: { kind: 'bedrock' } },
      ],
    });
    expect(def.roles[1].provider?.kind).toBe('api-key');
    expect(def.roles[2].provider?.kind).toBe('bedrock');
    expect(def.roles[0].provider).toBeUndefined(); // default subscription
  });

  it('roles accept per-role model override', () => {
    const def = OrgDefSchema.parse({
      name: 'multi-model', goal: 'test',
      roles: [
        { id: 'boss', type: 'boss', reports_to: null, adapter_config: { model: 'claude-opus-4' } },
        { id: 'fast', type: 'specialist', reports_to: 'boss', adapter_config: { model: 'claude-haiku-4' } },
      ],
    });
    expect(def.roles[0].adapter_config?.model).toBe('claude-opus-4');
    expect(def.roles[1].adapter_config?.model).toBe('claude-haiku-4');
  });

  it('omitted adapter_config.model stays undefined instead of defaulting to claude-sonnet-4-5', () => {
    const def = OrgDefSchema.parse({
      name: 'codex-org', goal: 'test',
      roles: [
        {
          id: 'boss', type: 'boss', reports_to: null,
          runtime: 'codex',
          adapter_config: { max_tokens: 100000 },
        },
      ],
    });
    expect(def.roles[0].adapter_config?.model).toBeUndefined();
    expect(def.roles[0].adapter_config?.max_tokens).toBe(100000);
  });

  it('run_config.prechecks parses', () => {
    const def = OrgDefSchema.parse({
      name: 'pc-org', goal: 'test', roles: [{ id: 'boss', type: 'boss', reports_to: null }],
      run_config: { prechecks: [{ name: 'git-clean', command: 'git diff --quiet' }] },
    });
    const pc = (def.run_config as Record<string, unknown>).prechecks as { name: string; command: string }[];
    expect(pc).toHaveLength(1);
    expect(pc[0].name).toBe('git-clean');
  });

  it('run_config.circuit_breaker accepts custom thresholds', () => {
    const def = OrgDefSchema.parse({
      name: 'cb-org', goal: 'test', roles: [{ id: 'boss', type: 'boss', reports_to: null }],
      run_config: { circuit_breaker: { failure_threshold: 3, cooldown_ms: 10_000 } },
    });
    const cb = (def.run_config as Record<string, unknown>).circuit_breaker as { failure_threshold: number; cooldown_ms: number };
    expect(cb.failure_threshold).toBe(3);
    expect(cb.cooldown_ms).toBe(10_000);
  });
});
