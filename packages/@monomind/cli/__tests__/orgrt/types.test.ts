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
  });
});
