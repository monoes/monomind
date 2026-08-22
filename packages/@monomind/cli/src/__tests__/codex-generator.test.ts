import { describe, expect, it } from 'vitest';
import { generateCodexAgentsMd, generateCodexConfig } from '../init/codex-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../init/types.js';

describe('Codex init artifacts', () => {
  it('generates a project-scoped MCP configuration', () => {
    const config = generateCodexConfig({ ...DEFAULT_INIT_OPTIONS, targetDir: '/tmp/project' });

    expect(config).toContain('[mcp_servers.monomind]');
    expect(config).toContain('command = "npx"');
    expect(config).toContain('"monomind@latest"');
    expect(config).toContain('env = {');
    expect(config).toContain('MONOMIND_MAX_AGENTS = "15"');
  });

  it('generates Codex instructions with Monomind workflows', () => {
    const agents = generateCodexAgentsMd();

    expect(agents).toContain('.codex/config.toml');
    expect(agents).toContain('monomind org run <name>');
    expect(agents).toContain('.agents/shared_instructions.md');
  });
});
