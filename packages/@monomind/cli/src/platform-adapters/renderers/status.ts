/** Read-only status artifact renderer and capability-gated enhancement composition. */

import type { ArtifactIntent, InstallScope, PlatformAdapter } from '../types.js';
import { renderAgents } from './agents.js';
import { renderCommands, renderPermissions } from './commands.js';

export interface EnhancementRenderOptions {
  scope: InstallScope;
}

export type StatusRenderResult =
  | { intent: ArtifactIntent; diagnostic?: never }
  | { intent?: never; diagnostic: string };

function statusContent(adapter: PlatformAdapter): string {
  if (adapter.id === 'opencode') {
    return [
      '---',
      'description: Show Monomind project status.',
      '---',
      '',
      'Run `/monomind-status` to report the cached Monomind health summary.',
      'For machine-readable output, run `monomind status --json`.',
      '',
    ].join('\n');
  }

  return [
    `# Monomind status for ${adapter.displayName}`,
    '',
    'Use `monomind status --json` for a machine-readable runtime, MCP, graph, memory, and hook health report.',
    '',
  ].join('\n');
}

/**
 * A status result is deliberately discriminated: fallback platforms receive a
 * diagnostic, never an undefined artifact that callers could accidentally add.
 */
export function renderStatus(adapter: PlatformAdapter, scope: InstallScope): StatusRenderResult {
  if (adapter.capabilities.status !== 'native') {
    return { diagnostic: `${adapter.displayName}: use \`monomind status --json\`.` };
  }
  const location = adapter.paths.locations.status?.[scope];
  if (location === undefined || typeof location === 'string') {
    return {
      diagnostic: `${adapter.displayName}: native status has no declared ${scope} location; use \`monomind status --json\`.`,
    };
  }

  return {
    intent: {
      kind: 'status',
      locationKey: 'status',
      content: statusContent(adapter),
      scope,
      replace: 'managed_block',
      marker: `status:${adapter.id}`,
      format: 'md',
    },
  };
}

/** Compose enhancement data without resolving paths or mutating the filesystem. */
export function renderEnhancements(
  adapter: PlatformAdapter,
  options: EnhancementRenderOptions,
): { intents: ArtifactIntent[]; diagnostics: string[] } {
  const intents = [
    ...renderCommands(adapter, options.scope),
    ...renderAgents(adapter, options.scope),
    ...renderPermissions(adapter, options.scope),
  ];
  const status = renderStatus(adapter, options.scope);

  if (status.intent) intents.push(status.intent);
  return status.diagnostic
    ? { intents, diagnostics: [status.diagnostic] }
    : { intents, diagnostics: [] };
}
