import { describe, it, expect } from 'vitest';
import { computeReplacementBudget, mergeEffectiveRoleConfig } from '../../src/orgrt/role-slot.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';

function role(overrides: Record<string, unknown> = {}) {
  return OrgDefSchema.parse({
    name: 'x',
    roles: [{ id: 'worker', type: 'worker', reports_to: 'boss', ...overrides }, { id: 'boss' }],
  }).roles[0];
}

describe('mergeEffectiveRoleConfig', () => {
  it('applies a supplied runtime override', () => {
    const merged = mergeEffectiveRoleConfig(role(), { runtime: 'opencode' });
    expect(merged.runtime).toBe('opencode');
  });

  it('applies a supplied model override into adapter_config.model', () => {
    const merged = mergeEffectiveRoleConfig(role(), { model: 'gpt-5' });
    expect(merged.adapter_config?.model).toBe('gpt-5');
  });

  it('applies a supplied providerName override into adapter_config.provider', () => {
    const merged = mergeEffectiveRoleConfig(role(), { providerName: 'my-provider' });
    expect(merged.adapter_config?.provider).toBe('my-provider');
  });

  it('keeps the current effective value for every unspecified field', () => {
    const current = role({
      runtime: 'qwen',
      adapter_config: { model: 'qwen-max', provider: 'existing' },
    });
    const merged = mergeEffectiveRoleConfig(current, { model: 'qwen-max-2' });
    expect(merged.runtime).toBe('qwen');
    expect(merged.adapter_config?.model).toBe('qwen-max-2');
    expect(merged.adapter_config?.provider).toBe('existing');
  });

  it('repeated replacement keeps unspecified values from the PREVIOUS effective config, not the original', () => {
    const original = role({ adapter_config: { model: 'v1' } });
    const afterFirst = mergeEffectiveRoleConfig(original, { model: 'v2', providerName: 'p1' });
    const afterSecond = mergeEffectiveRoleConfig(afterFirst, { runtime: 'grok' });
    expect(afterSecond.adapter_config?.model).toBe('v2');
    expect(afterSecond.adapter_config?.provider).toBe('p1');
    expect(afterSecond.runtime).toBe('grok');
  });

  it('does not mutate the input role', () => {
    const current = role({ adapter_config: { model: 'v1' } });
    const before = JSON.stringify(current);
    mergeEffectiveRoleConfig(current, { model: 'v2' });
    expect(JSON.stringify(current)).toBe(before);
  });
});

describe('computeReplacementBudget', () => {
  it("returns the role's own budget_tokens override when set", () => {
    const def = OrgDefSchema.parse({
      name: 'x',
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss', budget_tokens: 500_000 }],
      run_config: { budget_tokens: 1_000_000 },
    });
    expect(computeReplacementBudget(def, 'worker')).toBe(500_000);
  });

  it('splits the remaining org budget evenly across un-overridden roles, matching startup allocation', () => {
    const def = OrgDefSchema.parse({
      name: 'x',
      roles: [
        { id: 'boss' },
        { id: 'a', reports_to: 'boss' },
        { id: 'b', reports_to: 'boss', budget_tokens: 400_000 },
      ],
      run_config: { budget_tokens: 1_000_000 },
    });
    // overridden sum = 400_000; remaining 600_000 split across boss + a = 300_000 each
    expect(computeReplacementBudget(def, 'boss')).toBe(300_000);
    expect(computeReplacementBudget(def, 'a')).toBe(300_000);
  });

  it('returns its own override even when every role has an explicit override', () => {
    const def = OrgDefSchema.parse({
      name: 'x',
      roles: [{ id: 'boss', budget_tokens: 1_000_000 }],
      run_config: { budget_tokens: 1_000_000 },
    });
    expect(computeReplacementBudget(def, 'boss')).toBe(1_000_000);
  });

  it('throws for an unknown role id', () => {
    const def = OrgDefSchema.parse({ name: 'x', roles: [{ id: 'boss' }] });
    expect(() => computeReplacementBudget(def, 'ghost')).toThrow();
  });
});
