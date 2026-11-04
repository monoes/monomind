/** Generated public compatibility matrix. */

import { CAPABILITIES, PLATFORM_IDS, type PlatformAdapter } from './registry.js';

function symbol(level: string): string {
  if (level === 'native') return 'native';
  if (level === 'cli_fallback') return 'CLI fallback';
  if (level === 'experimental') return 'experimental';
  return 'unsupported';
}

export function renderCompatibilityMatrix(registry: Record<string, PlatformAdapter>): string {
  const header = ['Platform', 'Tier', ...CAPABILITIES, 'Discovery'].join(' | ');
  const separator = ['---', '---', ...CAPABILITIES.map(() => '---'), '---'].join(' | ');
  const rows = PLATFORM_IDS.map((id) => {
    const adapter = registry[id];
    return [
      adapter.displayName,
      adapter.tier === 3 ? '3 (experimental)' : String(adapter.tier),
      ...CAPABILITIES.map((capability) => symbol(adapter.capabilities[capability])),
      adapter.requiresDiscovery ? 'required' : 'no',
    ].join(' | ');
  });
  return [
    '# Platform compatibility',
    '',
    '> Generated from the evidence-gated adapter registry. “experimental” means Monomind does not install an unverified native artifact.',
    '>',
    '> Tier 1 gets every feature first; tier 2 is tested per release; tier 3 is best-effort and experimental, with no feature parity promise.',
    '',
    header,
    separator,
    ...rows,
    '',
  ].join('\n');
}
