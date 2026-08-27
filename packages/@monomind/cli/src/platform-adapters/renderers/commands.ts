/** Native command and permission artifact renderers. */

import type { ArtifactIntent, ArtifactKind, InstallScope, PlatformAdapter } from '../types.js';

export interface CommandAlias {
  name: string;
  kind: 'skill' | 'cli';
  invoke: string;
}

export const COMMAND_ALIASES: readonly CommandAlias[] = [
  { name: 'plan', kind: 'skill', invoke: 'mastermind-plan' },
  { name: 'review', kind: 'skill', invoke: 'mastermind-review' },
  { name: 'debug', kind: 'skill', invoke: 'mastermind-debug' },
  { name: 'research', kind: 'skill', invoke: 'mastermind-research' },
  { name: 'execute', kind: 'skill', invoke: 'mastermind-execute' },
  { name: 'org', kind: 'cli', invoke: 'monomind org run' },
  { name: 'memory', kind: 'cli', invoke: 'monomind memory' },
  { name: 'status', kind: 'cli', invoke: 'monomind status --json' },
  { name: 'doctor', kind: 'cli', invoke: 'monomind platforms doctor' },
];

function hasConcreteLocation(
  adapter: PlatformAdapter,
  kind: ArtifactKind,
  scope: InstallScope,
): boolean {
  const location = adapter.paths.locations[kind]?.[scope];
  return location !== undefined && typeof location !== 'string';
}

function commandContent(adapter: PlatformAdapter): string {
  const aliases = COMMAND_ALIASES.map(({ name, invoke }) => `- \`/${name}\` → \`${invoke}\``);
  return [
    `# Monomind commands for ${adapter.displayName}`,
    '',
    'Use these aliases to select a Mastermind workflow or CLI operation:',
    ...aliases,
    '',
  ].join('\n');
}

/** Render native aliases only after the adapter's capability has been promoted. */
export function renderCommands(adapter: PlatformAdapter, scope: InstallScope): ArtifactIntent[] {
  if (adapter.capabilities.commands !== 'native' || !hasConcreteLocation(adapter, 'command', scope))
    return [];

  return [
    {
      kind: 'command',
      locationKey: 'command',
      content: commandContent(adapter),
      scope,
      replace: 'managed_block',
      marker: `commands:${adapter.id}`,
      format: 'md',
    },
  ];
}

function permissionContent(adapter: PlatformAdapter): string {
  if (adapter.id === 'opencode') {
    return [
      '# Monomind tool policy',
      'permission:',
      '  read: allow',
      '  search: allow',
      '  shell: ask',
      '  edit: ask',
      '',
    ].join('\n');
  }

  return [
    `# Monomind tool policy for ${adapter.displayName}`,
    'Read and search tools are allowed; edits and shell commands require confirmation.',
    '',
  ].join('\n');
}

/** Render a permission policy only for an evidence-verified native surface. */
export function renderPermissions(adapter: PlatformAdapter, scope: InstallScope): ArtifactIntent[] {
  if (
    adapter.capabilities.permissions !== 'native' ||
    !hasConcreteLocation(adapter, 'permission', scope)
  )
    return [];

  return [
    {
      kind: 'permission',
      locationKey: 'permission',
      content: permissionContent(adapter),
      scope,
      replace: 'managed_block',
      marker: `permissions:${adapter.id}`,
      format: 'md',
    },
  ];
}
