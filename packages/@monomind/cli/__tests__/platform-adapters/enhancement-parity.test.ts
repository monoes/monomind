import { describe, expect, it } from 'vitest';
import { COMMAND_ALIASES, renderCommands } from '../../src/platform-adapters/renderers/commands.js';
import { renderAgents } from '../../src/platform-adapters/renderers/agents.js';
import { renderEnhancements, renderStatus } from '../../src/platform-adapters/renderers/status.js';
import { PLATFORM_IDS, PLATFORM_REGISTRY } from '../../src/platform-adapters/registry.js';
import type { Capability, PlatformAdapter } from '../../src/platform-adapters/types.js';

function withNativeCapability(adapter: PlatformAdapter, capability: Capability): PlatformAdapter {
  const kind =
    ({
      commands: 'command',
      agents: 'agent',
      status: 'status',
      permissions: 'permission',
    } as const)[capability as 'commands' | 'agents' | 'status' | 'permissions'];
  const locations = kind
    ? {
        ...adapter.paths.locations,
        [kind]: {
          ...adapter.paths.locations[kind],
          project: { path: `.test/${kind}.md`, format: 'md' as const },
        },
      }
    : adapter.paths.locations;
  return {
    ...adapter,
    capabilities: { ...adapter.capabilities, [capability]: 'native' },
    paths: { locations },
  };
}

describe('platform enhancement renderers', () => {
  it('renders only the typed command aliases for a native command surface', () => {
    const adapter = withNativeCapability(PLATFORM_REGISTRY.claude, 'commands');
    const intents = renderCommands(adapter, 'project');

    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ kind: 'command', locationKey: 'command', scope: 'project' });
    expect(intents[0]?.content).toContain('`/plan` → `mastermind-plan`');
    expect(intents[0]?.content).toContain('`/status` → `monomind status --json`');
    expect(new Set(COMMAND_ALIASES.map(({ name }) => name)).size).toBe(COMMAND_ALIASES.length);
    expect(COMMAND_ALIASES.every(({ name }) => !name.startsWith('mastermind:'))).toBe(true);
  });

  it('does not render commands for an evidence-gated surface', () => {
    expect(renderCommands(PLATFORM_REGISTRY.claude, 'project')).toEqual([]);
  });

  it('does not create an enhancement intent when its native capability lacks a scoped location', () => {
    const adapter = {
      ...PLATFORM_REGISTRY.kimi,
      capabilities: { ...PLATFORM_REGISTRY.kimi.capabilities, commands: 'native' as const },
    };

    expect(renderCommands(adapter, 'project')).toEqual([]);
  });

  it.each([
    ['claude', 'tools:\n  - Read'],
    ['opencode', 'permission:\n  read: allow'],
    ['kimi', 'tools: read, search, shell'],
  ] as const)('renders the verified %s agent tool-policy schema', (platform, expectedPolicy) => {
    const intents = renderAgents(withNativeCapability(PLATFORM_REGISTRY[platform], 'agents'), 'project');

    expect(intents).not.toHaveLength(0);
    expect(intents[0]?.kind).toBe('agent');
    expect(intents[0]?.content).toContain(expectedPolicy);
  });

  it('returns a native status intent or an actionable CLI fallback', () => {
    const native = renderStatus(withNativeCapability(PLATFORM_REGISTRY.opencode, 'status'), 'project');
    const fallback = renderStatus(PLATFORM_REGISTRY.codex, 'project');

    expect(native.intent).toMatchObject({ kind: 'status', locationKey: 'status', scope: 'project' });
    expect(native.intent?.content).toContain('/monomind-status');
    expect(fallback.intent).toBeUndefined();
    expect(fallback.diagnostic).toContain('monomind status --json');
  });

  it('exposes an enhancement plan only through native capability gates', () => {
    const adapter = ['commands', 'agents', 'status', 'permissions'].reduce(
      (current, capability) => withNativeCapability(current, capability as Capability),
      PLATFORM_REGISTRY.opencode,
    );
    const rendered = renderEnhancements(adapter, { scope: 'project' });

    expect(rendered.intents.map(({ kind }) => kind).sort()).toEqual(['agent', 'command', 'permission', 'status']);
    expect(rendered.diagnostics).toEqual([]);
  });

  it.each(PLATFORM_IDS)('%s exposes native status only when its gate is promoted', (platform) => {
    const result = renderStatus(PLATFORM_REGISTRY[platform], 'project');
    expect(result.intent ?? result.diagnostic).toBeTruthy();
  });
});
