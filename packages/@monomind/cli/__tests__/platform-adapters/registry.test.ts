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

  // docs/mastermind/plans/2026-11-surface-reduction.md, section 3.
  it('assigns every adapter the tier from the surface-reduction plan', () => {
    const tiers = Object.fromEntries(PLATFORM_IDS.map((id) => [id, PLATFORM_REGISTRY[id].tier]));
    expect(tiers).toEqual({
      claude: 1,
      codex: 2,
      opencode: 2,
      antigravity: 2,
      kimi: 2,
      gemini: 3,
      cursor: 3,
      vscode: 3,
      copilot: 3,
      aider: 3,
      kiro: 3,
      trae: 3,
      openclaw: 3,
      droid: 3,
      hermes: 3,
      zed: 3,
    });
  });

  it('normalizes legacy ids', () => {
    expect(resolvePlatformId('claw')).toBe('openclaw');
    expect(resolvePlatformId('kimicode')).toBe('kimi');
    expect(resolvePlatformId('not-a-platform')).toBeUndefined();
  });
});
