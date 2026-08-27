/** Native subagent manifest renderer. */

import type { ArtifactIntent, InstallScope, PlatformAdapter } from '../types.js';

function toolPolicy(adapter: PlatformAdapter): string[] {
  switch (adapter.id) {
    case 'claude':
      return ['tools:', '  - Read', '  - Grep', '  - Glob', '  - Bash'];
    case 'opencode':
      return ['permission:', '  read: allow', '  search: allow', '  shell: ask', '  edit: ask'];
    case 'kimi':
      return ['tools: read, search, shell'];
    default:
      // Keep policy fields out of platforms whose agent schema has not been verified.
      return [];
  }
}

function agentContent(adapter: PlatformAdapter): string {
  return [
    '---',
    'name: mastermind-coordinator',
    'description: Coordinates planning, review, debugging, research, and execution with Monomind.',
    ...toolPolicy(adapter),
    '---',
    '',
    'Use the applicable `mastermind-*` skill and Monomind MCP tools. Escalate shell and edit actions according to the platform tool policy.',
    '',
  ].join('\n');
}

/** Render one portable coordinator definition where a native agent surface is available. */
export function renderAgents(adapter: PlatformAdapter, scope: InstallScope): ArtifactIntent[] {
  const location = adapter.paths.locations.agent?.[scope];
  if (
    adapter.capabilities.agents !== 'native' ||
    location === undefined ||
    typeof location === 'string'
  )
    return [];

  return [
    {
      kind: 'agent',
      locationKey: 'agent',
      content: agentContent(adapter),
      scope,
      replace: 'managed_block',
      marker: `agents:${adapter.id}:mastermind-coordinator`,
      format: 'md',
    },
  ];
}
