import { describe, expect, it } from 'vitest';
import { CAPABILITIES, PLATFORM_IDS, PLATFORM_REGISTRY, assertRegistryIsVerifiable, resolvePlatformId } from '../../src/platform-adapters/registry.js';

describe('platform registry', () => {
  it('has one unique adapter for all sixteen supported targets', () => {
    expect(new Set(PLATFORM_IDS).size).toBe(PLATFORM_IDS.length);
    expect([...Object.keys(PLATFORM_REGISTRY)].sort()).toEqual([...PLATFORM_IDS].sort());
  });

  it('declares all nine capabilities for every adapter', () => {
    for (const id of PLATFORM_IDS)
      expect(Object.keys(PLATFORM_REGISTRY[id].capabilities).sort()).toEqual([...CAPABILITIES].sort());
  });

  it('never reports native without exact upstream evidence', () => {
    expect(() => assertRegistryIsVerifiable(PLATFORM_REGISTRY)).not.toThrow();
  });

  it('normalizes legacy ids', () => {
    expect(resolvePlatformId('claw')).toBe('openclaw');
    expect(resolvePlatformId('kimicode')).toBe('kimi');
    expect(resolvePlatformId('not-a-platform')).toBeUndefined();
  });
});
