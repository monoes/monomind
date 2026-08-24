import { describe, expect, it } from 'vitest';
import { getRenderer, RENDERERS } from '../../src/platform-adapters/renderers/index.js';
import { PLATFORM_IDS, PLATFORM_REGISTRY } from '../../src/platform-adapters/registry.js';
import type { Capability, PlatformAdapter } from '../../src/platform-adapters/types.js';

function withNativeCapabilities(adapter: PlatformAdapter, capabilities: readonly Capability[]): PlatformAdapter {
  return {
    ...adapter,
    capabilities: {
      ...adapter.capabilities,
      ...Object.fromEntries(capabilities.map((capability) => [capability, 'native'])),
    },
  };
}

describe('platform renderer registry', () => {
  it.each(PLATFORM_IDS)('%s resolves to its dedicated renderer', (platform) => {
    const renderer = getRenderer(platform);

    expect(renderer).toBe(RENDERERS[platform]);
    expect(renderer.platform).toBe(platform);
  });

  it('composes only native capabilities with concrete artifact locations', () => {
    const adapter = withNativeCapabilities(PLATFORM_REGISTRY.opencode, [
      'instructions', 'skills', 'mcp', 'commands', 'agents', 'permissions', 'status',
    ]);

    const plan = getRenderer('opencode').render(adapter, {
      platform: 'opencode',
      scope: 'project',
      path: '/fixture',
    });

    expect(plan.scope).toBe('project');
    expect(plan.authorizedUserMutation).toBe(true);
    expect([...new Set(plan.intents.map(({ kind }) => kind))].sort()).toEqual([
      'agent', 'command', 'instruction', 'mcp', 'skill',
    ]);
    expect(plan.intents.filter(({ kind }) => kind === 'skill')).not.toHaveLength(0);
  });

  it.each(['trae', 'hermes'] as const)('does not emit experimental artifacts for %s without discovery', (platform) => {
    const plan = getRenderer(platform).render(PLATFORM_REGISTRY[platform], {
      platform,
      scope: 'project',
      path: '/fixture',
      discovery: { available: false, paths: {}, features: new Set(), verification: {}, diagnostics: [] },
    });

    expect(plan.intents).toEqual([]);
    expect(plan.diagnostics).toContain(`${PLATFORM_REGISTRY[platform].displayName}: native enhancements require successful discovery.`);
  });
});
