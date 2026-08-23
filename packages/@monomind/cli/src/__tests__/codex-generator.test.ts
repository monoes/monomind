import { describe, expect, it } from 'vitest';
import {
  CODEX_STATUS_LINE_ITEMS,
  generateCodexAgentsMd,
  generateCodexConfig,
  generateCodexHookScript,
} from '../init/codex-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../init/types.js';

describe('Codex init artifacts', () => {
  it('generates a project-scoped MCP configuration', () => {
    const config = generateCodexConfig({ ...DEFAULT_INIT_OPTIONS, targetDir: '/tmp/project' });

    expect(config).toContain('[mcp_servers.monomind]');
    expect(config).toContain('[features]');
    expect(config).toContain('hooks = true');
    expect(config).toContain('[[hooks.PreToolUse]]');
    expect(config).toContain('[[hooks.PostToolUse]]');
    expect(config).toContain('.codex/hooks/monomind-hook.cjs');
    expect(config).toContain('command = "npx"');
    expect(config).toContain('"monomind@latest"');
    expect(config).toContain('env = {');
    expect(config).toContain('MONOMIND_MAX_AGENTS = "15"');
    expect(config).toContain('[tui]');
    expect(config).toContain(
      `status_line = [${CODEX_STATUS_LINE_ITEMS.map((item) => `"${item}"`).join(', ')}]`,
    );
  });

  it('generates a Codex hook adapter for the shared Monomind runtime', () => {
    const script = generateCodexHookScript();

    expect(script).toContain('hook_event_name');
    expect(script).toContain('pre-bash');
    expect(script).toContain('pre-write');
    expect(script).toContain('post-edit');
    expect(script).toContain('hook-handler.cjs');
  });

  it('generates Codex instructions with Monomind workflows', () => {
    const agents = generateCodexAgentsMd();

    expect(agents).toContain('.codex/config.toml');
    expect(agents).toContain('monomind org run <name>');
    expect(agents).toContain('.agents/shared_instructions.md');
    expect(agents).toContain('native footer');
  });
});
