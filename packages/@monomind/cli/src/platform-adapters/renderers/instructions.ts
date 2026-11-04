/** Concise, marker-scoped project instruction rendering. */

import type { ArtifactIntent, InstallScope, PlatformAdapter } from '../types.js';
import { monomindNpx } from './mcp.js';

function hasConcreteInstructionLocation(adapter: PlatformAdapter, scope: InstallScope): boolean {
  const location = adapter.paths.locations.instruction?.[scope];
  return location !== undefined && typeof location !== 'string';
}

export function platformInstruction(_adapter: PlatformAdapter, pin?: string): string {
  const npx = monomindNpx(pin);
  return [
    '# Monomind',
    '',
    'Use the `monomind` MCP tools for graph navigation, impact analysis, memory, and organization work.',
    'For multi-step work, load only the applicable `mastermind-*` skill; do not load all workflows at once.',
    `If MCP is unavailable, run \`${npx} doctor\` and use \`${npx}\` commands.`,
  ].join('\n');
}

/** Render only a verified native instruction surface. */
export function renderInstruction(
  adapter: PlatformAdapter,
  scope: InstallScope,
  pin?: string,
): ArtifactIntent | undefined {
  if (
    adapter.capabilities.instructions !== 'native' ||
    !hasConcreteInstructionLocation(adapter, scope)
  ) {
    return undefined;
  }

  return {
    kind: 'instruction',
    locationKey: 'instruction',
    content: platformInstruction(adapter, pin),
    marker: `instructions:${adapter.id}`,
    scope,
    replace: 'managed_block',
    format: 'md',
  };
}
