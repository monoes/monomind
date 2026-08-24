import { describe, expect, it } from 'vitest';
import { discover } from '../../src/platform-adapters/discovery.js';
import { PLATFORM_REGISTRY } from '../../src/platform-adapters/registry.js';

describe('platform discovery', () => {
  it.each([
    ['trae', 'TRAE_CONFIG_PATH'],
    ['hermes', 'HERMES_CONFIG_PATH'],
    ['antigravity', 'ANTIGRAVITY_CONFIG_PATH'],
    ['zed', 'ZED_CONFIG_PATH'],
  ] as const)('requires an explicit existing configuration path for %s', (platform, variable) => {
    const checked: string[] = [];

    const result = discover(PLATFORM_REGISTRY[platform], {
      environment: { [variable]: '/explicit/config' },
      exists: (path) => {
        checked.push(path);
        return false;
      },
    });

    expect(result.available).toBe(false);
    expect(result.locations).toBeUndefined();
    expect(checked).toEqual(['/explicit/config']);
    expect(result.diagnostics).toContain(`${platform}: ${variable} does not exist`);
  });

  it('reports available discovery from an explicit existing path without inventing artifact locations', () => {
    const result = discover(PLATFORM_REGISTRY.antigravity, {
      environment: { ANTIGRAVITY_CONFIG_PATH: '/explicit/antigravity.json' },
      exists: (path) => path === '/explicit/antigravity.json',
    });

    expect(result).toEqual({
      available: true,
      paths: { config: '/explicit/antigravity.json' },
      features: new Set(),
      verification: {},
      diagnostics: ['antigravity: explicit configuration path is available; artifact locations require renderer validation'],
    });
  });

  it('does not probe a platform that has no discovery requirement', () => {
    const result = discover(PLATFORM_REGISTRY.codex, {
      environment: { CODEX_CONFIG_PATH: '/ignored/config' },
      exists: () => {
        throw new Error('non-discovery adapters must not read the filesystem');
      },
    });

    expect(result).toEqual({
      available: false,
      paths: {},
      features: new Set(),
      verification: {},
      diagnostics: ['codex: discovery is not required'],
    });
  });
});
