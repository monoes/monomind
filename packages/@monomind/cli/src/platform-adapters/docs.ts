/** Generated public compatibility matrix. */

import { CAPABILITIES, PLATFORM_IDS, type PlatformAdapter } from './registry.js';

function symbol(level: string): string {
  if (level === 'native') return 'native';
  if (level === 'cli_fallback') return 'CLI fallback';
  if (level === 'experimental') return 'experimental';
  return 'unsupported';
}

export function renderCompatibilityMatrix(registry: Record<string, PlatformAdapter>): string {
  const header = ['Platform', ...CAPABILITIES, 'Discovery'].join(' | ');
  const separator = ['---', ...CAPABILITIES.map(() => '---'), '---'].join(' | ');
  const rows = PLATFORM_IDS.map((id) => {
    const adapter = registry[id];
    return [
      adapter.displayName,
      ...CAPABILITIES.map((capability) => symbol(adapter.capabilities[capability])),
      adapter.requiresDiscovery ? 'required' : 'no',
    ].join(' | ');
  });
  return [
    '# Platform compatibility',
    '',
    '> Generated from the evidence-gated adapter registry. “experimental” means Monomind does not install an unverified native artifact.',
    '',
    header,
    separator,
    ...rows,
    '',
  ].join('\n');
}
