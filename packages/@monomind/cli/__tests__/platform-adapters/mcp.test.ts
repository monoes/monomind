import { describe, expect, it } from 'vitest';
import { renderMcpArtifacts, mcpCommand, mcpServerEntry } from '../../src/platform-adapters/renderers/mcp.js';
import { CAPABILITIES, type PlatformAdapter } from '../../src/platform-adapters/types.js';

function adapter(overrides: Partial<PlatformAdapter> = {}): PlatformAdapter {
  return {
    id: 'claude',
    displayName: 'Claude Code',
    capabilities: Object.fromEntries(CAPABILITIES.map((capability) => [capability, 'experimental'])) as PlatformAdapter['capabilities'],
    verification: Object.fromEntries(
      CAPABILITIES.map((capability) => [capability, { level: 'none', verifiedAt: '2026-08-24' }]),
    ) as PlatformAdapter['verification'],
    paths: {
      locations: {
        mcp: {
          project: { path: '.mcp.json', format: 'json', entryPath: ['mcpServers', 'monomind'] },
        },
      },
    },
    requiresDiscovery: false,
    ...overrides,
  };
}

describe('MCP renderer', () => {
  it('renders the Monomind command for POSIX and Windows shells', () => {
    expect(mcpCommand('claude', 'linux')).toEqual(['npx', '-y', 'monomind@latest', 'mcp', 'start']);
    expect(mcpCommand('claude', 'win32')).toEqual(['cmd', '/c', 'npx', '-y', 'monomind@latest', 'mcp', 'start']);
  });

  it('preserves each target MCP configuration shape', () => {
    expect(mcpServerEntry('claude', { MONOMIND_MODE: 'v1' }, 'linux')).toEqual({
      command: 'npx',
      args: ['-y', 'monomind@latest', 'mcp', 'start'],
      env: { MONOMIND_MODE: 'v1' },
    });
    expect(mcpServerEntry('opencode', { MONOMIND_MODE: 'v1' }, 'win32')).toEqual({
      type: 'local',
      command: ['cmd', '/c', 'npx', '-y', 'monomind@latest', 'mcp', 'start'],
      enabled: true,
      env: { MONOMIND_MODE: 'v1' },
    });
  });

  it('builds a named monomind entry only for a native capability with a declared scoped location', () => {
    const native = adapter({
      capabilities: { ...adapter().capabilities, mcp: 'native' },
    });

    const rendered = renderMcpArtifacts(native, {
      scope: 'project',
      os: 'linux',
      env: { MONOMIND_MODE: 'v1' },
    });

    expect(rendered.diagnostics).toEqual([]);
    expect(rendered.intents).toEqual([{
      kind: 'mcp',
      locationKey: 'mcp',
      scope: 'project',
      replace: 'named_entry',
      format: 'json',
      entryPath: ['mcpServers', 'monomind'],
      content: JSON.stringify({
        command: 'npx',
        args: ['-y', 'monomind@latest', 'mcp', 'start'],
        env: { MONOMIND_MODE: 'v1' },
      }),
    }]);
  });

  it('does not fabricate an MCP artifact for non-native or undeclared surfaces', () => {
    const fallback = adapter({
      capabilities: { ...adapter().capabilities, mcp: 'cli_fallback' },
    });
    const nativeWithoutLocation = adapter({
      capabilities: { ...adapter().capabilities, mcp: 'native' },
      paths: { locations: {} },
    });

    expect(renderMcpArtifacts(fallback, { scope: 'project' }).intents).toEqual([]);
    expect(renderMcpArtifacts(fallback, { scope: 'project' }).diagnostics.join('\n')).toContain('CLI fallback');
    expect(renderMcpArtifacts(nativeWithoutLocation, { scope: 'project' }).intents).toEqual([]);
    expect(renderMcpArtifacts(nativeWithoutLocation, { scope: 'project' }).diagnostics.join('\n')).toContain('no declared project MCP location');
  });
});
