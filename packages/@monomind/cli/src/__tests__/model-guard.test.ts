import { describe, expect, it } from 'vitest';
import {
  assertModelAllowed,
  isBlockedModel,
  ModelBlockedError,
  withoutBlockedModels,
} from '../model-guard.js';

describe('model guard: Claude Fable and GPT Astra are never assigned or routed', () => {
  it('blocks every spelling of both families', () => {
    for (const id of [
      'claude-fable-5-1',
      'claude-fable-5',
      'fable',
      'Fable',
      'Fable 5.1',
      'gpt-6-astra',
      'gpt-6.1-astra',
      'GPT-6-Astra',
      'astra',
      'anthropic/claude-fable-5-1',
    ]) {
      expect(isBlockedModel(id), id).toBe(true);
    }
  });

  it('allows every model the operator uses and look-alike words', () => {
    for (const id of [
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-4-5-20251001',
      'opus',
      'sonnet',
      'default',
      'gpt-5.6-terra',
      'gpt-6-sol',
      'gpt-6-luna',
      'gemini-3.8-flash-high',
      'gemini-4-argon-high',
      'glm-5.2',
      'contrast-model',
      'unfabled',
      'catastrophe',
      '',
    ]) {
      expect(isBlockedModel(id), id).toBe(false);
    }
  });

  it('treats non-strings as not blocked', () => {
    expect(isBlockedModel(undefined)).toBe(false);
    expect(isBlockedModel(null)).toBe(false);
    expect(isBlockedModel(42)).toBe(false);
  });

  it('assertModelAllowed throws a ModelBlockedError naming the model and where it came from', () => {
    expect(() => assertModelAllowed('claude-opus-5-5', 'role x')).not.toThrow();
    expect(() => assertModelAllowed('gpt-6-astra', 'role x')).toThrow(ModelBlockedError);
    try {
      assertModelAllowed('claude-fable-5-1', 'role lead');
    } catch (e) {
      expect(String((e as Error).message)).toContain('claude-fable-5-1');
      expect(String((e as Error).message)).toContain('role lead');
    }
  });

  it('withoutBlockedModels drops a listing entry when any of its names is blocked', () => {
    const list = [
      { value: 'default', resolvedModel: 'claude-sonnet-5-5', displayName: 'Default' },
      { value: 'fable', resolvedModel: 'claude-fable-5-1', displayName: 'Fable 5.1' },
      { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5' },
      { id: 'gpt-6-astra', label: 'GPT-6-Astra' },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6-Terra' },
    ];
    expect(withoutBlockedModels(list).map((m) => (m as any).value ?? (m as any).id)).toEqual([
      'default',
      'opus',
      'gpt-5.6-terra',
    ]);
  });
});
